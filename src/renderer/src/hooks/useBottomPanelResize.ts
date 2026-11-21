import { useRef, useState } from 'react';

const storageKey = 'carlo.bottomPanelHeight';
const minHeight = 150;
const defaultHeight = 300;
/** Space kept for the editor area above the panel. */
const minEditorHeight = 120;

interface PointerHandlers {
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerMove: (event: React.PointerEvent<HTMLElement>) => void;
  onPointerUp: (event: React.PointerEvent<HTMLElement>) => void;
}

interface UseBottomPanelResizeResult {
  panelHeight: number;
  panelRef: React.RefObject<HTMLElement | null>;
  pointerHandlers: PointerHandlers;
}

function initialHeight(): number {
  const stored = Number(localStorage.getItem(storageKey));
  return Number.isFinite(stored) && stored >= minHeight ? stored : defaultHeight;
}

export function useBottomPanelResize(): UseBottomPanelResizeResult {
  const [panelHeight, setPanelHeight] = useState(initialHeight);
  const panelRef = useRef<HTMLElement | null>(null);
  const heightRef = useRef(panelHeight);

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    const container = panelRef.current?.parentElement;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const maxHeight = Math.max(minHeight, rect.height - minEditorHeight);
    const nextHeight = Math.round(Math.min(maxHeight, Math.max(minHeight, rect.bottom - event.clientY)));
    heightRef.current = nextHeight;
    setPanelHeight(nextHeight);
  };

  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return;
    event.currentTarget.releasePointerCapture(event.pointerId);
    localStorage.setItem(storageKey, String(heightRef.current));
  };

  return { panelHeight, panelRef, pointerHandlers: { onPointerDown, onPointerMove, onPointerUp } };
}
