import { useEffect, useMemo, useState } from 'react';
import { getModel } from '../editor/models';
import { markdownImageUrls, renderMarkdown } from '../markdown/renderMarkdown';
import { isMarkdownPreviewUri, sourceUriFromMarkdownPreviewUri } from '../markdown/previewTabs';
import {
  localMarkdownAssetPath,
  markdownAnchorUrl,
  resolveMarkdownUrl,
} from '../markdown/markdownPathUtils';
import { useEditorStore } from '../store/useEditorStore';

interface Props {
  groupId: string;
  /** Set when the preview replaces the source editor in place. */
  onShowSource?: () => void;
}

export function MarkdownPreview({ groupId, onShowSource }: Props) {
  const tab = useEditorStore((state) => {
    const activeTabId = state.groups.find((group) => group.id === groupId)?.activeTabId;
    return state.tabs.find((candidate) => candidate.id === activeTabId);
  });
  const sourceUri = tab
    ? isMarkdownPreviewUri(tab.uri)
      ? sourceUriFromMarkdownPreviewUri(tab.uri)
      : onShowSource
        ? tab.uri
        : undefined
    : undefined;
  const [content, setContent] = useState('');
  const [imageDataUrls, setImageDataUrls] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!sourceUri || !tab) return;
    let cancelled = false;
    const model = getModel(sourceUri);
    if (model) {
      setContent(model.getValue());
      setError(undefined);
      const disposable = model.onDidChangeContent(() => setContent(model.getValue()));
      return () => disposable.dispose();
    }

    void window.api.file
      .read(tab.path)
      .then((file) => {
        if (cancelled) return;
        setContent(file.content);
        setError(undefined);
      })
      .catch((reason: unknown) => {
        if (cancelled) return;
        console.error(reason);
        setError(reason instanceof Error ? reason.message : 'Could not load markdown preview.');
      });

    return () => {
      cancelled = true;
    };
  }, [sourceUri, tab?.uri, tab?.path]);

  useEffect(() => {
    if (!tab) return;
    let cancelled = false;
    const entries = markdownImageUrls(content)
      .map((url) => ({ url, path: localMarkdownAssetPath(tab.path, url) }))
      .filter((entry): entry is { url: string; path: string } => Boolean(entry.path));

    if (entries.length === 0) {
      setImageDataUrls({});
      return;
    }

    void Promise.all(
      entries.map(async ({ url, path }) => {
        try {
          const result = await window.api.file.readDataUrl(path);
          return [url, result.dataUrl] as const;
        } catch (reason) {
          console.error(`Could not load markdown image: ${path}`, reason);
          return undefined;
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      setImageDataUrls(
        Object.fromEntries(
          results.filter((entry): entry is readonly [string, string] => Boolean(entry)),
        ),
      );
    });

    return () => {
      cancelled = true;
    };
  }, [content, tab?.path]);

  const html = useMemo(
    () =>
      renderMarkdown(content, {
        resolveUrl: (url) => resolveMarkdownUrl(tab?.path ?? '', url),
        resolveImageUrl: (url) => {
          const dataUrl = imageDataUrls[url];
          if (dataUrl) return dataUrl;
          return undefined;
        },
      }),
    [content, imageDataUrls, tab?.path],
  );

  if (!sourceUri || !tab)
    return <div className="markdown-preview empty">No markdown file selected.</div>;

  return (
    <div className="markdown-preview">
      <div className="preview-toolbar">
        <span>Preview</span>
        <span className="preview-path">{tab.path}</span>
        {onShowSource ? (
          <button type="button" className="preview-action" onClick={onShowSource}>
            Show Source
          </button>
        ) : null}
      </div>
      {error ? (
        <div className="markdown-preview-error">{error}</div>
      ) : (
        <div
          className="markdown-preview-content"
          dangerouslySetInnerHTML={{ __html: html }}
          onClick={(event) => {
            const anchor = (event.target as Element).closest('a');
            if (!anchor) return;
            event.preventDefault();
            const href = anchor.getAttribute('href');
            if (!href || href.startsWith('#')) return;
            const externalUrl = markdownAnchorUrl(href);
            if (!externalUrl || externalUrl.startsWith('#')) return;
            void window.api.shell.openExternal(externalUrl).catch(console.error);
          }}
        />
      )}
    </div>
  );
}
