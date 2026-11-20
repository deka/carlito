import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitPullResult } from '@shared/file-types';

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
 * Run a non-interactive fast-forward-only `git pull`. Never prompts for
 * credentials or opens an editor; fails instead so the UI can show the error.
 */
export async function gitPull(cwd: string): Promise<GitPullResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', ['pull', '--ff-only', '--no-edit'], {
      cwd,
      maxBuffer: 20 * 1024 * 1024,
      timeout: 120_000,
      env: {
        ...process.env,
        GIT_TERMINAL_PROMPT: '0',
      },
    });
    return { ok: true, output: stdout.trim() || stderr.trim() };
  } catch (error) {
    const failure = error as { stderr?: string; stdout?: string; killed?: boolean; message?: string };
    if (failure.killed) return { ok: false, output: 'git pull timed out.' };
    const output = failure.stderr?.trim() || failure.stdout?.trim() || failure.message || String(error);
    return { ok: false, output };
  }
}
