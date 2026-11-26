import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitActionResult, GitPullResult } from '@shared/file-types';

const execFileAsync = promisify(execFile);
const MAX_BUFFER = 20 * 1024 * 1024;

/*
 * A repository's own config (.git/config, .git/info/attributes) comes with the
 * folder, so it can be attacker-written (an extracted archive, a committed
 * bare-repository layout). Several settings make git run commands from it:
 * core.fsmonitor, hooks such as post-index-change, and filter drivers. Every
 * call overrides those through command-scope config, which outranks the
 * repository's.
 */

/** Applied to every git call, including the explicit actions. */
const SAFE_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ['core.fsmonitor', 'false'],
  // Never treat a directory laid out as a bare repository (e.g. committed in a
  // clone) as the repository to run in, unless named explicitly.
  ['safe.bareRepository', 'explicit'],
];

/** Applied to the automatic read-only queries (tree decorations, gutter, status bar). */
const READ_ONLY_CONFIG: ReadonlyArray<readonly [string, string]> = [
  ...SAFE_CONFIG,
  ['core.hooksPath', '/dev/null'],
];

/** Read-only commands that never run filter drivers, so they skip the filter lookup. */
const FILTER_FREE_COMMANDS = new Set([
  'rev-parse',
  'symbolic-ref',
  'for-each-ref',
  'ls-files',
  'show',
]);

/** Config scopes the user controls; anything else (local, worktree) comes with the repository. */
const TRUSTED_SCOPES = new Set(['system', 'global', 'command']);

/**
 * Environment passing `entries` as command-scope config, appended after any
 * GIT_CONFIG_COUNT entries the user already set. Unlike `-c`, keys are never
 * split on `=`, so a filter name containing one cannot inject another key.
 */
function configEnv(
  entries: ReadonlyArray<readonly [string, string]>,
  extra: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ...extra };
  let count = Number.parseInt(env.GIT_CONFIG_COUNT ?? '0', 10);
  if (!Number.isInteger(count) || count < 0) count = 0;
  for (const [key, value] of entries) {
    env[`GIT_CONFIG_KEY_${count}`] = key;
    env[`GIT_CONFIG_VALUE_${count}`] = value;
    count += 1;
  }
  env.GIT_CONFIG_COUNT = String(count);
  return env;
}

/**
 * Overrides that disable every filter driver the repository itself defines
 * (`filter.<name>.clean/smudge/process`); `git status` would otherwise run
 * them on files whose stat data is stale. Drivers set only in the user's own
 * config (git-lfs, …) are kept. Throws if the config cannot be read, so the
 * caller never runs git without the overrides.
 */
async function repositoryFilterOverrides(cwd: string): Promise<Array<[string, string]>> {
  let stdout: string;
  try {
    ({ stdout } = await execFileAsync(
      'git',
      ['config', '--show-scope', '-z', '--get-regexp', '^filter\\.'],
      {
        cwd,
        maxBuffer: MAX_BUFFER,
        env: configEnv(READ_ONLY_CONFIG),
      },
    ));
  } catch (error) {
    // Exit code 1 means no matching key.
    if ((error as { code?: unknown }).code === 1) return [];
    throw error;
  }
  const names = new Set<string>();
  // Entries are `scope\0key\nvalue\0`.
  const fields = stdout.split('\0');
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const scope = fields[index]!;
    const key = fields[index + 1]!.split('\n', 1)[0]!;
    const lastDot = key.lastIndexOf('.');
    // `filter..clean` is valid: a driver may be named with the empty string.
    if (TRUSTED_SCOPES.has(scope) || lastDot < 'filter.'.length) continue;
    names.add(key.slice('filter.'.length, lastDot));
  }
  return [...names].flatMap((name): Array<[string, string]> => [
    [`filter.${name}.clean`, ''],
    [`filter.${name}.smudge`, ''],
    [`filter.${name}.process`, ''],
    [`filter.${name}.required`, 'false'],
  ]);
}

/**
 * Run a git command and return stdout with trailing whitespace trimmed.
 */
export async function gitExec(args: string[], cwd: string): Promise<string> {
  return (await gitExecRaw(args, cwd)).trimEnd();
}

