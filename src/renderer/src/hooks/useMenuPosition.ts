import { useLayoutEffect, useRef, useState } from 'react';

const VIEWPORT_MARGIN = 4;

/**
 * Positions a fixed context menu at (x, y), flipping it above / to the left of
 * the cursor when it would overflow the bottom / right edge of the window.
 * The menu is measured before paint, so it never flashes at the wrong place.
 */
export function useMenuPosition<T extends HTMLElement>(x: number, y: number) {
  const ref = useRef<T>(null);
  const [position, setPosition] = useState({ left: x, top: y });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const { width, height } = element.getBoundingClientRect();
    const maxLeft = window.innerWidth - width - VIEWPORT_MARGIN;
    const maxTop = window.innerHeight - height - VIEWPORT_MARGIN;
    const left = x > maxLeft ? Math.max(VIEWPORT_MARGIN, x - width) : x;
    const top = y > maxTop ? Math.max(VIEWPORT_MARGIN, y - height) : y;
    setPosition({ left, top });
  }, [x, y]);

  return { ref, style: position };
}
