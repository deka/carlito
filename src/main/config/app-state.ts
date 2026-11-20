import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { configHome } from './config-home';

/** Small machine-managed state (not user settings), e.g. the last opened workspace. */
interface CarloAppState {
  lastWorkspacePath?: string;
}

let cachedState: CarloAppState | undefined;

function appStatePath(): string {
  return join(configHome(), 'carlo', 'state.json');
}

function loadAppState(): CarloAppState {
  if (cachedState) return cachedState;
  try {
    const parsed = JSON.parse(readFileSync(appStatePath(), 'utf8')) as unknown;
    cachedState = parsed && typeof parsed === 'object' ? (parsed as CarloAppState) : {};
  } catch {
    cachedState = {};
  }
  return cachedState;
}

export function lastWorkspacePath(): string | undefined {
  const path = loadAppState().lastWorkspacePath;
  return typeof path === 'string' && path.length > 0 ? path : undefined;
}

export function rememberLastWorkspacePath(path: string): void {
  const state = loadAppState();
  if (state.lastWorkspacePath === path) return;
  cachedState = { ...state, lastWorkspacePath: path };
  const target = appStatePath();
  void mkdir(dirname(target), { recursive: true })
    .then(() => writeFile(target, `${JSON.stringify(cachedState, null, 2)}\n`, 'utf8'))
    .catch((error) => console.error('failed to save app state', error));
}
