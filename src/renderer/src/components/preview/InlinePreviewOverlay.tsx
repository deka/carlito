import { lazy, Suspense, useEffect, useRef, type ComponentType, type LazyExoticComponent } from 'react';
import { inlinePreviewKind, type InlinePreviewKind, type InlinePreviewProps } from '../../preview/inlinePreviews';
import { useInlinePreviewStore, useIsInlinePreviewed } from '../../preview/inlinePreviewStore';
import type { EditorTab } from '../../store/useEditorStore';

/** One lazily loaded component per inline preview kind: adding a kind without one fails to typecheck. */
const previewComponents: Record<InlinePreviewKind, LazyExoticComponent<ComponentType<InlinePreviewProps>>> = {
  markdown: lazy(() => import('../MarkdownRichEditor').then((module) => ({ default: module.MarkdownRichEditor }))),
  svg: lazy(() => import('./SvgPreview').then((module) => ({ default: module.SvgPreview }))),
};

/** Renders the tab's inline preview over its source editor when the tab is in preview mode. */
export function InlinePreview({ groupId, tab }: { groupId: string; tab: EditorTab | undefined }) {
  const previewed = useIsInlinePreviewed(groupId, tab);
  const kind = inlinePreviewKind(tab);
  if (!previewed || !tab || !kind) return null;
  return <InlinePreviewOverlay groupId={groupId} tab={tab} kind={kind} />;
}

function InlinePreviewOverlay({ groupId, tab, kind }: { groupId: string; tab: EditorTab; kind: InlinePreviewKind }) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const Preview = previewComponents[kind];

  useEffect(() => {
    const overlay = overlayRef.current;
    if (!overlay) return;
    // Take focus away from the hidden source editor so typing cannot edit it.
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && overlay.parentElement?.contains(focused)) focused.blur();
    overlay.focus({ preventScroll: true });
    // The source editor may still grab focus after the overlay mounts (a tab that
    // opens straight into preview while Monaco attaches its model): keep it out.
    const stack = overlay.parentElement;
    const keepFocusInOverlay = (event: FocusEvent) => {
      if (event.target instanceof Node && !overlay.contains(event.target)) overlay.focus({ preventScroll: true });
    };
    stack?.addEventListener('focusin', keepFocusInOverlay);
    return () => {
      stack?.removeEventListener('focusin', keepFocusInOverlay);
      const current = document.activeElement;
      if (current && current !== document.body && !overlay.contains(current)) return;
      void import('../../editor/editorRegistry')
        .then(({ getEditorForGroup }) => getEditorForGroup(groupId)?.focus())
        .catch(console.error);
    };
  }, [groupId, tab.id]);

  return (
    <div className="preview-overlay" ref={overlayRef} tabIndex={-1}>
      <Suspense fallback={null}>
        <Preview
          groupId={groupId}
          tab={tab}
          onShowSource={() => useInlinePreviewStore.getState().togglePreview(groupId, tab)}
        />
      </Suspense>
    </div>
  );
}
