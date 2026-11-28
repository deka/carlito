import type { EditorTab } from '../store/useEditorStore';
import { isGitDiffUri } from '../git/diffTabs';

const previewScheme = 'markdown-preview:';

export function markdownPreviewUri(sourceUri: string): string {
  return `${previewScheme}${encodeURIComponent(sourceUri)}`;
}

export function isMarkdownPreviewUri(uri: string): boolean {
  return uri.startsWith(previewScheme);
}

export function sourceUriFromMarkdownPreviewUri(uri: string): string | undefined {
  if (!isMarkdownPreviewUri(uri)) return undefined;
  try {
    return decodeURIComponent(uri.slice(previewScheme.length));
  } catch {
    return undefined;
  }
}

/** A Markdown source tab. Git diff tabs show Markdown too but have no preview. */
export function isMarkdownTab(tab: EditorTab | undefined): tab is EditorTab {
  return Boolean(tab && !isGitDiffUri(tab.uri) && (tab.languageId === 'markdown' || /\.(md|markdown|mdown|mkdn)$/i.test(tab.path)));
}
