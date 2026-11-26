import type { WorkspaceSearchMatch } from '@shared/file-types';

/** Characters kept before the match so long (minified) lines still show it. */
const leadingContext = 26;

interface HighlightedPreviewProps {
  result: WorkspaceSearchMatch;
  /** When set, shows the match struck through followed by its replacement. */
  replacement?: string | null;
}

export function HighlightedPreview({ result, replacement }: HighlightedPreviewProps) {
  let before = result.preview.slice(0, result.matchStart).trimStart();
  if (before.length > leadingContext) before = `…${before.slice(-leadingContext)}`;
  const matched = result.preview.slice(result.matchStart, result.matchEnd);
  const after = result.preview.slice(result.matchEnd, result.matchEnd + 240);
  return (
    <span className="search-preview">
      {before}
      {replacement === undefined || replacement === null ? (
        <mark>{matched}</mark>
      ) : (
        <>
          <del>{matched}</del>
          <ins>{replacement}</ins>
        </>
      )}
      {after}
    </span>
  );
}
