import { FitAddon } from '@xterm/addon-fit';
import { Terminal, type ITheme } from '@xterm/xterm';
import { useEditorStore } from '../store/useEditorStore';
import { isTerminalUri, terminalIdFromUri } from './terminalTabs';

/**
 * Terminal sessions outlive their React view: switching tabs unmounts the view,
 * but the shell and its scrollback must survive. A session is disposed (and its
 * shell killed) only when its tab is closed or the shell exits.
 */
interface TerminalSession {
  id: string;
  uri: string;
  terminal: Terminal;
  fit: FitAddon;
  /** Element xterm renders into; moved between view containers. */
  element: HTMLDivElement;
  opened: boolean;
  started: boolean;
  exited: boolean;
}

const sessions = new Map<string, TerminalSession>();

const darkAnsi: ITheme = {
  black: '#3b4252',
  red: '#e06c75',
  green: '#98c379',
  yellow: '#e5c07b',
  blue: '#61afef',
  magenta: '#c678dd',
  cyan: '#56b6c2',
  white: '#dcdfe4',
  brightBlack: '#5c6370',
  brightRed: '#ef8891',
  brightGreen: '#b5e890',
  brightYellow: '#f0d197',
  brightBlue: '#8cc8ff',
  brightMagenta: '#de9bf0',
  brightCyan: '#7fd4de',
  brightWhite: '#ffffff',
};

const lightAnsi: ITheme = {
  black: '#383a42',
  red: '#d73a49',
  green: '#22863a',
  yellow: '#b08800',
  blue: '#005cc5',
  magenta: '#6f42c1',
  cyan: '#1b7c83',
  white: '#a0a1a7',
  brightBlack: '#696c77',
  brightRed: '#e45649',
  brightGreen: '#50a14f',
  brightYellow: '#c18401',
  brightBlue: '#4078f2',
  brightMagenta: '#a626a4',
  brightCyan: '#0184bc',
  brightWhite: '#fafafa',
};

function cssVar(name: string, fallback: string): string {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function currentTheme(): ITheme {
  const light = document.documentElement.dataset.theme === 'light';
  const background = cssVar('--bg', light ? '#ffffff' : '#0b0d12');
  const foreground = cssVar('--fg', light ? '#1f2328' : '#f1f3f7');
  const accent = cssVar('--accent', '#8b7cff');
  // xterm parses colors itself and does not understand color-mix(); use plain rgba.
  const accentRgb = cssVar('--accent-rgb', '139, 124, 255');
  return {
    ...(light ? lightAnsi : darkAnsi),
    background,
    foreground,
    cursor: accent,
    cursorAccent: background,
    selectionBackground: `rgba(${accentRgb}, 0.35)`,
  };
}

function writeToClipboard(text: string): void {
  if (text) void navigator.clipboard.writeText(text).catch(console.error);
}

function pasteFromClipboard(terminal: Terminal): void {
  void navigator.clipboard
    .readText()
    .then((text) => {
      if (text) terminal.paste(text);
    })
    .catch(console.error);
}

function createSession(uri: string): TerminalSession {
  const id = terminalIdFromUri(uri);
  const terminal = new Terminal({
    allowProposedApi: false,
    cursorBlink: true,
    fontFamily: cssVar('--mono-font-family', 'monospace'),
    fontSize: 13,
    scrollback: 10_000,
    theme: currentTheme(),
  });
  const fit = new FitAddon();
  terminal.loadAddon(fit);

  // Linux terminal conventions: Ctrl+Shift+C / Ctrl+Shift+V copy and paste.
  // Everything else (Ctrl+C, Ctrl+W, Ctrl+P, …) goes to the shell.
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown' || !event.ctrlKey || !event.shiftKey || event.altKey) return true;
    if (event.code === 'KeyC') {
      event.preventDefault();
      writeToClipboard(terminal.getSelection());
      return false;
    }
    if (event.code === 'KeyV') {
      event.preventDefault();
      pasteFromClipboard(terminal);
      return false;
    }
    return true;
  });

  const element = document.createElement('div');
  element.className = 'terminal-host';

  const session: TerminalSession = {
    id,
    uri,
    terminal,
    fit,
    element,
    opened: false,
    started: false,
    exited: false,
  };

  terminal.onData((data) => {
    if (session.started && !session.exited) window.api.terminal.write(id, data);
  });
  terminal.onResize(({ cols, rows }) => {
    if (session.started && !session.exited) window.api.terminal.resize(id, cols, rows);
  });

  sessions.set(id, session);
  return session;
}

