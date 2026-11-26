import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { configHome } from './config-home';

/** Small machine-managed state (not user settings), e.g. the recently opened workspaces. */
interface CarloAppState {
  /** Kept for older builds; mirrors the head of `recentWorkspaces`. */
  lastWorkspacePath?: string;
  /** Most recent first, deduplicated, capped at {@link maxRecentWorkspaces}. */
  recentWorkspaces?: string[];
  /** tsserver.js files of workspaces the user allowed to run (see lsp/workspaceTypeScript). */
  trustedTsserverPaths?: string[];
}

const maxRecentWorkspaces = 10;

let cachedState: CarloAppState | undefined;
let pendingWrite: Promise<void> = Promise.resolve();
const recentListeners = new Set<() => void>();

function appStatePath(): string {
  return join(configHome(), 'carlito', 'state.json');
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function normalizeState(parsed: unknown): CarloAppState {
  if (!parsed || typeof parsed !== 'object') return {};
  const raw = parsed as Record<string, unknown>;
  const last = isNonEmptyString(raw.lastWorkspacePath) ? raw.lastWorkspacePath : undefined;
  // Seed from the legacy single entry only when the list was never written, so a
  // cleared list (persisted as []) stays empty across restarts.
  const recent = Array.isArray(raw.recentWorkspaces)
    ? raw.recentWorkspaces.filter(isNonEmptyString)
    : last
      ? [last]
      : [];
  const deduped = [...new Set(recent.map((path) => resolve(path)))].slice(0, maxRecentWorkspaces);
  return { ...raw, lastWorkspacePath: last, recentWorkspaces: deduped };
}

function loadAppState(): CarloAppState {
  if (cachedState) return cachedState;
  try {
    cachedState = normalizeState(JSON.parse(readFileSync(appStatePath(), 'utf8')) as unknown);
  } catch {
    cachedState = normalizeState({});
  }
  return cachedState;
}

function saveAppState(): void {
  const target = appStatePath();
  // Serialize writes so rapid updates cannot land out of order.
  pendingWrite = pendingWrite
    .then(async () => {
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, `${JSON.stringify(cachedState, null, 2)}\n`, 'utf8');
    })
    .catch((error) => console.error('failed to save app state', error));
}

function setRecentWorkspaces(list: string[], lastWorkspacePath = loadAppState().lastWorkspacePath): void {
  cachedState = { ...loadAppState(), recentWorkspaces: list, lastWorkspacePath };
  saveAppState();
  for (const listener of recentListeners) listener();
}

export function lastWorkspacePath(): string | undefined {
  const state = loadAppState();
  return state.recentWorkspaces?.[0] ?? state.lastWorkspacePath;
}

/** Recently opened workspace folders, most recent first. Cheap: no filesystem access. */
export function recentWorkspaces(): readonly string[] {
  return loadAppState().recentWorkspaces ?? [];
}

export function isRecentWorkspace(path: string): boolean {
  return recentWorkspaces().includes(resolve(path));
}

/** Record that a window opened `path` as its workspace. */
export function rememberWorkspace(path: string): void {
  const normalized = resolve(path);
  const current = recentWorkspaces();
  if (current[0] === normalized && loadAppState().lastWorkspacePath === normalized) return;
  const next = [normalized, ...current.filter((entry) => entry !== normalized)].slice(
    0,
    maxRecentWorkspaces,
  );
  setRecentWorkspaces(next, normalized);
}

export function removeRecentWorkspace(path: string): void {
  const normalized = resolve(path);
  const current = recentWorkspaces();
  if (!current.includes(normalized)) return;
  setRecentWorkspaces(current.filter((entry) => entry !== normalized));
}

export function clearRecentWorkspaces(): void {
  if (recentWorkspaces().length === 0) return;
  setRecentWorkspaces([]);
}

/** Subscribe to changes of the recent workspace list. Returns an unsubscribe function. */
export function onRecentWorkspacesChanged(listener: () => void): () => void {
  recentListeners.add(listener);
  return () => recentListeners.delete(listener);
}

function trustedTsserverPaths(): string[] {
  const value = loadAppState().trustedTsserverPaths;
  return Array.isArray(value) ? value.filter(isNonEmptyString) : [];
}

export function isTrustedTsserverPath(path: string): boolean {
  return trustedTsserverPaths().includes(resolve(path));
}

/** Remember that the user allowed the workspace TypeScript at `path` to run. */
export function trustTsserverPath(path: string): void {
  const normalized = resolve(path);
  const current = trustedTsserverPaths();
  if (current.includes(normalized)) return;
  cachedState = { ...loadAppState(), trustedTsserverPaths: [...current, normalized] };
  saveAppState();
}
