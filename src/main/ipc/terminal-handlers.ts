import { app, ipcMain, type WebContents } from 'electron';
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

function killQuietly(terminal: IPty): void {
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
  env.TERM_PROGRAM = 'carlo';
  return env;
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
        const terminal = spawn(defaultShell(), [], {
          name: 'xterm-256color',
          cols: validSize(request.cols, 80),
          rows: validSize(request.rows, 24),
          cwd: resolveCwd(request.cwd),
          env: shellEnv(),
        });
        if (sender.isDestroyed()) {
          killQuietly(terminal);
          return { ok: false, error: 'Window closed.' };
        }
        terminals.set(request.id, terminal);
        terminal.onData((data) => {
          if (sender.isDestroyed()) return;
          sender.send(IPC.terminalData, { id: request.id, data } satisfies TerminalDataEvent);
        });
        terminal.onExit(({ exitCode }) => {
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
