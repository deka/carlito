import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceChangeDebounce } from '../hooks/useWorkspaceChangeDebounce';
import type { GitBranchInfo, GitChangedFile, GitFileStatus } from '@shared/file-types';
import { useEditorStore } from '../store/useEditorStore';
import { useBottomPanelStore } from '../store/useBottomPanelStore';
import { GitFileList } from './GitFileList';
import { statusLabels } from '../git/gitStatusMaps';
import { branchDisplayName, branchSyncLabel, branchTitle, sameBranch } from '../git/gitBranch';
import { useGitBranchStore } from '../store/useGitBranchStore';
import { GitBranchIcon } from './GitBranchIcon';

function GitBranchLabel({ branch }: { branch: GitBranchInfo }) {
  const sync = branchSyncLabel(branch);
  return (
    <span className="git-panel-branch" title={branchTitle(branch)}>
      <GitBranchIcon />
      <span className="git-panel-branch-name">{branchDisplayName(branch)}</span>
      {sync ? <span className="git-panel-branch-sync">{sync}</span> : null}
    </span>
  );
}

interface GitPanelState {
  files: GitChangedFile[];
  branch?: GitBranchInfo;
  isGitRepo: boolean;
  hasFetched: boolean;
  error: string | null;
}

const initialState: GitPanelState = { files: [], isGitRepo: false, hasFetched: false, error: null };

// Last known status per workspace root. The panel is unmounted whenever another
// bottom-panel tab is shown, so this lets it reappear with the previous list
// instead of flashing "Loading changes…" while git status runs again.
const lastStateByRoot = new Map<string, GitPanelState>();

function cachedState(rootPath: string | undefined): GitPanelState {
  return (rootPath && lastStateByRoot.get(rootPath)) || initialState;
}

function sameFiles(a: GitChangedFile[], b: GitChangedFile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((file, index) => file.path === b[index]!.path && file.status === b[index]!.status);
}

export function GitPanel() {
  const rootPath = useEditorStore((state) => state.workspace?.rootPath);
  const closeGitPanel = useCallback(() => useBottomPanelStore.getState().closePanel(), []);

  const [state, setState] = useState<GitPanelState>(() => cachedState(rootPath));
  const [pulling, setPulling] = useState(false);
  const [pullMessage, setPullMessage] = useState<{ ok: boolean; text: string } | null>(null);
  // Monotonic id so a slow, outdated status response never overwrites a newer one.
  const requestIdRef = useRef(0);
  const rootPathRef = useRef(rootPath);
  rootPathRef.current = rootPath;

  const { files, branch, isGitRepo, hasFetched, error } = state;

  const counts = useMemo(() => {
    const result = new Map<GitFileStatus, number>();
    for (const file of files) result.set(file.status, (result.get(file.status) ?? 0) + 1);
    return result;
  }, [files]);

  // Background refreshes keep the current list on screen (no "Loading…" swap)
  // and skip the state update entirely when nothing changed, so the panel does
  // not blink on every workspace change event.
  const refresh = useCallback(async (): Promise<void> => {
    const requestId = ++requestIdRef.current;
    if (!rootPath) {
      setState({ ...initialState, hasFetched: true });
      return;
    }
    try {
      const result = await window.api.git.status(rootPath);
      if (requestId !== requestIdRef.current) return;
      // Same answer as the status bar's lighter query: keep both in step.
      useGitBranchStore.getState().setBranch(rootPath, result);
      setState((prev) => {
        if (
          prev.hasFetched &&
          !prev.error &&
          prev.isGitRepo === result.isGitRepo &&
          sameBranch(prev.branch, result.branch) &&
          sameFiles(prev.files, result.files)
        ) {
          return prev;
        }
        const next = {
          files: result.files,
          branch: result.branch,
          isGitRepo: result.isGitRepo,
          hasFetched: true,
          error: null,
        };
        lastStateByRoot.set(rootPath, next);
        return next;
      });
    } catch (refreshError) {
      if (requestId !== requestIdRef.current) return;
      console.error(refreshError);
      const message = refreshError instanceof Error ? refreshError.message : 'Could not load git status';
      setState((prev) => (prev.error === message && prev.hasFetched ? prev : { ...prev, hasFetched: true, error: message }));
    }
  }, [rootPath]);

  // Full reset + refresh whenever the active workspace changes (covers initial
  // mount as well as switching to a different folder).
  useEffect(() => {
    setState(cachedState(rootPath));
    setPullMessage(null);
    void refresh();
  }, [rootPath, refresh]);

  const debouncedRefresh = useCallback(() => void refresh(), [refresh]);
  useWorkspaceChangeDebounce(rootPath, debouncedRefresh, 180);

  const pull = useCallback(async (): Promise<void> => {
    if (!rootPath || pulling) return;
    setPulling(true);
    setPullMessage(null);
    try {
      const result = await window.api.git.pull(rootPath);
      // The user switched workspace while pulling: the result is for another folder.
      if (rootPathRef.current !== rootPath) return;
      setPullMessage({ ok: result.ok, text: result.output || (result.ok ? 'Pull complete.' : 'git pull failed.') });
    } catch (pullError) {
      if (rootPathRef.current !== rootPath) return;
      setPullMessage({ ok: false, text: pullError instanceof Error ? pullError.message : 'git pull failed.' });
    } finally {
      setPulling(false);
    }
    if (rootPathRef.current === rootPath) void refresh();
  }, [rootPath, pulling, refresh]);

  const loading = Boolean(rootPath) && !hasFetched;

  return (
    <section className="git-panel" aria-label="Git changes">
      <header className="git-panel-header">
        <div className="git-panel-title">Source Control</div>
        {isGitRepo && branch ? <GitBranchLabel branch={branch} /> : null}
        <div className="git-panel-summary">
          {files.length} changed file{files.length === 1 ? '' : 's'}
          {[...counts.entries()].map(([status, count]) => (
            <span className={`git-panel-count git-${status}`} key={status}>{statusLabels[status]} {count}</span>
          ))}
        </div>
        <button
          className="git-panel-pull"
          type="button"
          onClick={() => void pull()}
          disabled={!rootPath || !isGitRepo || pulling}
          title="Pull from upstream (fast-forward only)"
        >
          {pulling ? 'Pulling…' : 'Pull'}
        </button>
        <button className="git-panel-close" type="button" onClick={closeGitPanel} title="Close Source Control">
          ×
        </button>
      </header>
      <div className="git-panel-body">
        {pullMessage ? (
          <div className={`git-panel-pull-message${pullMessage.ok ? '' : ' git-panel-error'}`} role="status">
            <pre>{pullMessage.text}</pre>
            <button type="button" onClick={() => setPullMessage(null)} title="Dismiss">×</button>
          </div>
        ) : null}
        {!rootPath ? <div className="git-panel-empty">Open a folder to show source control.</div> : null}
        {loading ? <div className="git-panel-empty">Loading changes…</div> : null}
        {rootPath && hasFetched && error ? <div className="git-panel-empty git-panel-error">{error}</div> : null}
        {rootPath && hasFetched && !error && !isGitRepo ? (
          <div className="git-panel-empty">This folder is not a git repository.</div>
        ) : null}
        {rootPath && hasFetched && !error && isGitRepo && files.length === 0 ? (
          <div className="git-panel-empty">No changes.</div>
        ) : null}
        {rootPath && hasFetched && !error && files.length > 0 ? <GitFileList files={files} /> : null}
      </div>
    </section>
  );
}
