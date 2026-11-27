import { BrowserWindow, app, ipcMain, type WebContents } from 'electron';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { isAbsolute, join, posix, relative, resolve, sep } from 'node:path';
import type {
  DevcontainerChangedEvent,
  DevcontainerLogEvent,
  DevcontainerOpenRequest,
  DevcontainerState,
  DevcontainerStateRequest,
} from '@shared/devcontainer-types';
import { IPC } from '@shared/ipc';
import { isDevcontainerWorkspace, setDevcontainerWorkspace } from '../config/app-state';
import { workspaceRootFor } from '../ipc/workspace-state';
import { findTool, toolEnv } from './tools';

/** A running dev container that processes of a window can be started in. */
export interface ContainerTarget {
  docker: string;
  containerId: string;
  remoteUser: string;
  /** Workspace folder inside the container. */
  remoteRoot: string;
  /** The same folder on the host. */
  hostRoot: string;
}

interface WindowDevcontainer {
  rootPath: string;
  state: DevcontainerState;
  target?: ContainerTarget;
  log: string;
  /** The running `devcontainer up`, if any. */
  proc?: ChildProcess;
}

const maxLogLength = 512 * 1024;
const byWindow = new Map<number, WindowDevcontainer>();

// eslint-disable-next-line no-control-regex
const ansiPattern = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

function hasDevcontainerConfig(rootPath: string): boolean {
  return (
    existsSync(join(rootPath, '.devcontainer', 'devcontainer.json')) ||
    existsSync(join(rootPath, '.devcontainer.json'))
  );
}

function sendTo(sender: WebContents, channel: string, payload: unknown): void {
  if (!sender.isDestroyed()) sender.send(channel, payload);
}

function setState(sender: WebContents, entry: WindowDevcontainer, state: DevcontainerState): void {
  entry.state = state;
  if (state.status !== 'running') entry.target = undefined;
  sendTo(sender, IPC.devcontainerChanged, {
    rootPath: entry.rootPath,
    state,
  } satisfies DevcontainerChangedEvent);
}

function appendLog(sender: WebContents, entry: WindowDevcontainer, data: string, reset = false): void {
  const text = data.replace(ansiPattern, '');
  entry.log = reset ? text : (entry.log + text).slice(-maxLogLength);
  sendTo(sender, IPC.devcontainerLogData, {
    rootPath: entry.rootPath,
    data: text,
    reset,
  } satisfies DevcontainerLogEvent);
}

function cancel(entry: WindowDevcontainer): void {
  const proc = entry.proc;
  entry.proc = undefined;
  if (proc && proc.exitCode === null) proc.kill();
}

/** The window's workspace root; the renderer may only act on the folder the window has open. */
function checkedRoot(sender: WebContents, rootPath: unknown): string {
  const win = BrowserWindow.fromWebContents(sender);
  if (!win || typeof rootPath !== 'string') throw new Error('Window not found');
  const root = workspaceRootFor(win);
  if (resolve(rootPath) !== root) throw new Error('This folder is not open in the current window.');
  return root;
}

function entryFor(sender: WebContents, rootPath: string): WindowDevcontainer {
  const existing = byWindow.get(sender.id);
  if (existing?.rootPath === rootPath) return existing;
  if (existing) cancel(existing);
  else {
    const webContentsId = sender.id;
    sender.once('destroyed', () => {
      const entry = byWindow.get(webContentsId);
      if (entry) cancel(entry);
      byWindow.delete(webContentsId);
    });
  }
  const entry: WindowDevcontainer = {
    rootPath,
    state: { status: hasDevcontainerConfig(rootPath) ? 'available' : 'none' },
    log: '',
  };
  byWindow.set(sender.id, entry);
  return entry;
}

interface UpResult {
  outcome?: string;
  containerId?: string;
  remoteUser?: string;
  remoteWorkspaceFolder?: string;
  message?: string;
  description?: string;
}

/** `devcontainer up` prints its logs on stderr and one JSON result line on stdout. */
function parseUpResult(stdout: string): UpResult | undefined {
  const lines = stdout.trim().split('\n').reverse();
  for (const line of lines) {
    try {
      const parsed = JSON.parse(line) as unknown;
      if (parsed && typeof parsed === 'object' && 'outcome' in parsed) return parsed as UpResult;
    } catch {
      // Not the result line.
    }
  }
  return undefined;
}

