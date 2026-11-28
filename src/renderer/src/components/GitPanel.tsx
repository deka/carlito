import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWorkspaceChangeDebounce } from '../hooks/useWorkspaceChangeDebounce';
import type { GitBranchInfo, GitChangedFile, GitFileStatus } from '@shared/file-types';
import { useEditorStore } from '../store/useEditorStore';
import { GitFileList, type GitFileSection } from './GitFileList';
import { statusLabels } from '../git/gitStatusMaps';
import { branchDisplayName, branchSyncLabel, branchTitle, sameBranch } from '../git/gitBranch';
import { useGitBranchStore } from '../store/useGitBranchStore';
import { GitBranchIcon } from './GitBranchIcon';
import { openGitChanges } from '../git/diffTabs';

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
// sidebar view is shown, so this lets it reappear with the previous list instead of
// flashing "Loading changes…" while git status runs again.
const lastStateByRoot = new Map<string, GitPanelState>();

function cachedState(rootPath: string | undefined): GitPanelState {
  return (rootPath && lastStateByRoot.get(rootPath)) || initialState;
}

// Draft commit message per workspace root, kept across remounts.
const draftMessageByRoot = new Map<string, string>();

function sameFiles(a: GitChangedFile[], b: GitChangedFile[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((file, index) => {
    const other = b[index]!;
    return (
      file.path === other.path &&
      file.status === other.status &&
      file.staged === other.staged &&
      file.unstaged === other.unstaged &&
      file.originalPath === other.originalPath
    );
  });
}

type GitBusyAction = 'pull' | 'push' | 'stage' | 'unstage' | 'commit';

/** Paths to hand to git for a file: unstaging a rename must also restore its source path. */
function actionPaths(files: GitChangedFile[], section: GitFileSection): string[] {
  const paths = new Set<string>();
  for (const file of files) {
    paths.add(file.path);
    if (section === 'staged' && file.originalPath) paths.add(file.originalPath);
  }
  return [...paths];
}

interface GitSectionProps {
  title: string;
  section: GitFileSection;
  files: GitChangedFile[];
  disabled: boolean;
  onAction: (files: GitChangedFile[], section: GitFileSection) => void;
  onOpen: (file: GitChangedFile) => void;
}

function GitSection({ title, section, files, disabled, onAction, onOpen }: GitSectionProps) {
  const allTitle = section === 'staged' ? 'Unstage all changes' : 'Stage all changes';
  return (
    <div className="git-panel-section">
      <div className="git-panel-section-header">
        <span className="git-panel-section-title">{title}</span>
        <span className="git-panel-section-count">{files.length}</span>
        <button
          className="git-panel-action git-panel-section-action"
          type="button"
          onClick={() => onAction(files, section)}
          disabled={disabled}
          title={allTitle}
          aria-label={allTitle}
        >
          {section === 'staged' ? '−' : '+'}
        </button>
      </div>
      <GitFileList
        files={files}
        section={section}
        disabled={disabled}
        onAction={(selected) => onAction(selected, section)}
        onOpen={onOpen}
      />
    </div>
  );
}

const headerIcons = {
  pull: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v8M4.5 7 8 10.5 11.5 7M3 13.5h10" /></svg>
  ),
  push: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13.5v-8M4.5 9 8 5.5 11.5 9M3 2.5h10" /></svg>
  ),
};

const openFile = (file: GitChangedFile) => openGitChanges(file.path);

