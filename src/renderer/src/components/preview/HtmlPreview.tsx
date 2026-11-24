import type { InlinePreviewProps } from '../../preview/inlinePreviews';
import { useModelText } from '../../preview/useModelText';

const renderDelayMs = 300;

/**
 * Inline HTML preview, rendered from the editor's text model so unsaved edits
 * show up. The sandboxed iframe gets an opaque origin: page scripts run but
 * cannot reach the app, open popups or navigate the window.
 */
export function HtmlPreview({ tab, onShowSource }: InlinePreviewProps) {
  const source = useModelText(tab.uri, renderDelayMs);
  return (
    <div className="html-preview">
      <div className="preview-toolbar">
        <span>Preview</span>
        <button type="button" className="preview-action" onClick={onShowSource}>
          Edit Source
        </button>
      </div>
      <iframe title={tab.path} sandbox="allow-scripts" srcDoc={source ?? ''} />
    </div>
  );
}
