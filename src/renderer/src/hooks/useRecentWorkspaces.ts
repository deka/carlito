import { useEffect, useState } from 'react';
import type { RecentWorkspace } from '@shared/file-types';

/** Recently opened folders, kept in sync with the main-process list. */
export function useRecentWorkspaces(): RecentWorkspace[] {
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);

  useEffect(() => {
    let disposed = false;
    const refresh = () => {
      window.api.workspace.recent
        .list()
        .then((list) => {
          if (!disposed) setRecent(list);
        })
        .catch(console.error);
    };
    refresh();
    const off = window.api.workspace.recent.onChanged(refresh);
    return () => {
      disposed = true;
      off();
    };
  }, []);

  return recent;
}
