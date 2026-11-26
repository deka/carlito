import { useCallback, useState } from 'react';
import { runCommand } from '../commands/registry';
import { useContextMenuDismiss } from '../hooks/useContextMenuDismiss';
import { useRecentWorkspaces } from '../hooks/useRecentWorkspaces';
import { useEditorStore } from '../store/useEditorStore';
import { openRecentWorkspace } from '../utils/recentWorkspaces';

const maxRecentShown = 8;
const viewportMargin = 4;

/** Activity bar button (bottom) opening the workspace menu: command palette, folders, recents, settings. */
export function WorkspaceMenuButton() {
  const workspaceName = useEditorStore((state) => state.workspace?.name);
  const [anchor, setAnchor] = useState<{ left: number; bottom: number } | null>(null);
  const close = useCallback(() => setAnchor(null), []);
  useContextMenuDismiss(anchor !== null, close);

  return (
    <>
      <button
        className={`activity-bar-button ${anchor ? 'active' : ''}`}
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          if (anchor) {
            close();
            return;
          }
          const rect = event.currentTarget.getBoundingClientRect();
          setAnchor({ left: rect.right + 6, bottom: Math.max(viewportMargin, window.innerHeight - rect.bottom) });
        }}
        title={workspaceName ? `Workspace: ${workspaceName}` : 'No folder open'}
        aria-label="Workspace menu"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M5 7h14M5 12h14M5 17h14" />
        </svg>
        <span className={`workspace-status ${workspaceName ? 'ready' : ''}`} aria-hidden="true" />
      </button>
      {anchor ? <WorkspaceMenu left={anchor.left} bottom={anchor.bottom} onClose={close} /> : null}
    </>
  );
}

/**
 * Anchored by its bottom edge to the button's bottom, so it grows upward as the
 * recent list loads instead of overflowing the bottom of the window.
 */
function WorkspaceMenu({ left, bottom, onClose }: { left: number; bottom: number; onClose: () => void }) {
  const workspace = useEditorStore((state) => state.workspace);
  const recent = useRecentWorkspaces();
  const entries = recent.filter((entry) => entry.path !== workspace?.rootPath).slice(0, maxRecentShown);
  const current = workspace ? recent.find((entry) => entry.path === workspace.rootPath) : undefined;

  const run = (action: () => unknown) => {
    onClose();
    void action();
  };

  return (
    <div
      className="workspace-menu"
      role="menu"
      style={{ left, bottom, maxHeight: `calc(100vh - ${bottom + viewportMargin}px)` }}
      onClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <div className="workspace-menu-header">
        <strong>{workspace?.name ?? 'No folder open'}</strong>
        {workspace ? <small>{current?.displayPath ?? workspace.rootPath}</small> : null}
      </div>
      <div className="workspace-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => runCommand('workbench.action.showCommands'))}>
        <span>Command Palette…</span>
        <kbd>Ctrl Shift P</kbd>
      </button>
      <div className="workspace-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => runCommand('workspace.openFolder'))}>
        <span>Open Folder…</span>
        <kbd>Ctrl K</kbd>
      </button>
      {entries.length > 0 ? (
        <>
          <div className="workspace-menu-label">Recent</div>
          {entries.map((entry) => (
            <button
              key={entry.path}
              type="button"
              role="menuitem"
              className="workspace-menu-recent"
              title={entry.path}
              onClick={() => run(() => openRecentWorkspace(entry.path))}
            >
              <span>{entry.name}</span>
              <small>{entry.displayPath}</small>
            </button>
          ))}
        </>
      ) : null}
      <button
        type="button"
        role="menuitem"
        disabled={recent.length === 0}
        onClick={() => run(() => window.api.workspace.recent.clear())}
      >
        <span>Clear Recently Opened</span>
      </button>
      <div className="workspace-menu-separator" />
      <button type="button" role="menuitem" onClick={() => run(() => runCommand('preferences.openSettings'))}>
        <span>Settings</span>
        <kbd>Ctrl ,</kbd>
      </button>
    </div>
  );
}
