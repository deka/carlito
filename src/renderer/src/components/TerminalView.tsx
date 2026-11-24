import '@xterm/xterm/css/xterm.css';
import '../styles/terminal.css';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from 'react';
import { createPortal } from 'react-dom';
import { useEditorStore } from '../store/useEditorStore';
import { useContextMenuDismiss } from '../hooks/useContextMenuDismiss';
import {
  attachTerminal,
  clearTerminal,
  copyTerminalSelection,
  focusTerminal,
  pasteIntoTerminal,
  selectAllTerminal,
  terminalHasSelection,
} from '../terminal/terminalSessions';

interface Props {
  groupId: string;
}

interface TerminalContextMenuState {
  x: number;
  y: number;
  uri: string;
  hasSelection: boolean;
}

export function TerminalView({ groupId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<TerminalContextMenuState | undefined>(undefined);
  const uri = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId)?.uri;
  });
  const isActiveGroup = useEditorStore((state) => state.activeGroupId === groupId);

  const closeContextMenu = useCallback(() => setContextMenu(undefined), []);
  useContextMenuDismiss(contextMenu !== undefined, closeContextMenu);

  useEffect(() => {
    const container = containerRef.current;
    if (!uri || !container) return;
    return attachTerminal(uri, container);
  }, [uri]);

  useEffect(() => {
    if (uri && isActiveGroup) focusTerminal(uri);
  }, [uri, isActiveGroup]);

  // The menu belongs to the terminal shown when it opened.
  useEffect(() => {
    setContextMenu(undefined);
  }, [uri]);

  // Keep the menu inside the window when opened near the right/bottom edge.
  useLayoutEffect(() => {
    const menu = menuRef.current;
    if (!menu || !contextMenu) return;
    const { width, height } = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(0, Math.min(contextMenu.x, window.innerWidth - width - 4))}px`;
    menu.style.top = `${Math.max(0, Math.min(contextMenu.y, window.innerHeight - height - 4))}px`;
  }, [contextMenu]);

  function openContextMenu(event: MouseEvent): void {
    if (!uri) return;
    event.preventDefault();
    event.stopPropagation();
    useEditorStore.getState().setActiveGroup(groupId);
    setContextMenu({ x: event.clientX, y: event.clientY, uri, hasSelection: terminalHasSelection(uri) });
  }

  function run(action: (uri: string) => void): void {
    if (!contextMenu) return;
    const target = contextMenu.uri;
    setContextMenu(undefined);
    action(target);
  }

  return (
    <div
      className="editor-stack terminal-view"
      ref={containerRef}
      onMouseDown={() => useEditorStore.getState().setActiveGroup(groupId)}
      onContextMenu={openContextMenu}
    >
      {contextMenu
        ? createPortal(
            <div
              ref={menuRef}
              className="tab-context-menu terminal-context-menu"
              style={{ left: contextMenu.x, top: contextMenu.y }}
              onMouseDown={(event) => event.preventDefault()}
              onClick={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                // Portal events still bubble through the React tree to the terminal view.
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <button type="button" disabled={!contextMenu.hasSelection} onClick={() => run(copyTerminalSelection)}>
                Copy
              </button>
              <button type="button" onClick={() => run(pasteIntoTerminal)}>
                Paste
              </button>
              <div className="tab-context-separator" />
              <button type="button" onClick={() => run(selectAllTerminal)}>
                Select All
              </button>
              <button type="button" onClick={() => run(clearTerminal)}>
                Clear
              </button>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
