import { runCommand } from '../commands/registry';
import { useBottomPanelStore } from '../store/useBottomPanelStore';
import { useWorkbenchUiStore } from '../store/useWorkbenchUiStore';

const icons = {
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
  settings: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <circle cx="12" cy="12" r="3" />
      <path d="M12 3.75v2M12 18.25v2M3.75 12h2M18.25 12h2M6.17 6.17l1.42 1.42M16.41 16.41l1.42 1.42M17.83 6.17l-1.42 1.42M7.59 16.41l-1.42 1.42" />
    </svg>
  ),
};

export function ActivityBar() {
  const sidebarVisible = useWorkbenchUiStore((state) => state.sidebarVisible);
  const toggleSidebar = useWorkbenchUiStore((state) => state.toggleSidebar);
  const activePanel = useBottomPanelStore((state) => state.activePanel);

  return (
    <nav className="activity-bar" aria-label="Activity Bar">
      <div className="activity-bar-primary">
        <button
          className={`activity-bar-button ${sidebarVisible ? 'active' : ''}`}
          type="button"
          onClick={toggleSidebar}
          title="Explorer (Ctrl+Shift+E)"
          aria-label="Toggle Explorer"
          aria-pressed={sidebarVisible}
        >
          {icons.explorer}
        </button>
        <button
          className={`activity-bar-button ${activePanel === 'search' ? 'active' : ''}`}
          type="button"
          onClick={() => void runCommand('workbench.action.findInFiles')}
          title="Search (Ctrl+Shift+F)"
          aria-label="Search workspace"
          aria-pressed={activePanel === 'search'}
        >
          {icons.search}
        </button>
        <button
          className={`activity-bar-button ${activePanel === 'git' ? 'active' : ''}`}
          type="button"
          onClick={() => void runCommand('workbench.panel.git.toggle')}
          title="Source Control"
          aria-label="Toggle Source Control"
          aria-pressed={activePanel === 'git'}
        >
          {icons.branch}
        </button>
      </div>
      <div className="activity-bar-secondary">
        <button
          className="activity-bar-button"
          type="button"
          onClick={() => void runCommand('preferences.openSettings')}
          title="Settings"
          aria-label="Open Settings"
        >
          {icons.settings}
        </button>
      </div>
    </nav>
  );
}
