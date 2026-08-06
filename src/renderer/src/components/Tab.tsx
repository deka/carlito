import type { DragEvent, MouseEvent } from 'react';
import type { EditorTab } from '../store/useEditorStore';

interface Props {
  tab: EditorTab;
  active: boolean;
  dragging: boolean;
  dropPosition?: 'before' | 'after';
  onSelect: () => void;
  onClose: () => void;
  onContextMenu: (event: MouseEvent) => void;
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: DragEvent<HTMLDivElement>) => void;
  onDrop: (event: DragEvent<HTMLDivElement>) => void;
}
export function Tab({
  tab,
  active,
  dragging,
  dropPosition,
  onSelect,
  onClose,
  onContextMenu,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
}: Props) {
  return (
    <div
      className={`tab ${active ? 'active' : ''} ${tab.dirty ? 'dirty' : ''} ${dragging ? 'dragging' : ''} ${dropPosition ? `drop-${dropPosition}` : ''}`}
      onContextMenu={onContextMenu}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <button
        type="button"
        className="tab-select"
        draggable
        onClick={onSelect}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onAuxClick={(event) => {
          if (event.button !== 1) return;
          event.preventDefault();
          event.stopPropagation();
          onClose();
        }}
        onMouseDown={(event) => {
          if (event.button === 1) event.preventDefault();
        }}
        title={tab.path}
      >
        <span className="tab-file-icon" aria-hidden="true">
          <span />
        </span>
        <span className="tab-title">{tab.title}</span>
      </button>
      <button
        type="button"
        className="tab-close"
        aria-label={`Close ${tab.title}`}
        onClick={(event) => {
          event.stopPropagation();
          onClose();
        }}
      >
        <svg viewBox="0 0 16 16" aria-hidden="true">
          <path d="m5 5 6 6M11 5l-6 6" />
        </svg>
      </button>
    </div>
  );
}
