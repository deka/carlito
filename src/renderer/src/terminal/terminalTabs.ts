import { useEditorStore } from '../store/useEditorStore';

// Lightweight helpers only: keep xterm out of this module so the shell/store can import it.
const terminalScheme = 'terminal:';

export function isTerminalUri(uri: string): boolean {
  return uri.startsWith(terminalScheme);
}

export function terminalIdFromUri(uri: string): string {
  return uri.slice(terminalScheme.length);
}

/** True when keyboard focus is inside a terminal view. */
export function isTerminalElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('.terminal-view') !== null;
}

export function openTerminal(): void {
  const store = useEditorStore.getState();
  const count = store.tabs.filter((tab) => isTerminalUri(tab.uri)).length;
  const id = crypto.randomUUID();
  store.openFile({
    uri: `${terminalScheme}${id}`,
    // Not a file: point at the workspace so path-based UI (tooltips) stays meaningful.
    path: store.workspace?.rootPath ?? '',
    languageId: 'plaintext',
    title: count === 0 ? 'Terminal' : `Terminal ${count + 1}`,
  });
}
