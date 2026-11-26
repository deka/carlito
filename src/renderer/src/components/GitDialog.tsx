import { lazy, Suspense, useEffect } from 'react';
import { useGitDialogStore } from '../store/useGitDialogStore';

const GitPanel = lazy(() => import('./GitPanel').then((module) => ({ default: module.GitPanel })));

/** Source Control as a modal dialog, opened from the status bar branch button or Ctrl+Shift+G. */
export function GitDialog() {
  const isOpen = useGitDialogStore((state) => state.isOpen);
  const closeGitDialog = useGitDialogStore((state) => state.closeGitDialog);

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      closeGitDialog();
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, [isOpen, closeGitDialog]);

  if (!isOpen) return null;

  return (
    <div className="settings-backdrop" role="presentation" onMouseDown={closeGitDialog}>
      <section
        aria-label="Source Control"
        aria-modal="true"
        className="git-dialog"
        role="dialog"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <Suspense fallback={<div className="git-panel-empty">Loading…</div>}>
          <GitPanel onClose={closeGitDialog} />
        </Suspense>
      </section>
    </div>
  );
}
