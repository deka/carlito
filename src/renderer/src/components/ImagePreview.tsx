import { useEffect, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';

interface Props {
  groupId: string;
}

interface Dimensions {
  width: number;
  height: number;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

/** Decoded byte size of a base64 data URL, without decoding it. */
function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

export function ImagePreview({ groupId }: Props) {
  const path = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId)?.path;
  });
  const [dataUrl, setDataUrl] = useState<string | undefined>(undefined);
  const [error, setError] = useState<string | undefined>(undefined);
  const [dimensions, setDimensions] = useState<Dimensions | undefined>(undefined);
  const [actualSize, setActualSize] = useState(false);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setDataUrl(undefined);
    setError(undefined);
    setDimensions(undefined);
    setActualSize(false);
  }, [path]);

  useEffect(() => {
    if (!path) return;
    return window.api.workspace.onChanged((event) => {
      if (!event.path || event.path === path) setRevision((value) => value + 1);
    });
  }, [path]);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    window.api.file
      .readDataUrl(path)
      .then((result) => {
        if (cancelled) return;
        setDataUrl(result.dataUrl);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        setDataUrl(undefined);
        setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  const details = [
    dimensions ? `${dimensions.width} × ${dimensions.height}` : undefined,
    dataUrl ? formatBytes(dataUrlByteSize(dataUrl)) : undefined,
  ].filter(Boolean);

  return (
    <div className="image-preview">
      <div className="markdown-preview-toolbar">
        <span className="markdown-preview-path">{details.join(' · ')}</span>
        {dataUrl ? (
          <button
            type="button"
            className="markdown-preview-action"
            onClick={() => setActualSize((value) => !value)}
          >
            {actualSize ? 'Fit to view' : 'Actual size'}
          </button>
        ) : null}
      </div>
      <div className={`image-preview-body ${actualSize ? 'actual-size' : ''}`}>
        {error ? (
          <div className="image-preview-error">Cannot preview image: {error.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')}</div>
        ) : dataUrl ? (
          <img
            className="image-preview-image"
            src={dataUrl}
            alt={path}
            draggable={false}
            onClick={() => setActualSize((value) => !value)}
            onLoad={(event) =>
              setDimensions({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
        ) : null}
      </div>
    </div>
  );
}
