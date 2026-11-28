import { BrowserWindow, app, dialog, ipcMain, type WebContents } from 'electron';
import { IPC } from '@shared/ipc';
import { languageServerFor } from '@shared/language-registry';
import type { LspStartOptions, LspToServerPayload } from '@shared/lsp-types';
import { isTrustedTsserverPath, trustTsserverPath } from '../config/app-state';
import { containerTargetFor } from '../devcontainer/devcontainer-service';
import { toolEnv } from '../devcontainer/tools';
import { LspServerManager } from '../lsp/LspServerManager';
import { jsonSchemaAssociations } from '../lsp/jsonSchemas';
import { PathMapping } from '../lsp/pathMapping';
import { resolveContainerServer, resolveServer, type ResolvedServer } from '../lsp/resolveServer';
import { workspaceTsserverPath } from '../lsp/workspaceTypeScript';

const managers = new Map<number, LspServerManager>();

function managerFor(sender: WebContents): LspServerManager {
  const webContentsId = sender.id;
  let manager = managers.get(webContentsId);
  if (!manager) {
    // Servers are killed when the window goes away, but their `exit` (and any
    // trailing stdout/stderr) arrives asynchronously, after the WebContents is
    // destroyed; sending then throws "Object has been destroyed".
    manager = new LspServerManager((channel, payload) => {
      if (!sender.isDestroyed()) sender.send(channel, payload);
    });
    managers.set(webContentsId, manager);
    sender.once('destroyed', () => {
      manager?.stopAll();
      managers.delete(webContentsId);
    });
  }
  return manager;
}

/** Workspace tsserver.js paths the user declined, per window, so opening more files does not ask again. */
const declinedTsservers = new Map<number, Set<string>>();
/** Open prompts by window and path: the TS and JS clients start together and must share one. */
const pendingTsserverPrompts = new Map<string, Promise<boolean>>();

async function askToRunWorkspaceTypeScript(
  sender: WebContents,
  tsserverPath: string,
): Promise<boolean> {
  const win = BrowserWindow.fromWebContents(sender);
  const options: Electron.MessageBoxOptions = {
    type: 'warning',
    buttons: ['Allow', "Don't Allow"],
    defaultId: 1,
    cancelId: 1,
    noLink: true,
    title: 'Workspace TypeScript',
    message: 'Allow this folder to run its own TypeScript?',
    detail:
      `JavaScript and TypeScript language features use the TypeScript server found at:\n\n${tsserverPath}\n\n` +
      'Running it executes code that comes with this folder. Only allow it if you trust the folder. ' +
      'Carlito remembers the choice to allow it.',
  };
  const { response } = win
    ? await dialog.showMessageBox(win, options)
    : await dialog.showMessageBox(options);
  return response === 0;
}

/**
 * Whether typescript-language-server may start for `rootUri`: always when the
 * workspace has no TypeScript of its own, otherwise only once the user allowed
 * that tsserver.js (see workspaceTsserverPath).
 */
async function workspaceTypeScriptAllowed(
  sender: WebContents,
  rootUri: string,
): Promise<string | undefined> {
  const tsserverPath = workspaceTsserverPath(rootUri);
  if (!tsserverPath || isTrustedTsserverPath(tsserverPath)) return undefined;

  const declined = declinedTsservers.get(sender.id);
  if (!declined?.has(tsserverPath)) {
    const key = `${sender.id}\0${tsserverPath}`;
    let prompt = pendingTsserverPrompts.get(key);
    if (!prompt) {
      prompt = askToRunWorkspaceTypeScript(sender, tsserverPath).finally(() =>
        pendingTsserverPrompts.delete(key),
      );
      pendingTsserverPrompts.set(key, prompt);
    }
    if (await prompt) {
      trustTsserverPath(tsserverPath);
      return undefined;
    }
    if (!declinedTsservers.has(sender.id)) {
      declinedTsservers.set(sender.id, new Set());
      sender.once('destroyed', () => declinedTsservers.delete(sender.id));
    }
    declinedTsservers.get(sender.id)!.add(tsserverPath);
  }
  return `Not running the workspace TypeScript at ${tsserverPath}: the folder was not allowed to run it.`;
}

/**
 * Where the server for `opts` runs: in the window's dev container when it has the
 * server installed, otherwise on the host (the workspace is mounted from the host).
 */
async function serverFor(
  sender: WebContents,
  opts: LspStartOptions,
): Promise<{ server: ResolvedServer; mapping?: PathMapping; location?: string }> {
  const target = containerTargetFor(sender);
  if (target) {
    const server = await resolveContainerServer(opts.languageId, {
      ...target,
      dockerEnv: toolEnv(target.docker),
    });
    if (server) {
      return { server, mapping: new PathMapping(target.hostRoot, target.remoteRoot), location: 'in the dev container' };
    }
    const host = resolveServer(opts.languageId, opts.rootUri);
    const location = 'on the host: not installed in the dev container';
    return { server: { ...host, debug: `${location}; ${host.debug}` }, location };
  }
  return { server: resolveServer(opts.languageId, opts.rootUri) };
}

export function registerLspHandlers(): void {
  ipcMain.handle(IPC.lspStart, async (event, opts: LspStartOptions) => {
    try {
      if (languageServerFor(opts.languageId)?.command === 'typescript-language-server') {
        const refusal = await workspaceTypeScriptAllowed(event.sender, opts.rootUri);
        if (refusal) return { error: refusal };
      }
      const { server, mapping, location } = await serverFor(event.sender, opts);
      if (event.sender.isDestroyed()) return { error: 'Window closed.' };
      return { connectionId: managerFor(event.sender).start(opts, server, mapping), location };
    } catch (error) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  });
  ipcMain.handle(IPC.lspStop, (event, { connectionId }: { connectionId: string }) => {
    managerFor(event.sender).stop(connectionId);
    return { ok: true };
  });
  ipcMain.handle(IPC.lspJsonSchemas, () => jsonSchemaAssociations());
  ipcMain.on(IPC.lspToServer, (event, payload: LspToServerPayload) =>
    managerFor(event.sender).toServer(payload.connectionId, payload.message),
  );
  app.on('before-quit', () => {
    for (const manager of managers.values()) manager.stopAll();
    managers.clear();
  });
}