/** Source Control sidebar view: changed files as a folder tree, stage/unstage, commit, pull and push. */
export function GitPanel() {
  const rootPath = useEditorStore((state) => state.workspace?.rootPath);

  const [state, setState] = useState<GitPanelState>(() => cachedState(rootPath));
  const [busy, setBusy] = useState<GitBusyAction | null>(null);
  const [actionMessage, setActionMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [draft, setDraftState] = useState(() => (rootPath && draftMessageByRoot.get(rootPath)) || '');
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

  const stagedFiles = useMemo(() => files.filter((file) => file.staged), [files]);
  const unstagedFiles = useMemo(() => files.filter((file) => file.unstaged), [files]);

  const setDraft = useCallback(
    (message: string) => {
      setDraftState(message);
      if (!rootPath) return;
      if (message) draftMessageByRoot.set(rootPath, message);
      else draftMessageByRoot.delete(rootPath);
    },
    [rootPath],
  );

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
      useGitBranchStore.getState().setBranch(rootPath, { ...result, changedFiles: result.files.length });
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
    setActionMessage(null);
    setDraftState((rootPath && draftMessageByRoot.get(rootPath)) || '');
    void refresh();
  }, [rootPath, refresh]);

  const debouncedRefresh = useCallback(() => void refresh(), [refresh]);
  useWorkspaceChangeDebounce(rootPath, debouncedRefresh, 180);

  // Runs one git action at a time (they would collide on .git/index.lock),
  // reports failures inline and refreshes the status afterwards.
  const runAction = useCallback(
    async (
      action: GitBusyAction,
      run: (root: string) => Promise<{ ok: boolean; output: string }>,
      options: { showSuccess?: boolean; onSuccess?: () => void } = {},
    ): Promise<void> => {
      if (!rootPath || busy) return;
      setBusy(action);
      setActionMessage(null);
      try {
        const result = await run(rootPath);
        // The user switched workspace meanwhile: the result is for another folder.
        if (rootPathRef.current !== rootPath) return;
        if (result.ok) options.onSuccess?.();
        if (!result.ok || options.showSuccess) {
          setActionMessage({ ok: result.ok, text: result.output || (result.ok ? `git ${action} complete.` : `git ${action} failed.`) });
        }
      } catch (actionError) {
        if (rootPathRef.current !== rootPath) return;
        setActionMessage({ ok: false, text: actionError instanceof Error ? actionError.message : `git ${action} failed.` });
      } finally {
        setBusy(null);
      }
      if (rootPathRef.current === rootPath) void refresh();
    },
    [rootPath, busy, refresh],
  );

  const pull = useCallback(
    () => runAction('pull', (root) => window.api.git.pull(root), { showSuccess: true }),
    [runAction],
  );
  const push = useCallback(
    () => runAction('push', (root) => window.api.git.push(root), { showSuccess: true }),
    [runAction],
  );

  const stageOrUnstage = useCallback(
    (selected: GitChangedFile[], section: GitFileSection) => {
      const paths = actionPaths(selected, section);
      if (paths.length === 0) return;
      void runAction(section === 'staged' ? 'unstage' : 'stage', (root) =>
        section === 'staged'
          ? window.api.git.unstage({ rootPath: root, paths })
          : window.api.git.stage({ rootPath: root, paths }),
      );
    },
    [runAction],
  );

  const canCommit = Boolean(draft.trim()) && stagedFiles.length > 0 && !busy;
  const commit = useCallback(() => {
    if (!canCommit) return;
    const message = draft;
    void runAction('commit', (root) => window.api.git.commit({ rootPath: root, message }), {
      showSuccess: true,
      onSuccess: () => setDraft(''),
    });
  }, [canCommit, draft, runAction, setDraft]);

  const loading = Boolean(rootPath) && !hasFetched;

  return (
    <aside className="git-panel" aria-label="Source Control">
      <div className="file-tree-header">
        <div className="file-tree-heading">
          <span className="file-tree-eyebrow">Source Control</span>
        </div>
        <div className="file-tree-header-actions">
          <button
            className={busy === 'pull' ? 'busy' : undefined}
            type="button"
            onClick={() => void pull()}
            disabled={!rootPath || !isGitRepo || Boolean(busy)}
            title={busy === 'pull' ? 'Pulling…' : 'Pull from upstream (fast-forward only)'}
            aria-label="Pull"
          >
            {headerIcons.pull}
          </button>
          <button
            className={busy === 'push' ? 'busy' : undefined}
            type="button"
            onClick={() => void push()}
            disabled={!rootPath || !isGitRepo || Boolean(busy)}
            title={busy === 'push' ? 'Pushing…' : 'Push the current branch to its upstream'}
            aria-label="Push"
          >
            {headerIcons.push}
          </button>
        </div>
      </div>
      <div className="git-panel-body">
        {rootPath && hasFetched && !error && isGitRepo ? (
          <div className="git-panel-overview">
            {branch ? <GitBranchLabel branch={branch} /> : null}
            <div className="git-panel-summary">
              {files.length} changed file{files.length === 1 ? '' : 's'}
              {[...counts.entries()].map(([status, count]) => (
                <span className={`git-panel-count git-${status}`} key={status}>{statusLabels[status]} {count}</span>
              ))}
            </div>
          </div>
        ) : null}
        {rootPath && hasFetched && !error && isGitRepo ? (
          <div className="git-panel-commit">
            <textarea
              className="git-panel-commit-message"
              value={draft}
              placeholder="Commit message (Ctrl+Enter to commit)"
              aria-label="Commit message"
              rows={3}
              spellCheck={false}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  commit();
                }
              }}
            />
            <button
              className="git-panel-commit-button"
              type="button"
              onClick={commit}
              disabled={!canCommit}
              title={stagedFiles.length === 0 ? 'Stage changes to commit them' : 'Commit staged changes (Ctrl+Enter)'}
            >
              {busy === 'commit' ? 'Committing…' : 'Commit'}
            </button>
          </div>
        ) : null}
        {actionMessage ? (
          <div className={`git-panel-pull-message${actionMessage.ok ? '' : ' git-panel-error'}`} role="status">
            <pre>{actionMessage.text}</pre>
            <button type="button" onClick={() => setActionMessage(null)} title="Dismiss">×</button>
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
        {rootPath && hasFetched && !error && stagedFiles.length > 0 ? (
          <GitSection
            title="Staged Changes"
            section="staged"
            files={stagedFiles}
            disabled={Boolean(busy)}
            onAction={stageOrUnstage}
            onOpen={openFile}
          />
        ) : null}
        {rootPath && hasFetched && !error && unstagedFiles.length > 0 ? (
          <GitSection
            title="Changes"
            section="unstaged"
            files={unstagedFiles}
            disabled={Boolean(busy)}
            onAction={stageOrUnstage}
            onOpen={openFile}
          />
        ) : null}
      </div>
    </aside>
  );
}
