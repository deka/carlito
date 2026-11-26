import { lazy, Suspense, useRef } from 'react';
import { useWorkbenchUiStore } from '../store/useWorkbenchUiStore';
import { FileTree } from './FileTree';

const SearchView = lazy(() => import('./SearchView').then((module) => ({ default: module.SearchView })));

/**
 * Left sidebar: Explorer or Search. The file tree stays mounted while Search is shown so its
 * expanded folders, scroll position and workspace watcher survive switching views.
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
    </div>
  );
}
