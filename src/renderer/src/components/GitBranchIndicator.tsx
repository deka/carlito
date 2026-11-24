import { useCallback, useEffect } from 'react';
import { branchDisplayName, branchSyncLabel, branchTitle } from '../git/gitBranch';
import { useWorkspaceChangeDebounce } from '../hooks/useWorkspaceChangeDebounce';
import { useBottomPanelStore } from '../store/useBottomPanelStore';
import { useEditorStore } from '../store/useEditorStore';
import { useGitBranchStore } from '../store/useGitBranchStore';
import { GitBranchIcon } from './GitBranchIcon';

/** Keeps the branch store in step with the workspace: on open, on file/.git changes and on window focus. */
function useGitBranchSync(rootPath: string | undefined): void {
  const refresh = useCallback(() => {
    if (rootPath) void useGitBranchStore.getState().refresh(rootPath);
  }, [rootPath]);

  useEffect(() => {
    if (!rootPath) {
      useGitBranchStore.getState().clear();
      return;
    }
    refresh();
    // A checkout or fetch from an external terminal is picked up when coming back.
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [rootPath, refresh]);

  useWorkspaceChangeDebounce(rootPath, refresh, 300);
}

/** Status bar branch name; rendered only when the workspace is a git repository. */
export function GitBranchIndicator() {
  const rootPath = useEditorStore((state) => state.workspace?.rootPath);
  useGitBranchSync(rootPath);
  const branch = useGitBranchStore((state) =>
    state.rootPath === rootPath && state.isGitRepo ? state.branch : undefined,
  );
  if (!branch) return null;

  const sync = branchSyncLabel(branch);
  return (
    <button
      className="status-item status-button status-git-branch"
      type="button"
      onClick={() => useBottomPanelStore.getState().togglePanel('git')}
      title={`${branchTitle(branch)} — Toggle Source Control`}
    >
      <GitBranchIcon />
      <span className="status-git-branch-name">{branchDisplayName(branch)}</span>
      {sync ? <span className="status-git-branch-sync">{sync}</span> : null}
    </button>
  );
}
