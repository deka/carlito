import { useEffect, useRef, useState, type ReactNode } from 'react';

interface Size {
  width: number;
  height: number;
}

interface Props {
  /** Image URL (data: or blob:). Undefined while loading. */
  src: string | undefined;
  alt: string;
  /** Encoded size of the image file, shown in the toolbar. */
  byteSize?: number;
  /** Error raised before the image could be loaded (e.g. reading the file). */
  error?: string;
  /** Shown when the browser cannot decode `src`. */
  decodeErrorMessage: string;
  /** Vector images scale losslessly: "fit" may then enlarge small images to the view. */
  upscale: boolean;
  /** Leading toolbar label. */
  title?: string;
  /** Extra toolbar buttons, after the zoom toggle. */
  actions?: ReactNode;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Size of the element's content box, kept up to date. */
function useContentSize(): [React.RefObject<HTMLDivElement | null>, Size | undefined] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size | undefined>(undefined);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, size];
}

function fitSize(natural: Size | undefined, viewport: Size | undefined, upscale: boolean): Size | undefined {
  if (!natural || !viewport || natural.width <= 0 || natural.height <= 0) return undefined;
  const scale = Math.min(viewport.width / natural.width, viewport.height / natural.height, upscale ? Infinity : 1);
  return { width: natural.width * scale, height: natural.height * scale };
}

/**
 * Image display shared by the raster and SVG previews: toolbar with dimensions
 * and size, fit / actual size zoom, checkerboard behind transparent pixels.
 * Mount it with a `key` per file so zoom and error state do not carry over.
 */
export function ImageViewer({ src, alt, byteSize, error, decodeErrorMessage, upscale, title, actions }: Props) {
  const [bodyRef, viewport] = useContentSize();
  const [natural, setNatural] = useState<Size | undefined>(undefined);
  const [broken, setBroken] = useState(false);
  const [actualSize, setActualSize] = useState(false);
  const toggleZoom = () => setActualSize((value) => !value);

  const shown = Boolean(src) && !error && !broken;
  const fitted = actualSize ? undefined : fitSize(natural, viewport, upscale);
  const details = [
    natural && shown ? `${natural.width} × ${natural.height}` : undefined,
    byteSize !== undefined ? formatBytes(byteSize) : undefined,
  ].filter(Boolean);

  return (
    <div className="image-preview">
      <div className="preview-toolbar">
        {title ? <span>{title}</span> : null}
        <span className="preview-path">{details.join(' · ')}</span>
        {shown ? (
          <button type="button" className="preview-action" onClick={toggleZoom}>
            {actualSize ? 'Fit to view' : 'Actual size'}
          </button>
        ) : null}
        {actions}
      </div>
      <div ref={bodyRef} className={`image-preview-body ${actualSize ? 'actual-size' : ''}`}>
        {error ? <div className="image-preview-error">{error}</div> : null}
        {broken && !error ? <div className="image-preview-error">{decodeErrorMessage}</div> : null}
        {src && !error ? (
          // Stays mounted while broken so the next src (e.g. a fixed SVG) can load and clear the error.
          <img
            className="image-preview-image"
            src={src}
            alt={alt}
            hidden={broken}
            draggable={false}
            style={fitted}
            onClick={toggleZoom}
            onLoad={(event) => {
              setBroken(false);
              setNatural({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight });
            }}
            onError={() => setBroken(true)}
          />
        ) : null}
      </div>
    </div>
  );
}
