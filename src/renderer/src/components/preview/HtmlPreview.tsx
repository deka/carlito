import { useMemo } from 'react';
import type { InlinePreviewProps } from '../../preview/inlinePreviews';
import { useModelText } from '../../preview/useModelText';

const renderDelayMs = 300;

/** Leading BOM/whitespace and `<!doctype …>`, which must stay first or the page renders in quirks mode. */
const doctypePrefix = /^﻿?\s*<!doctype[^>]*>/i;
const fragmentBase = '<base href="about:srcdoc">';

/**
 * A srcdoc document resolves relative URLs against the *parent* page, so
 * `href="#x"` would point at the app's own page and navigate the iframe away
 * instead of jumping to `#x`. Basing it on `about:srcdoc` keeps fragment links
 * (and CSS `:target`) inside the previewed document.
 */
export function withFragmentBase(source: string): string {
  const doctype = doctypePrefix.exec(source)?.[0] ?? '';
  return doctype + fragmentBase + source.slice(doctype.length);
}

/**
 * Inline HTML preview, rendered from the editor's text model so unsaved edits
 * show up. The sandboxed iframe gets an opaque origin: page scripts run but
 * cannot reach the app, open popups or navigate the window.
 */
export function HtmlPreview({ tab, onShowSource }: InlinePreviewProps) {
  const source = useModelText(tab.uri, renderDelayMs);
  const srcDoc = useMemo(() => withFragmentBase(source ?? ''), [source]);
  return (
    <div className="html-preview">
      <div className="preview-toolbar">
        <span>Preview</span>
        <button type="button" className="preview-action" onClick={onShowSource}>
          Edit Source
        </button>
      </div>
      <iframe title={tab.path} sandbox="allow-scripts" srcDoc={srcDoc} />
    </div>
  );
}
