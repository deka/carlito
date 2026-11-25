import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitActionResult, GitPullResult } from '@shared/file-types';

const execFileAsync = promisify(execFile);

/**
 * Run a git command and return stdout with trailing whitespace trimmed.
 */
export async function gitExec(args: string[], cwd: string): Promise<string> {
  return (await gitExecRaw(args, cwd)).trimEnd();
}

/**
 * Run a git command and return stdout as-is (untrimmed).
 */
export async function gitExecRaw(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, maxBuffer: 20 * 1024 * 1024 });
  return stdout;
}

/**
 * Run a git command that changes the repository and report its outcome instead
 * of throwing. Never prompts for credentials or opens an editor; fails instead
 * so the UI can show the error.
 */
export async function gitAction(args: string[], cwd: string, label: string): Promise<GitActionResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
        GIT_EDITOR: 'true',
      },
    });
    return { ok: true, output: stdout.trim() || stderr.trim() };
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; killed?: boolean; message?: string };
    if (failure.killed) return { ok: false, output: `${label} timed out.` };
    const output = failure.stderr?.trim() || failure.stdout?.trim() || failure.message || String(error);
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
    : ['--literal-pathspecs', 'rm', '-r', '-q', '-f', '--cached', '--ignore-unmatch', '--', ...paths];
  return gitAction(args, gitRoot, 'git reset');
}

/** Commit the index with the given message (passed as an argument, never through a shell). */
export function gitCommit(gitRoot: string, message: string): Promise<GitActionResult> {
  return gitAction(['commit', '-m', message], gitRoot, 'git commit');
}
