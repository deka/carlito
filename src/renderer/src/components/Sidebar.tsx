import { lazy, Suspense, useRef } from 'react';
import { useWorkbenchUiStore } from '../store/useWorkbenchUiStore';
import { FileTree } from './FileTree';

const SearchView = lazy(() => import('./SearchView').then((module) => ({ default: module.SearchView })));
const GitPanel = lazy(() => import('./GitPanel').then((module) => ({ default: module.GitPanel })));

/**
 * Left sidebar: Explorer, Search or Source Control. The file tree stays mounted while another
 * view is shown so its expanded folders, scroll position and workspace watcher survive switching
 * views. Source Control mounts only while shown: hidden, it would run `git status` on every
 * workspace change. It keeps its last status and commit draft across remounts.
 */
export function Sidebar() {
  const view = useWorkbenchUiStore((state) => state.sidebarView);
  const searchLoaded = useRef(false);
  if (view === 'search') searchLoaded.current = true;

  return (
    <div className="sidebar">
      <div className="sidebar-view" hidden={view !== 'explorer'}>
        <FileTree />
      </div>
      {searchLoaded.current ? (
        <div className="sidebar-view" hidden={view !== 'search'}>
          <Suspense fallback={null}>
            <SearchView />
          </Suspense>
        </div>
      ) : null}
      {view === 'git' ? (
        <div className="sidebar-view">
          <Suspense fallback={null}>
            <GitPanel />
          </Suspense>
        </div>
      ) : null}
    </div>
  );
}
