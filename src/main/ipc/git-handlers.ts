import { ipcMain, type BrowserWindow } from 'electron';
import { basename, dirname, isAbsolute, join, normalize, relative } from 'node:path';
import { IPC } from '@shared/ipc';
import type {
  GitActionResult,
  GitBaselineResult,
  GitBranchResult,
  GitCommitRequest,
  GitPathsRequest,
  GitPullResult,
  GitStatusResult,
} from '@shared/file-types';
import { gitCommit, gitExec, gitExecRaw, gitPull, gitPush, gitStage, gitUnstage } from './git-exec';
import { getGitBranch, getGitStatus } from './git-status';
import { isPathInsideOrEqual } from './file-operations';
import { authorizeWindowPath, windowFromEvent } from './workspace-state';

const maxPathsPerRequest = 10_000;

async function gitRootFor(win: BrowserWindow, rootPath: string): Promise<string | undefined> {
  const authorizedRoot = await authorizeWindowPath(win, rootPath);
  try {
    return await gitExec(['rev-parse', '--show-toplevel'], authorizedRoot);
  } catch {
    return undefined;
  }
}

/**
 * Authorize every renderer-provided path for this window. The parent directory
 * is resolved rather than the path itself so deleted files (staging a removal)
 * and tracked symlinks (which must not be followed to their target) both work.
 */
async function authorizeRepoPaths(win: BrowserWindow, gitRoot: string, paths: unknown): Promise<string[]> {
  if (!Array.isArray(paths) || paths.length === 0) throw new Error('Expected a non-empty list of paths.');
  if (paths.length > maxPathsPerRequest) {
    throw new Error(`Too many files at once (more than ${maxPathsPerRequest}); stage them by folder instead.`);
  }
  return Promise.all(
    paths.map(async (path: unknown) => {
      if (typeof path !== 'string' || !isAbsolute(path)) throw new Error('Expected absolute paths.');
      const normalizedPath = normalize(path);
      const name = basename(normalizedPath);
      if (!name || name === '..' || name === '.git') throw new Error(`Invalid path: ${path}`);
      const parent = await authorizeWindowPath(win, dirname(normalizedPath), { allowMissing: true });
      const authorizedPath = join(parent, name);
      if (authorizedPath === gitRoot || !isPathInsideOrEqual(authorizedPath, gitRoot)) {
        throw new Error(`Path is outside the repository: ${path}`);
      }
      return authorizedPath;
    }),
  );
}

async function runOnPaths(
  win: BrowserWindow,
  request: GitPathsRequest,
  run: (gitRoot: string, paths: string[]) => Promise<GitActionResult>,
): Promise<GitActionResult> {
  const gitRoot = await gitRootFor(win, request?.rootPath);
  if (!gitRoot) return { ok: false, output: 'This folder is not a git repository.' };
  return run(gitRoot, await authorizeRepoPaths(win, gitRoot, request.paths));
}

async function resolveBaselineContent(path: string): Promise<GitBaselineResult> {
  const cwd = dirname(path);
  const rootPath = await gitExec(['rev-parse', '--show-toplevel'], cwd);
  const relativePath = relative(rootPath, path);

  try {
    await gitExec(['ls-files', '--error-unmatch', '--', relativePath], rootPath);
  } catch {
    return { isGitRepo: true, tracked: false, rootPath, content: '' };
  }

  try {
    const content = await gitExecRaw(['show', `HEAD:${relativePath}`], rootPath);
    return { isGitRepo: true, tracked: true, rootPath, content };
  } catch (error) {
    return {
      isGitRepo: true,
      tracked: true,
      rootPath,
      content: '',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function registerGitHandlers(): void {
  ipcMain.handle(
    IPC.gitStatus,
    async (event, { rootPath }: { rootPath: string }): Promise<GitStatusResult> =>
      getGitStatus(await authorizeWindowPath(windowFromEvent(event), rootPath)),
  );

  ipcMain.handle(
    IPC.gitBranch,
    async (event, { rootPath }: { rootPath: string }): Promise<GitBranchResult> =>
      getGitBranch(await authorizeWindowPath(windowFromEvent(event), rootPath)),
  );

  ipcMain.handle(
    IPC.gitPull,
    async (event, { rootPath }: { rootPath: string }): Promise<GitPullResult> =>
      gitPull(await authorizeWindowPath(windowFromEvent(event), rootPath)),
  );

  ipcMain.handle(
    IPC.gitPush,
    async (event, { rootPath }: { rootPath: string }): Promise<GitActionResult> =>
      gitPush(await authorizeWindowPath(windowFromEvent(event), rootPath)),
  );

  ipcMain.handle(
    IPC.gitStage,
    async (event, request: GitPathsRequest): Promise<GitActionResult> =>
      runOnPaths(windowFromEvent(event), request, gitStage),
  );

  ipcMain.handle(
    IPC.gitUnstage,
    async (event, request: GitPathsRequest): Promise<GitActionResult> =>
      runOnPaths(windowFromEvent(event), request, gitUnstage),
  );

  ipcMain.handle(
    IPC.gitCommit,
    async (event, request: GitCommitRequest): Promise<GitActionResult> => {
      const message = request?.message;
      if (typeof message !== 'string' || !message.trim()) {
        return { ok: false, output: 'Enter a commit message.' };
      }
      const gitRoot = await gitRootFor(windowFromEvent(event), request.rootPath);
      if (!gitRoot) return { ok: false, output: 'This folder is not a git repository.' };
      return gitCommit(gitRoot, message);
    },
  );

  ipcMain.handle(
    IPC.gitBaseline,
    async (event, { path }: { path: string }): Promise<GitBaselineResult> => {
      const authorizedPath = await authorizeWindowPath(windowFromEvent(event), path);
      try {
        return await resolveBaselineContent(authorizedPath);
      } catch {
        return { isGitRepo: false, tracked: false };
      }
    },
  );
}
