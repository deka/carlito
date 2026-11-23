import { useEffect, useMemo, useState } from 'react';
import type { InlinePreviewProps } from '../../preview/inlinePreviews';
import { useModelText } from '../../preview/useModelText';
import { ImageViewer } from './ImageViewer';

const renderDelayMs = 150;

/** Object URL for `text` as an SVG image, revoked when replaced or unmounted. */
function useSvgObjectUrl(text: string | undefined): string | undefined {
  const [url, setUrl] = useState<string | undefined>(undefined);
  useEffect(() => {
    if (text === undefined) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [text]);
  return url;
}

/**
 * Inline SVG preview, rendered from the editor's text model so unsaved edits
 * show up. Loaded through an <img>: scripts and external resources never run.
 */
export function SvgPreview({ tab, onShowSource }: InlinePreviewProps) {
  const source = useModelText(tab.uri, renderDelayMs);
  const src = useSvgObjectUrl(source);
  const byteSize = useMemo(() => (source === undefined ? undefined : new TextEncoder().encode(source).length), [source]);

  return (
    <ImageViewer
      key={tab.uri}
      title="Preview"
      src={src}
      alt={tab.path}
      byteSize={byteSize}
      decodeErrorMessage="Cannot render this SVG. Check the source for errors."
      upscale
      actions={
        <button type="button" className="preview-action" onClick={onShowSource}>
          Edit Source
        </button>
      }
    />
  );
}
