import { useEffect, useRef } from 'react';
import { isDevcontainerBusy, reopenLocally, useDevcontainerStore } from '../store/useDevcontainerStore';

/**
 * Covers the workbench while the window opens in its dev container or reopens
 * locally: shows the log and keeps the user from changing files meanwhile.
 */
export function DevcontainerOverlay() {
  const state = useDevcontainerStore((store) => store.state);
  const log = useDevcontainerStore((store) => store.log);
  const busy = isDevcontainerBusy(state);
  const overlayRef = useRef<HTMLDivElement>(null);
  const logRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    const element = logRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [log, busy]);

  useEffect(() => {
    if (!busy) return;
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
    overlayRef.current?.focus();
    // Keys outside the overlay never reach the editor, terminals or file tree.
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Node && overlayRef.current?.contains(event.target)) return;
      event.preventDefault();
      event.stopPropagation();
      overlayRef.current?.focus();
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [busy]);

  if (!busy) return null;
  const starting = state.status === 'starting';

  return (
    <div className="devcontainer-overlay" role="dialog" aria-modal="true" aria-label="Dev Container">
      <div className="devcontainer-overlay-card" ref={overlayRef} tabIndex={-1}>
        <header className="devcontainer-overlay-header">
          <span className="devcontainer-overlay-spinner" aria-hidden="true" />
          <span className="devcontainer-overlay-title">
            {starting ? 'Opening in Dev Container…' : 'Stopping Dev Container…'}
          </span>
          {starting ? (
            <button type="button" onClick={() => void reopenLocally().catch(console.error)}>
              Cancel
            </button>
          ) : null}
        </header>
        <pre className="devcontainer-log devcontainer-overlay-log" ref={logRef}>
          {log}
        </pre>
      </div>
    </div>
  );
}
