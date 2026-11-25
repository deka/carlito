import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { realpathSync, watch, type FSWatcher } from 'node:fs';
import { realpath } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { basename, dirname, isAbsolute, join, normalize, relative, resolve, sep } from 'node:path';
import type { WorkspaceFolderResult } from '@shared/file-types';
import { IPC } from '@shared/ipc';
import { rememberWorkspace } from '../config/app-state';
import { initialWorkspacePath } from '../workspace';
import { ignoredWatchNames, isIgnoredPath } from './ignored-paths';

interface WindowWorkspaceState {
  initialRootPath: string;
  allowedRoots: Set<string>;
  allowedFiles: Set<string>;
  /** Non-recursive watchers keyed by canonical directory path. */
  watchers: Map<string, FSWatcher>;
  /** Canonical path of the watched workspace root. */
  watchedRootPath?: string;
}

// Recursive fs.watch walks the whole tree synchronously on Linux (including
// node_modules), which blocks the main process on large folders such as $HOME.
// Instead, watch only the directories the user can see: the root, `.git`, the
// directories listed in the file tree and the parents of opened files.
const maxDirectoryWatchers = 1024;

interface AuthorizePathOptions {
  allowMissing?: boolean;
}

const windowWorkspaceStates = new Map<number, WindowWorkspaceState>();
const unauthorizedPathMessage = 'This file or folder is not available in the current window.';

export function windowFromEvent(event: IpcMainInvokeEvent): BrowserWindow {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) throw new Error('Window not found');
  return win;
}

function createWorkspaceState(rootPath: string): WindowWorkspaceState {
  const normalizedRoot = resolve(rootPath);
  return {
    initialRootPath: normalizedRoot,
    allowedRoots: new Set([normalizedRoot]),
    allowedFiles: new Set(),
    watchers: new Map(),
  };
}

export function workspaceStateFor(win: BrowserWindow): WindowWorkspaceState {
  let state = windowWorkspaceStates.get(win.webContents.id);
  if (!state) {
    state = createWorkspaceState(initialWorkspacePath());
    windowWorkspaceStates.set(win.webContents.id, state);
  }
  return state;
}

export function workspaceRootFor(win: BrowserWindow): string {
  return workspaceStateFor(win).initialRootPath;
}

export function setWindowWorkspaceRoot(win: BrowserWindow, rootPath: string): void {
  const normalizedRoot = resolve(rootPath);
  const state = workspaceStateFor(win);
  state.initialRootPath = normalizedRoot;
  // Opening another folder revokes access granted by the previous workspace root.
  state.allowedRoots.clear();
  state.allowedRoots.add(normalizedRoot);
}

/** Switch `win` to a new workspace root the user chose (dialog or recent list). */
export function openWindowWorkspace(win: BrowserWindow, rootPath: string): WorkspaceFolderResult {
  setWindowWorkspaceRoot(win, rootPath);
  const normalizedRoot = workspaceRootFor(win);
  ensureWorkspaceWatcher(win, normalizedRoot);
  rememberWorkspace(normalizedRoot);
  return {
    rootPath: normalizedRoot,
    rootUri: pathToFileURL(normalizedRoot).toString(),
    name: basename(normalizedRoot),
  };
}

export async function registerAllowedFile(win: BrowserWindow, path: string): Promise<void> {
  if (!isAbsolute(path)) throw new Error(unauthorizedPathMessage);
  workspaceStateFor(win).allowedFiles.add(await canonicalPath(normalize(path), true));
}

async function canonicalPath(path: string, allowMissing: boolean): Promise<string> {
  try {
    return await realpath(path);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (!allowMissing || code !== 'ENOENT') throw new Error(unauthorizedPathMessage);

    const parent = dirname(path);
    if (parent === path) throw new Error(unauthorizedPathMessage);
    return join(await canonicalPath(parent, true), basename(path));
  }
}

