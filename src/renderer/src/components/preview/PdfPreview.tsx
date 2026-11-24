import { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/useEditorStore';

interface Props {
  groupId: string;
}

interface Loaded {
  url?: string;
  error?: string;
}

function ipcErrorMessage(reason: unknown): string {
  const message = reason instanceof Error ? reason.message : String(reason);
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
}

/**
 * The PDF at `path` as a blob URL, reloaded when it changes on disk. Bytes go
 * through the authorized file IPC, so the preview only shows files the window
 * may read.
 */
function usePdfBlobUrl(path: string | undefined): Loaded {
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
    let url: string | undefined;
    window.api.file
      .readPdf(path)
      .then(({ bytes }) => {
        if (cancelled) return;
        url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: 'application/pdf' }));
        setLoaded({ url });
      })
      .catch((reason: unknown) => {
        if (!cancelled) setLoaded({ error: `Cannot preview PDF: ${ipcErrorMessage(reason)}` });
      });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [path, revision]);

  return loaded;
}

/** Full-tab PDF preview, rendered by Chromium's built-in PDF viewer. */
export function PdfPreview({ groupId }: Props) {
  const path = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId)?.path;
  });
  const { url, error } = usePdfBlobUrl(path);

  return (
    <div className="pdf-preview">
      {error ? <div className="image-preview-error">{error}</div> : null}
      {url && !error ? <iframe key={url} className="pdf-preview-frame" src={url} title={path ?? 'PDF'} /> : null}
    </div>
  );
}
