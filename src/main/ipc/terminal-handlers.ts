import { app, ipcMain, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { homedir } from 'node:os';
import type { IPty } from 'node-pty';
import { IPC } from '@shared/ipc';
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
  TerminalResizeRequest,
  TerminalWriteRequest,
} from '@shared/terminal-types';
import { containerPath, containerTargetFor, type ContainerTarget } from '../devcontainer/devcontainer-service';
import { toolEnv } from '../devcontainer/tools';

/** Terminals per window, keyed by `webContents.id`, then by renderer terminal id. */
const terminalsByWindow = new Map<number, Map<string, IPty>>();

function terminalsFor(sender: WebContents): Map<string, IPty> {
  const webContentsId = sender.id;
  let terminals = terminalsByWindow.get(webContentsId);
  if (!terminals) {
    const created = new Map<string, IPty>();
    terminals = created;
    terminalsByWindow.set(webContentsId, created);
    sender.once('destroyed', () => {
      killAll(created);
      terminalsByWindow.delete(webContentsId);
    });
  }
  return terminals;
}

function killAll(terminals: Map<string, IPty>): void {
  for (const terminal of terminals.values()) killQuietly(terminal);
  terminals.clear();
}

/** Stops what a terminal left behind (shells in a dev container), keyed by its pty. */
const terminalCleanups = new WeakMap<IPty, () => void>();

function killQuietly(terminal: IPty): void {
  terminalCleanups.get(terminal)?.();
  terminalCleanups.delete(terminal);
  try {
    terminal.kill();
  } catch {
    // The process may already be gone.
  }
}

function resolveCwd(cwd: string | undefined): string {
  if (cwd) {
    try {
      if (statSync(cwd).isDirectory()) return cwd;
    } catch {
      // Fall back to the home directory.
    }
  }
  return homedir();
}

function defaultShell(): string {
  if (process.platform === 'win32') return process.env.COMSPEC ?? 'powershell.exe';
  return process.env.SHELL || '/bin/bash';
}

function shellEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    // Do not leak Electron runtime switches into user shells (e.g. ELECTRON_RUN_AS_NODE).
    if (key.startsWith('ELECTRON_') || key === 'CHROME_DESKTOP' || key === 'GOOGLE_API_KEY') continue;
    env[key] = value;
  }
  env.TERM = 'xterm-256color';
  env.COLORTERM = 'truecolor';
  env.TERM_PROGRAM = 'carlito';
  return env;
}

/** Runs the user's login shell in the container (`docker exec` does not start one). */
const containerShellScript =
  'shell=$(getent passwd "$(id -un)" 2>/dev/null | cut -d: -f7); ' +
  '[ -x "$shell" ] || shell=$(command -v bash || echo /bin/sh); exec "$shell" -l';

interface ShellCommand {
  file: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  cleanup?: () => void;
}

function localShell(cwd: string | undefined): ShellCommand {
  return { file: defaultShell(), args: [], cwd: resolveCwd(cwd), env: shellEnv() };
}

function containerShell(target: ContainerTarget, cwd: string | undefined): ShellCommand {
  const workdir = (cwd && containerPath(target, cwd)) || target.remoteRoot;
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(toolEnv(target.docker))) {
    if (value !== undefined) env[key] = value;
  }
  // Killing `docker exec` leaves the shell running in the container. Tag it (its
  // children inherit the variable) so closing the terminal can hang it up.
  const tag = `CARLITO_TERMINAL=${randomUUID()}`;
  const hangUp =
    `for p in /proc/[0-9]*; do grep -qzx "${tag}" "$p/environ" 2>/dev/null && ` +
    'kill -HUP "${p#/proc/}" 2>/dev/null; done; true';
  const cleanup = () =>
    execFile(target.docker, ['exec', '-u', target.remoteUser, target.containerId, 'sh', '-c', hangUp], {
      env,
      timeout: 10_000,
    }, () => undefined);
  return {
    cleanup,
    file: target.docker,
    args: [
      'exec', '-it',
      '-u', target.remoteUser,
      '-w', workdir,
      '-e', 'TERM=xterm-256color',
      '-e', 'COLORTERM=truecolor',
      '-e', 'TERM_PROGRAM=carlito',
      '-e', tag,
      target.containerId,
      'sh', '-c', containerShellScript,
    ],
    cwd: target.hostRoot,
    env,
  };
}

function validSize(value: number, fallback: number): number {
  return Number.isInteger(value) && value > 0 && value < 10_000 ? value : fallback;
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(
    IPC.terminalCreate,
    async (event, request: TerminalCreateRequest): Promise<TerminalCreateResult> => {
      const sender = event.sender;
      const terminals = terminalsFor(sender);
      if (typeof request?.id !== 'string' || !request.id || terminals.has(request.id)) {
        return { ok: false, error: 'Invalid terminal id.' };
      }
      try {
        // Loaded lazily: the native module is only needed once a terminal is opened.
        const { spawn } = await import('node-pty');
        const target = containerTargetFor(sender);
        const shell = target ? containerShell(target, request.cwd) : localShell(request.cwd);
        const terminal = spawn(shell.file, shell.args, {
          name: 'xterm-256color',
          cols: validSize(request.cols, 80),
          rows: validSize(request.rows, 24),
          cwd: shell.cwd,
          env: shell.env,
        });
        if (sender.isDestroyed()) {
          killQuietly(terminal);
          return { ok: false, error: 'Window closed.' };
        }
        if (shell.cleanup) terminalCleanups.set(terminal, shell.cleanup);
        terminals.set(request.id, terminal);
        terminal.onData((data) => {
          if (sender.isDestroyed()) return;
          sender.send(IPC.terminalData, { id: request.id, data } satisfies TerminalDataEvent);
        });
        terminal.onExit(({ exitCode }) => {
          // The shell exited by itself: nothing left to hang up.
          terminalCleanups.delete(terminal);
          if (terminals.get(request.id) === terminal) terminals.delete(request.id);
          if (sender.isDestroyed()) return;
          sender.send(IPC.terminalExit, { id: request.id, exitCode } satisfies TerminalExitEvent);
        });
        return { ok: true };
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
  );

  ipcMain.on(IPC.terminalWrite, (event, request: TerminalWriteRequest) => {
    if (typeof request?.data !== 'string') return;
    terminalsByWindow.get(event.sender.id)?.get(request.id)?.write(request.data);
  });

  ipcMain.on(IPC.terminalResize, (event, request: TerminalResizeRequest) => {
    const terminal = terminalsByWindow.get(event.sender.id)?.get(request?.id);
    if (!terminal) return;
    try {
      terminal.resize(validSize(request.cols, terminal.cols), validSize(request.rows, terminal.rows));
    } catch {
      // Resizing a process that just exited throws; ignore.
    }
  });

  ipcMain.handle(IPC.terminalKill, (event, { id }: { id: string }) => {
    const terminals = terminalsByWindow.get(event.sender.id);
    const terminal = terminals?.get(id);
    if (terminal) {
      terminals?.delete(id);
      killQuietly(terminal);
    }
    return { ok: true };
  });

  app.on('before-quit', () => {
    for (const terminals of terminalsByWindow.values()) killAll(terminals);
    terminalsByWindow.clear();
  });
}