function isInsideOrEqual(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}${sep}`);
}

/** Resolve a renderer-provided path and ensure this window was granted access to it. */
export async function authorizeWindowPath(
  win: BrowserWindow,
  path: string,
  options: AuthorizePathOptions = {},
): Promise<string> {
  if (typeof path !== 'string' || !isAbsolute(path)) throw new Error(unauthorizedPathMessage);

  const normalizedPath = normalize(path);
  const state = workspaceStateFor(win);
  try {
    const resolvedPath = await canonicalPath(normalizedPath, options.allowMissing ?? false);
    const roots = await Promise.all(
      [...state.allowedRoots].map((root) => canonicalPath(root, false)),
    );
    if (roots.some((root) => isInsideOrEqual(resolvedPath, root))) return resolvedPath;

    for (const file of state.allowedFiles) {
      if (resolvedPath === file) return resolvedPath;
    }
  } catch (error) {
    if (error instanceof Error && error.message === unauthorizedPathMessage) throw error;
  }

  throw new Error(unauthorizedPathMessage);
}

export function registerWindowWorkspace(win: BrowserWindow, initialRootPath?: string): void {
  const webContentsId = win.webContents.id;
  windowWorkspaceStates.set(
    webContentsId,
    createWorkspaceState(initialRootPath ?? initialWorkspacePath()),
  );
  win.on('closed', () => {
    const state = windowWorkspaceStates.get(webContentsId);
    if (state) closeWatchers(state);
    windowWorkspaceStates.delete(webContentsId);
  });
}

function closeWatchers(state: WindowWorkspaceState): void {
  for (const watcher of state.watchers.values()) watcher.close();
  state.watchers.clear();
  state.watchedRootPath = undefined;
}

function canonicalPathSync(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
}

function dropWatchersUnder(state: WindowWorkspaceState, path: string): void {
  if (path === state.watchedRootPath) return;
  for (const [directory, watcher] of state.watchers) {
    if (!isInsideOrEqual(directory, path)) continue;
    watcher.close();
    state.watchers.delete(directory);
  }
}

function addDirectoryWatcher(win: BrowserWindow, state: WindowWorkspaceState, directory: string): void {
  const rootPath = state.watchedRootPath;
  if (!rootPath || state.watchers.has(directory)) return;
  if (state.watchers.size >= maxDirectoryWatchers) return;
  try {
    const watcher = watch(directory, (eventType, filename) => {
      const name = filename?.toString();
      const path = name ? join(directory, name) : undefined;
      if (path && isIgnoredPath(relative(rootPath, path), ignoredWatchNames)) return;
      // A deleted/recreated directory leaves a dead watcher behind; drop it so the
      // next tree listing re-watches the new directory.
      if (path && eventType === 'rename') dropWatchersUnder(state, path);
      if (win.isDestroyed()) return;
      win.webContents.send(IPC.workspaceChanged, {
        rootPath: workspaceRootFor(win),
        path,
        eventType,
      });
    });
    watcher.on('error', () => {
      watcher.close();
      if (state.watchers.get(directory) === watcher) state.watchers.delete(directory);
    });
    state.watchers.set(directory, watcher);
  } catch {
    // Missing or unreadable directory: nothing to watch.
  }
}

/** Watch a directory inside the current workspace (non-recursively). */
export function watchWorkspaceDirectory(win: BrowserWindow, path: string): void {
  const state = workspaceStateFor(win);
  const rootPath = state.watchedRootPath;
  if (!rootPath) return;
  const directory = canonicalPathSync(path);
  if (!isInsideOrEqual(directory, rootPath)) return;
  if (isIgnoredPath(relative(rootPath, directory), ignoredWatchNames)) return;
  addDirectoryWatcher(win, state, directory);
}

export function ensureWorkspaceWatcher(win: BrowserWindow, rootPath: string): void {
  const state = workspaceStateFor(win);
  const canonicalRoot = canonicalPathSync(rootPath);
  if (state.watchedRootPath === canonicalRoot) return;
  closeWatchers(state);
  state.watchedRootPath = canonicalRoot;
  addDirectoryWatcher(win, state, canonicalRoot);
  // HEAD/index changes refresh git decorations and gutters.
  addDirectoryWatcher(win, state, join(canonicalRoot, '.git'));
}
