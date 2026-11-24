import type { GitBranchInfo } from '@shared/file-types';

export function sameBranch(a: GitBranchInfo | undefined, b: GitBranchInfo | undefined): boolean {
  return a?.name === b?.name && a?.upstream === b?.upstream && a?.ahead === b?.ahead && a?.behind === b?.behind;
}

export function branchDisplayName(branch: GitBranchInfo): string {
  return branch.name ?? 'detached HEAD';
}

/** `↑1 ↓2`, or an empty string when in sync with (or without) an upstream. */
export function branchSyncLabel(branch: GitBranchInfo): string {
  return [branch.ahead ? `↑${branch.ahead}` : '', branch.behind ? `↓${branch.behind}` : ''].filter(Boolean).join(' ');
}

export function branchTitle(branch: GitBranchInfo): string {
  const name = branch.name ? `Branch ${branch.name}` : 'Detached HEAD';
  if (!branch.upstream) return `${name} (no upstream)`;
  const sync =
    branch.ahead || branch.behind
      ? `${branch.ahead} ahead, ${branch.behind} behind ${branch.upstream}`
      : `up to date with ${branch.upstream}`;
  return `${name}, ${sync}`;
}