/**
 * Run a read-only git command and return stdout as-is (untrimmed). Hardened
 * against the repository's own config: no fsmonitor, hooks or repository
 * filter drivers, and no optional index writes.
 */
export async function gitExecRaw(args: string[], cwd: string): Promise<string> {
  const filters = FILTER_FREE_COMMANDS.has(args[0] ?? '')
    ? []
    : await repositoryFilterOverrides(cwd);
  // A populated submodule has its own config (filters included) that the
  // overrides above do not cover, and checking whether its work tree is dirty
  // runs `git status` inside it. Commits recorded for submodules still show.
  const safeArgs =
    args[0] === 'status' ? ['status', '--ignore-submodules=dirty', ...args.slice(1)] : args;
  const { stdout } = await execFileAsync('git', safeArgs, {
    cwd,
    maxBuffer: MAX_BUFFER,
    // No optional index writes (and so no hooks they would trigger), and no
    // on-demand fetch of missing objects in a partial clone, which would run
    // the repository's remote.<name>.uploadpack or a transport command.
    env: configEnv([...READ_ONLY_CONFIG, ...filters], {
      GIT_OPTIONAL_LOCKS: '0',
      GIT_NO_LAZY_FETCH: '1',
    }),
  });
  return stdout;
}

/**
 * Run a git command that changes the repository and report its outcome instead
 * of throwing. Never prompts for credentials or opens an editor; fails instead
 * so the UI can show the error.
 */
export async function gitAction(
  args: string[],
  cwd: string,
  label: string,
): Promise<GitActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: MAX_BUFFER,
      timeout: 120_000,
      // Hooks and filters stay on here: these run only when the user asks
      // (stage, commit, pull, push), and pre-commit hooks or git-lfs are expected.
      env: configEnv(SAFE_CONFIG, { GIT_TERMINAL_PROMPT: '0', GIT_EDITOR: 'true' }),
    });
    return { ok: true, output: stdout.trim() || stderr.trim() };
  } catch (error) {
    const failure = error as {
      stderr?: string;
      stdout?: string;
      killed?: boolean;
      message?: string;
    };
    if (failure.killed) return { ok: false, output: `${label} timed out.` };
    const output =
      failure.stderr?.trim() || failure.stdout?.trim() || failure.message || String(error);
    return { ok: false, output };
  }
}

/** Non-interactive fast-forward-only `git pull`. */
export function gitPull(cwd: string): Promise<GitPullResult> {
  return gitAction(['pull', '--ff-only', '--no-edit'], cwd, 'git pull');
}

/** Non-interactive `git push` of the current branch to its configured upstream. */
export function gitPush(cwd: string): Promise<GitActionResult> {
  return gitAction(['push'], cwd, 'git push');
}

/** Stage the given paths, including deletions. Paths are never read as pathspec patterns. */
export function gitStage(gitRoot: string, paths: string[]): Promise<GitActionResult> {
  return gitAction(['--literal-pathspecs', 'add', '-A', '--', ...paths], gitRoot, 'git add');
}

/**
 * Remove the given paths from the index, keeping the work tree. Without any
 * commit yet there is no HEAD to reset to, so the entries are dropped from the
 * index instead (`--cached` never touches the work tree, so `-f` is safe).
 */
export async function gitUnstage(gitRoot: string, paths: string[]): Promise<GitActionResult> {
  let hasHead = true;
  try {
    await gitExec(['rev-parse', '--verify', '--quiet', 'HEAD'], gitRoot);
  } catch {
    hasHead = false;
  }
  const args = hasHead
    ? ['--literal-pathspecs', 'reset', '-q', 'HEAD', '--', ...paths]
    : [
        '--literal-pathspecs',
        'rm',
        '-r',
        '-q',
        '-f',
        '--cached',
        '--ignore-unmatch',
        '--',
        ...paths,
      ];
  return gitAction(args, gitRoot, 'git reset');
}

/** Commit the index with the given message (passed as an argument, never through a shell). */
export function gitCommit(gitRoot: string, message: string): Promise<GitActionResult> {
  return gitAction(['commit', '-m', message], gitRoot, 'git commit');
}
