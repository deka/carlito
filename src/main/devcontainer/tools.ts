import { accessSync, constants, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { delimiter, dirname, isAbsolute, join } from 'node:path';

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

/** Node version managers keep global npm binaries (like `devcontainer`) out of a desktop PATH. */
function nvmBinDirectories(home: string): string[] {
  const root = join(home, '.nvm', 'versions', 'node');
  try {
    return readdirSync(root)
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
      .map((version) => join(root, version, 'bin'));
  } catch {
    return [];
  }
}

function searchDirectories(): string[] {
  const home = homedir();
  // Only absolute PATH entries: relative ones would resolve against the workspace.
  const fromPath = (process.env.PATH ?? '').split(delimiter).filter((entry) => isAbsolute(entry));
  return [
    ...fromPath,
    join(home, '.local', 'bin'),
    join(home, '.volta', 'bin'),
    join(home, '.npm-global', 'bin'),
    ...nvmBinDirectories(home),
    '/usr/local/bin',
    '/opt/homebrew/bin',
    '/usr/bin',
  ];
}

const cache = new Map<string, string | undefined>();

/** Absolute path of `name`, looked up in PATH and the usual install locations. */
export function findTool(name: string): string | undefined {
  if (cache.has(name)) return cache.get(name);
  const found = searchDirectories()
    .map((directory) => join(directory, name))
    .find((candidate) => isExecutable(candidate));
  // Only cache hits: the user may install the tool while Carlito runs.
  if (found) cache.set(name, found);
  return found;
}

/**
 * Environment for running a tool found by {@link findTool}: its directory goes first
 * in PATH so `#!/usr/bin/env node` scripts find the Node they were installed with.
 */
export function toolEnv(toolPath: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('ELECTRON_')) continue;
    env[key] = value;
  }
  env.PATH = [dirname(toolPath), ...searchDirectories()].join(delimiter);
  return env;
}