function startShell(session: TerminalSession): void {
  if (session.started) return;
  session.started = true;
  const cwd = useEditorStore.getState().workspace?.rootPath;
  void window.api.terminal
    .create({ id: session.id, cwd, cols: session.terminal.cols, rows: session.terminal.rows })
    .then((result) => {
      if (!result.ok) {
        session.exited = true;
        session.terminal.write(`\r\n\x1b[31mUnable to start the shell: ${result.error}\x1b[0m\r\n`);
      }
    })
    .catch((error: unknown) => {
      session.exited = true;
      session.terminal.write(`\r\n\x1b[31mUnable to start the shell: ${String(error)}\x1b[0m\r\n`);
    });
}

function fitSession(session: TerminalSession): void {
  if (!session.element.isConnected || session.element.clientWidth === 0) return;
  try {
    session.fit.fit();
  } catch {
    // The renderer may not be measurable yet; the next resize will retry.
  }
}

function disposeSession(id: string): void {
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  if (!session.exited) void window.api.terminal.kill(id).catch(console.error);
  session.terminal.dispose();
  session.element.remove();
}

/**
 * Attach the terminal for `uri` to `container`, starting the shell on first use.
 * Returns a detach function. A session can only be displayed in one place: the
 * most recent attach wins.
 */
export function attachTerminal(uri: string, container: HTMLElement): () => void {
  const session = sessions.get(terminalIdFromUri(uri)) ?? createSession(uri);
  container.appendChild(session.element);
  if (!session.opened) {
    session.terminal.open(session.element);
    session.opened = true;
  }
  fitSession(session);
  startShell(session);
  session.terminal.focus();

  const observer = new ResizeObserver(() => fitSession(session));
  observer.observe(container);

  return () => {
    observer.disconnect();
    if (session.element.parentElement === container) container.removeChild(session.element);
  };
}

export function focusTerminal(uri: string): void {
  sessions.get(terminalIdFromUri(uri))?.terminal.focus();
}

function terminalFor(uri: string): Terminal | undefined {
  return sessions.get(terminalIdFromUri(uri))?.terminal;
}

/** Context-menu actions. Each one gives keyboard focus back to the terminal. */
export function terminalHasSelection(uri: string): boolean {
  return terminalFor(uri)?.hasSelection() ?? false;
}

export function copyTerminalSelection(uri: string): void {
  const terminal = terminalFor(uri);
  if (!terminal) return;
  writeToClipboard(terminal.getSelection());
  terminal.focus();
}

export function pasteIntoTerminal(uri: string): void {
  const terminal = terminalFor(uri);
  if (!terminal) return;
  pasteFromClipboard(terminal);
  terminal.focus();
}

export function selectAllTerminal(uri: string): void {
  const terminal = terminalFor(uri);
  if (!terminal) return;
  terminal.selectAll();
  terminal.focus();
}

export function clearTerminal(uri: string): void {
  const terminal = terminalFor(uri);
  if (!terminal) return;
  terminal.clear();
  terminal.focus();
}

// Shell output and exit, routed to their sessions.
window.api.terminal.onData(({ id, data }) => sessions.get(id)?.terminal.write(data));
window.api.terminal.onExit(({ id }) => {
  const session = sessions.get(id);
  if (!session) return;
  session.exited = true;
  // Like VS Code: when the shell exits (e.g. `exit`), close its tab.
  const tab = useEditorStore.getState().tabs.find((candidate) => candidate.uri === session.uri);
  if (tab) useEditorStore.getState().closeTab(tab.id);
  else disposeSession(id);
});

// Closing a terminal tab (from any path: tab bar, Ctrl+W elsewhere, close-others…) kills its shell.
useEditorStore.subscribe((state, previous) => {
  if (state.tabs === previous.tabs) return;
  const openUris = new Set(state.tabs.filter((tab) => isTerminalUri(tab.uri)).map((tab) => tab.uri));
  for (const session of [...sessions.values()]) {
    if (!openUris.has(session.uri)) disposeSession(session.id);
  }
});

// Follow light/dark theme switches.
new MutationObserver(() => {
  const theme = currentTheme();
  for (const session of sessions.values()) session.terminal.options.theme = theme;
}).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'style', 'class'] });
