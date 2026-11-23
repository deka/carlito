import { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';
import { ImageViewer } from './ImageViewer';

interface Props {
  groupId: string;
}

interface Loaded {
  dataUrl?: string;
  error?: string;
}

/** Decoded byte size of a base64 data URL, without decoding it. */
function dataUrlByteSize(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

function ipcErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/** The image file at `path` as a data URL, reloaded when it changes on disk. */
function useImageFile(path: string | undefined): Loaded {
  const [loaded, setLoaded] = useState<Loaded>({});
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    setLoaded({});
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
        if (!cancelled) setLoaded({ dataUrl: result.dataUrl });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoaded({ error: `Cannot preview image: ${ipcErrorMessage(reason)}` });
      });
    return () => {
      cancelled = true;
    };
  }, [path, revision]);

  return loaded;
}

/** Full-tab preview of raster images, which have no text source to edit. */
export function ImagePreview({ groupId }: Props) {
  const path = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId)?.path;
  });
  const { dataUrl, error } = useImageFile(path);

  return (
    <ImageViewer
      key={path}
      src={dataUrl}
      alt={path ?? ''}
      byteSize={dataUrl ? dataUrlByteSize(dataUrl) : undefined}
      error={error}
      decodeErrorMessage="Cannot preview image: the file could not be decoded."
      upscale={false}
    />
  );
}
