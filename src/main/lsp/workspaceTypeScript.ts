import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Where typescript-language-server looks for a workspace TypeScript, in order. */
const MODULE_FOLDERS = [
  'node_modules/typescript/lib',
  '.vscode/pnpify/typescript/lib',
  '.yarn/sdks/typescript/lib',
];

/**
 * The workspace `tsserver.js` typescript-language-server would run for
 * `rootUri`, if any.
 *
 * Without a pinned `tsserver.path` the server prefers the TypeScript of the
 * workspace (searched from the root up through every parent) over its bundled
 * copy, and forks that tsserver.js with Node: a folder can ship its own and
 * have it run. Carlo's bundled TypeScript 7 has no tsserver.js, so the
 * workspace copy is the only one the server can use, and it must be allowed
 * by the user first.
 *
 * Mirrors `findPathToModule` and `getWorkspaceVersion` of
 * typescript-language-server 5.3, erring on the side of reporting a path: it
 * keeps walking up where the server would stop on an unreadable directory.
 */
export function workspaceTsserverPath(rootUri: string): string | undefined {
  if (!rootUri.startsWith('file://')) return undefined;
  let dir = resolve(fileURLToPath(rootUri));
  for (;;) {
    let isDirectory = false;
    try {
      isDirectory = statSync(dir).isDirectory();
    } catch {
      // Keep looking in the parents.
    }
    if (isDirectory) {
      const libFolder = MODULE_FOLDERS.map((folder) => resolve(dir, folder)).find(existsSync);
      // The server only considers the first lib folder it finds.
      if (libFolder) {
        const tsserver = join(libFolder, 'tsserver.js');
        return existsSync(tsserver) ? tsserver : undefined;
      }
    }
    const parent = resolve(dir, '..');
    if (parent === dir) return undefined;
    dir = parent;
  }
}
