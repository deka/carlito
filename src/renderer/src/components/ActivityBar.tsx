import { runCommand } from '../commands/registry';
import { useGitDialogStore } from '../store/useGitDialogStore';
import { useSearchStore } from '../store/useSearchStore';
import { useWorkbenchUiStore } from '../store/useWorkbenchUiStore';
import { WorkspaceMenuButton } from './WorkspaceMenu';

const icons = {
  quickOpen: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12.5 19.25H6.75a2 2 0 0 1-2-2V6.75a2 2 0 0 1 2-2h6l4.5 4.5v1.5" />
      <path d="M12.75 4.75v4.5h4.5" />
      <circle cx="15.5" cy="15.5" r="2.75" />
      <path d="m17.5 17.5 2 2" />
    </svg>
  ),
  explorer: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4.75 4.75h5.5l1.5 2h7.5v12.5H4.75z" />
      <path d="M8 11h8M8 14.5h6" />
    </svg>
  ),
  search: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="10.5" cy="10.5" r="5.75" />
      <path d="m15 15 4.25 4.25" />
    </svg>
  ),
  branch: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="7" cy="5.5" r="2" />
      <circle cx="17" cy="8.5" r="2" />
      <circle cx="7" cy="18.5" r="2" />
      <path d="M7 7.5v9M9 13c4.5 0 8-1.2 8-2.5" />
    </svg>
  ),
  terminal: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.75" y="5" width="16.5" height="14" rx="2.25" />
      <path d="m7.5 10 2.5 2.25-2.5 2.25M12 15h4.5" />
    </svg>
  ),
};

export function ActivityBar() {
  const sidebarVisible = useWorkbenchUiStore((state) => state.sidebarVisible);
  const sidebarView = useWorkbenchUiStore((state) => state.sidebarView);
  const explorerActive = sidebarVisible && sidebarView === 'explorer';
  const searchActive = sidebarVisible && sidebarView === 'search';
  const gitDialogOpen = useGitDialogStore((state) => state.isOpen);

  return (
    <nav className="activity-bar" aria-label="Activity Bar">
      <div className="activity-bar-primary">
        <button
          className="activity-bar-button"
          type="button"
          onClick={() => void runCommand('workbench.action.quickOpen')}
          title="Go to File (Ctrl+P)"
          aria-label="Go to File"
        >
          {icons.quickOpen}
        </button>
        <button
          className={`activity-bar-button ${explorerActive ? 'active' : ''}`}
          type="button"
          onClick={() => useWorkbenchUiStore.getState().toggleSidebarView('explorer')}
          title="Explorer (Ctrl+Shift+E)"
          aria-label="Toggle Explorer"
          aria-pressed={explorerActive}
        >
          {icons.explorer}
        </button>
        <button
          className={`activity-bar-button ${searchActive ? 'active' : ''}`}
          type="button"
          onClick={() => {
            useWorkbenchUiStore.getState().toggleSidebarView('search');
            if (!searchActive) useSearchStore.getState().requestFocus('query');
          }}
          title="Search (Ctrl+Shift+F)"
          aria-label="Toggle Search"
          aria-pressed={searchActive}
        >
          {icons.search}
        </button>
        <button
          className={`activity-bar-button ${gitDialogOpen ? 'active' : ''}`}
          type="button"
          onClick={() => void runCommand('workbench.panel.git.toggle')}
          title="Source Control (Ctrl+Shift+G)"
          aria-label="Toggle Source Control"
          aria-pressed={gitDialogOpen}
        >
          {icons.branch}
        </button>
        <button
          className="activity-bar-button"
          type="button"
          onClick={() => void runCommand('workbench.action.terminal.new')}
          title="New Terminal (Ctrl+Shift+T)"
          aria-label="New Terminal"
        >
          {icons.terminal}
        </button>
      </div>
      <div className="activity-bar-secondary">
        <WorkspaceMenuButton />
      </div>
    </nav>
  );
}
