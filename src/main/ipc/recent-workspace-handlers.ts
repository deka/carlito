import { BrowserWindow, ipcMain } from 'electron';
import { stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, sep } from 'node:path';
import type { RecentWorkspace, RecentWorkspaceRequest, WorkspaceFolderResult } from '@shared/file-types';
import { IPC } from '@shared/ipc';
import {
  clearRecentWorkspaces,
  isRecentWorkspace,
  onRecentWorkspacesChanged,
  recentWorkspaces,
  removeRecentWorkspace,
} from '../config/app-state';
import { openWindowWorkspace, windowFromEvent } from './workspace-state';

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

function displayPath(path: string, home: string): string {
  if (path === home) return '~';
  if (path.startsWith(`${home}${sep}`)) return `~${path.slice(home.length)}`;
  return path;
}

export function toRecentWorkspace(path: string, home = homedir()): RecentWorkspace {
  return { path, name: basename(path) || path, displayPath: displayPath(path, home) };
}

function requestedPath(request: RecentWorkspaceRequest | undefined): string | undefined {
  const path = request?.path;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

export function registerRecentWorkspaceHandlers(): void {
  ipcMain.handle(IPC.workspaceRecentList, async (): Promise<RecentWorkspace[]> => {
    // Folders may live on unmounted drives: hide missing ones here (opening one drops it).
    const paths = [...recentWorkspaces()];
    const exists = await Promise.all(paths.map(isDirectory));
    const home = homedir();
    return paths.filter((_, index) => exists[index]).map((path) => toRecentWorkspace(path, home));
  });

  ipcMain.handle(
    IPC.workspaceRecentOpen,
    async (event, request: RecentWorkspaceRequest): Promise<WorkspaceFolderResult | null> => {
      const win = windowFromEvent(event);
      const path = requestedPath(request);
      // Only folders the user opened before may be granted, like a dialog pick.
      if (!path || !isRecentWorkspace(path)) return null;
      if (!(await isDirectory(path))) {
        removeRecentWorkspace(path);
        return null;
      }
      return openWindowWorkspace(win, path);
    },
  );

  ipcMain.handle(IPC.workspaceRecentRemove, (_event, request: RecentWorkspaceRequest) => {
    const path = requestedPath(request);
    if (path) removeRecentWorkspace(path);
    return { ok: true };
  });

  ipcMain.handle(IPC.workspaceRecentClear, () => {
    clearRecentWorkspaces();
    return { ok: true };
  });

  onRecentWorkspacesChanged(() => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send(IPC.workspaceRecentChanged);
    }
  });
}
