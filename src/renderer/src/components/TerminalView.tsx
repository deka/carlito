import '@xterm/xterm/css/xterm.css';
import '../styles/terminal.css';
import { useEffect, useRef } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { attachTerminal, focusTerminal } from '../terminal/terminalSessions';

interface Props {
  groupId: string;
}

export function TerminalView({ groupId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const uri = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId)?.uri;
  });
  const isActiveGroup = useEditorStore((state) => state.activeGroupId === groupId);

  useEffect(() => {
    const container = containerRef.current;
    if (!uri || !container) return;
    return attachTerminal(uri, container);
  }, [uri]);

  useEffect(() => {
    if (uri && isActiveGroup) focusTerminal(uri);
  }, [uri, isActiveGroup]);

  return (
    <div
      className="editor-stack terminal-view"
      ref={containerRef}
      onMouseDown={() => useEditorStore.getState().setActiveGroup(groupId)}
    />
  );
}
