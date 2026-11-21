import { useEffect, useRef, useState } from 'react';
import { APP_MENU_LABELS, type AppMenuLabel } from '@shared/app-menu';
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
      {window.api.menu.inAppMenuBar ? <AppMenuBar /> : <div aria-hidden="true" />}
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

function AppMenuBar() {
  const [openLabel, setOpenLabel] = useState<AppMenuLabel | null>(null);
  const navRef = useRef<HTMLElement>(null);

  // Publish the menu bar width so the search box can stay centred without overlapping it.
  useEffect(() => {
    const nav = navRef.current;
    const titlebar = nav?.parentElement;
    if (!nav || !titlebar) return;
    const observer = new ResizeObserver(() => {
      titlebar.style.setProperty('--app-menubar-width', `${Math.ceil(nav.offsetWidth)}px`);
    });
    observer.observe(nav);
    return () => observer.disconnect();
  }, []);

  const open = (label: AppMenuLabel, button: HTMLElement) => {
    const rect = button.getBoundingClientRect();
    setOpenLabel(label);
    void window.api.menu
      .popup({ label, x: rect.left, y: rect.bottom + 2 })
      .finally(() => setOpenLabel((current) => (current === label ? null : current)));
  };

  return (
    <nav ref={navRef} className="app-menubar" aria-label="Application menu">
      {APP_MENU_LABELS.map((label) => (
        <button
          key={label}
          type="button"
          className={`app-menubar-item ${openLabel === label ? 'open' : ''}`}
          aria-haspopup="menu"
          aria-expanded={openLabel === label}
          onClick={(event) => open(label, event.currentTarget)}
          onKeyDown={(event) => {
            if (event.key !== 'ArrowDown') return;
            event.preventDefault();
            open(label, event.currentTarget);
          }}
        >
          {label}
        </button>
      ))}
    </nav>
  );
}
