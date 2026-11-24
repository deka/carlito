import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { GitBranchInfo, GitBranchResult, GitChangedFile, GitFileStatus, GitStatusResult } from '@shared/file-types';
import { gitExec, gitExecRaw } from './git-exec';
import { isPathInsideOrEqual } from './file-operations';

export interface GitStatusContext {
  rootPath: string;
  statuses: Map<string, GitFileStatus>;
  branch?: GitBranchInfo;
}

function statusFromPorcelain(indexStatus: string, workTreeStatus: string): GitFileStatus | undefined {
  if (indexStatus === '!' || workTreeStatus === '!') return 'ignored';
  if (indexStatus === '?' || workTreeStatus === '?') return 'untracked';
  if (
    indexStatus === 'U' ||
    workTreeStatus === 'U' ||
    ['DD', 'AU', 'UD', 'UA', 'DU', 'AA'].includes(`${indexStatus}${workTreeStatus}`)
  ) {
    return 'conflict';
  }
  if (indexStatus === 'D' || workTreeStatus === 'D') return 'deleted';
  if (indexStatus === 'R' || workTreeStatus === 'R') return 'renamed';
  if (indexStatus === 'A' || workTreeStatus === 'A' || indexStatus === 'C' || workTreeStatus === 'C') {
    return 'added';
  }
  if (indexStatus === 'M' || workTreeStatus === 'M' || indexStatus === 'T' || workTreeStatus === 'T') {
    return 'modified';
  }
  return undefined;
}

/**
 * Parses the `--branch` header of `git status --porcelain=v1`:
 * `## main...origin/main [ahead 1, behind 2]`, `## No commits yet on main`,
 * `## HEAD (no branch)`.
 */
export function parseBranchHeader(header: string): GitBranchInfo {
  const line = header.replace(/^## /, '');
  const branch: GitBranchInfo = { ahead: 0, behind: 0 };
  const unborn = /^(?:No commits yet on|Initial commit on) (.+)$/.exec(line);
  if (unborn) return { ...branch, name: unborn[1] };
  if (line.startsWith('HEAD (no branch)')) return branch;

  const match = /^(.+?)(?:\.\.\.(\S+))?(?: \[(.*)\])?$/.exec(line);
  if (!match) return branch;
  branch.name = match[1];
  if (match[2]) branch.upstream = match[2];
  return { ...branch, ...parseTrack(match[3]) };
}

/** Parses git's upstream tracking summary: `ahead 1, behind 2`, `behind 5`, `gone`. */
function parseTrack(track: string | undefined): Pick<GitBranchInfo, 'ahead' | 'behind'> {
  const counts = { ahead: 0, behind: 0 };
  for (const part of track?.split(', ') ?? []) {
    const [kind, count] = part.split(' ');
    if (kind === 'ahead') counts.ahead = Number(count) || 0;
    else if (kind === 'behind') counts.behind = Number(count) || 0;
  }
  return counts;
}

/**
 * Current branch and upstream sync of the repository containing `path`. Unlike
 * `getGitStatus`, this never scans the work tree: it only reads refs, so it is
 * cheap enough for the status bar to call on every workspace change.
 */
export async function getGitBranch(path: string): Promise<GitBranchResult> {
  try {
    if ((await gitExec(['rev-parse', '--is-inside-work-tree'], path)) !== 'true') return { isGitRepo: false };
  } catch {
    return { isGitRepo: false };
  }

  let ref: string;
  try {
    ref = await gitExec(['symbolic-ref', '-q', 'HEAD'], path);
  } catch {
    return { isGitRepo: true, branch: { ahead: 0, behind: 0 } }; // detached HEAD
  }

  const branch: GitBranchInfo = { name: ref.replace(/^refs\/heads\//, ''), ahead: 0, behind: 0 };
  try {
    // Empty for an unborn branch; upstream fields are empty without an upstream.
    const [upstream, track] = (
      await gitExec(['for-each-ref', '--format=%(upstream:short)%00%(upstream:track,nobracket)', ref], path)
    ).split('\0');
    if (upstream) return { isGitRepo: true, branch: { ...branch, upstream, ...parseTrack(track) } };
  } catch {
    // Keep the branch name even if tracking info is unavailable.
  }
  return { isGitRepo: true, branch };
}

function parseGitStatus(output: string, gitRootPath: string): Omit<GitStatusContext, 'rootPath'> {
  const statuses = new Map<string, GitFileStatus>();
  let branch: GitBranchInfo | undefined;
  const entries = output.split('\0').filter(Boolean);

  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    if (entry.startsWith('## ')) {
      branch = parseBranchHeader(entry);
      continue;
    }
    if (entry.length < 4) continue;

    const status = statusFromPorcelain(entry[0]!, entry[1]!);
    if (!status) continue;

    const relativePath = entry.slice(3);
    statuses.set(join(gitRootPath, relativePath), status);

    if (entry[0] === 'R' || entry[0] === 'C') index += 1;
  }

  return { statuses, branch };
}

function normalizeGitStatusPath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/, '');
}

export function gitStatusForNode(
  path: string,
  isDirectory: boolean,
  gitStatus: GitStatusContext | undefined,
): GitFileStatus | undefined {
  const directStatus = gitStatus?.statuses.get(path);
  if (directStatus || !isDirectory || !gitStatus) return directStatus;

  const directoryPrefix = `${normalizeGitStatusPath(path)}/`;
  let descendantStatus: GitFileStatus | undefined;

  for (const [changedPath, changedStatus] of gitStatus.statuses) {
    if (changedStatus === 'ignored' || !normalizeGitStatusPath(changedPath).startsWith(directoryPrefix)) {
      continue;
    }

    if (!descendantStatus || gitStatusOrder[changedStatus] < gitStatusOrder[descendantStatus]) {
      descendantStatus = changedStatus;
      if (descendantStatus === 'conflict') break;
    }
  }

  return descendantStatus;
}

export async function getGitStatusContext(path: string): Promise<GitStatusContext | undefined> {
  try {
    const gitRootPath = await gitExec(['rev-parse', '--show-toplevel'], path);
    const status = await gitExecRaw(
      ['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all', '--ignored=matching'],
      gitRootPath,
    );
    return { rootPath: gitRootPath, ...parseGitStatus(status, gitRootPath) };
  } catch {
    return undefined;
  }
}

const gitStatusOrder: Record<GitFileStatus, number> = {
  conflict: 0,
  modified: 1,
  added: 2,
  deleted: 3,
  renamed: 4,
  untracked: 5,
  ignored: 6,
};

export async function getGitStatus(path: string): Promise<GitStatusResult> {
  const context = await getGitStatusContext(path);
  if (!context) return { isGitRepo: false, files: [] };
  const files: GitChangedFile[] = [...context.statuses.entries()]
    .filter(
      ([changedPath, status]) =>
        status !== 'ignored' && isPathInsideOrEqual(changedPath, path),
    )
    .map(([changedPath, status]) => ({
      path: changedPath,
      uri: pathToFileURL(changedPath).toString(),
      relativePath: relative(path, changedPath),
      status,
    }))
    .sort(
      (a, b) =>
        gitStatusOrder[a.status] - gitStatusOrder[b.status] ||
        a.relativePath.localeCompare(b.relativePath),
    );
  return { isGitRepo: true, rootPath: path, branch: context.branch, files };
}
