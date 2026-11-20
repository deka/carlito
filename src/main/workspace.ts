import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { parse, resolve } from 'node:path';
import { lastWorkspacePath } from './config/app-state';

function isDirectory(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Workspace used when no directory is passed on the command line.
 *
 * Launching from a terminal inside a project keeps that project. Launching
 * from a desktop launcher (cwd is $HOME or /) reopens the last workspace,
 * falling back to the user's home directory.
 */
function defaultWorkspacePath(cwd: string): string {
  const home = homedir();
  const resolvedCwd = resolve(cwd);
  const launchedFromLauncher = resolvedCwd === home || resolvedCwd === parse(resolvedCwd).root;
  if (!launchedFromLauncher && isDirectory(resolvedCwd)) return resolvedCwd;

  const last = lastWorkspacePath();
  if (last && isDirectory(last)) return last;
  return home;
}

export function initialWorkspacePath(argv: string[] = process.argv, cwd: string = process.cwd()): string {
  // In Electron's main process, process.argv is always:
  //   [electronExePath, appEntryScript, ...userArgs]
  // This holds for both packaged and unpackaged (dev) builds — the entry
  // script (e.g. out/main/index.js) sits at index 1.  Slicing from index 2
  // unconditionally ensures neither the executable nor the app entry script
  // is ever treated as a workspace candidate.
  const sliceFrom = 2;

  const candidates = argv
    .slice(sliceFrom)
    .filter((arg) => !arg.startsWith('-'))
    .map((arg) => resolve(cwd, arg))
    .filter(isDirectory);

  if (candidates.length > 0) return candidates.at(-1)!;
  return defaultWorkspacePath(cwd);
}
