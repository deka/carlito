import { useEffect } from 'react';
import { runCommand } from '../commands/registry';
import { useEditorStore, useActiveTab } from '../store/useEditorStore';
import { titleFromState } from './appTitleUtils';

export function AppTitleBar() {
  const activeGroupId = useEditorStore((state) => state.activeGroupId);
  const workspaceName = useEditorStore((state) => state.workspace?.name);
  const activeTab = useActiveTab();
  useEffect(() => {
    document.title = titleFromState();
  }, [activeTab?.title, activeTab?.dirty, workspaceName, activeGroupId]);

  return (
    <header className="app-titlebar">
      <div className="app-titlebar-brand">
        <span className="brand-mark" aria-hidden="true">
          <span />
        </span>
        <span>Carlo</span>
      </div>
      <button
        className="app-command-center"
        type="button"
        onClick={() => void runCommand('workbench.action.quickOpen')}
        title="Quick Open (Ctrl+P)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="4.5" />
          <path d="m12 12 3.5 3.5" />
        </svg>
        <span className="app-command-label">
          <span className="app-command-context">{activeTab?.title ?? workspaceName ?? 'Carlo'}</span>
          <span className="app-command-prompt">Search workspace files</span>
        </span>
        <kbd>Ctrl P</kbd>
      </button>
      <div className="app-titlebar-workspace" title={workspaceName ?? 'No folder open'}>
        <span className={`workspace-status ${workspaceName ? 'ready' : ''}`} aria-hidden="true" />
        <span>{workspaceName ?? 'No workspace'}</span>
      </div>
    </header>
  );
}