function containerName(docker: string, containerId: string): Promise<string> {
  return new Promise((done) => {
    execFile(
      docker,
      ['inspect', '--format', '{{.Name}}', containerId],
      { env: toolEnv(docker), timeout: 10_000 },
      (error, stdout) => {
        const name = error ? '' : stdout.trim().replace(/^\//, '');
        done(name || containerId.slice(0, 12));
      },
    );
  });
}

function start(sender: WebContents, entry: WindowDevcontainer, rebuild: boolean): void {
  if (entry.state.status === 'none') return;
  if (entry.proc) return;
  const cli = findTool('devcontainer');
  const docker = findTool('docker');
  appendLog(sender, entry, '', true);
  if (!cli || !docker) {
    const missing = !cli
      ? 'The devcontainer CLI was not found. Install it with `npm install -g @devcontainers/cli`.'
      : 'Docker was not found.';
    appendLog(sender, entry, `${missing}\n`);
    setState(sender, entry, { status: 'error', error: missing });
    return;
  }

  const args = ['up', '--workspace-folder', entry.rootPath];
  if (rebuild) args.push('--remove-existing-container');
  appendLog(sender, entry, `$ devcontainer ${args.join(' ')}\n`);
  setState(sender, entry, { status: 'starting' });

  const proc = spawn(cli, args, { cwd: entry.rootPath, env: toolEnv(cli), stdio: ['ignore', 'pipe', 'pipe'] });
  entry.proc = proc;
  let stdout = '';
  proc.stdout?.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  proc.stderr?.on('data', (chunk: Buffer) => appendLog(sender, entry, chunk.toString()));
  proc.on('error', (error) => {
    if (entry.proc !== proc) return;
    entry.proc = undefined;
    appendLog(sender, entry, `${error.message}\n`);
    setState(sender, entry, { status: 'error', error: error.message });
  });
  proc.on('close', (code) => {
    if (entry.proc !== proc) return;
    entry.proc = undefined;
    const result = parseUpResult(stdout);
    const { containerId, remoteWorkspaceFolder } = result ?? {};
    if (result?.outcome !== 'success' || !containerId || !remoteWorkspaceFolder) {
      const error =
        result?.message || result?.description || `devcontainer up exited with code ${code ?? 'null'}.`;
      appendLog(sender, entry, `${error}\n`);
      setState(sender, entry, { status: 'error', error });
      return;
    }
    const remoteUser = result.remoteUser || 'root';
    void containerName(docker, containerId).then((name) => {
      // Reopened locally, rebuilt or switched folders meanwhile.
      if (byWindow.get(sender.id) !== entry || entry.proc || entry.state.status !== 'starting') return;
      entry.target = { docker, containerId, remoteUser, remoteRoot: remoteWorkspaceFolder, hostRoot: entry.rootPath };
      setDevcontainerWorkspace(entry.rootPath, true);
      appendLog(sender, entry, `Connected to ${name} (${remoteWorkspaceFolder}).\n`);
      setState(sender, entry, { status: 'running', containerId, name, remoteUser, remoteWorkspaceFolder });
    });
  });
}

/**
 * The dev container the window's processes should run in, if the window is connected
 * to one for the workspace it currently has open.
 */
export function containerTargetFor(sender: WebContents): ContainerTarget | undefined {
  const entry = byWindow.get(sender.id);
  const win = BrowserWindow.fromWebContents(sender);
  if (!entry?.target || !win || workspaceRootFor(win) !== entry.rootPath) return undefined;
  return entry.target;
}

/** `hostPath` inside the container, or undefined when it is outside the mounted workspace. */
export function containerPath(target: ContainerTarget, hostPath: string): string | undefined {
  const rel = relative(target.hostRoot, resolve(hostPath));
  if (isAbsolute(rel) || rel === '..' || rel.startsWith(`..${sep}`)) return undefined;
  return rel ? posix.join(target.remoteRoot, ...rel.split(sep)) : target.remoteRoot;
}

export function registerDevcontainerHandlers(): void {
  ipcMain.handle(IPC.devcontainerState, (event, request: DevcontainerStateRequest): DevcontainerState => {
    const entry = entryFor(event.sender, checkedRoot(event.sender, request?.rootPath));
    // Workspaces last used in their container reopen in it.
    if (entry.state.status === 'available' && isDevcontainerWorkspace(entry.rootPath)) {
      start(event.sender, entry, false);
    }
    return entry.state;
  });

  ipcMain.handle(IPC.devcontainerOpen, (event, request: DevcontainerOpenRequest): DevcontainerState => {
    const entry = entryFor(event.sender, checkedRoot(event.sender, request?.rootPath));
    if (request.rebuild) cancel(entry);
    if (request.rebuild || entry.state.status !== 'running') start(event.sender, entry, request.rebuild === true);
    return entry.state;
  });

  ipcMain.handle(IPC.devcontainerClose, (event, request: DevcontainerStateRequest): DevcontainerState => {
    const entry = entryFor(event.sender, checkedRoot(event.sender, request?.rootPath));
    cancel(entry);
    setDevcontainerWorkspace(entry.rootPath, false);
    // The container keeps running: starting it again is the slow part.
    if (entry.state.status !== 'none') {
      appendLog(event.sender, entry, 'Reopened locally; the container keeps running.\n');
      setState(event.sender, entry, { status: 'available' });
    }
    return entry.state;
  });

  ipcMain.handle(IPC.devcontainerLog, (event, request: DevcontainerStateRequest): { log: string } => {
    const entry = byWindow.get(event.sender.id);
    return { log: entry && entry.rootPath === resolve(String(request?.rootPath)) ? entry.log : '' };
  });

  app.on('before-quit', () => {
    for (const entry of byWindow.values()) cancel(entry);
  });
}
