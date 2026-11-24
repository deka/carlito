import type { EditorTab } from '../store/useEditorStore';
import { isMarkdownPreviewUri, isMarkdownTab } from '../markdown/previewTabs';

/**
 * Inline previews: a rendered view laid over the (still mounted) source editor
 * of a text tab, toggled with Ctrl+Alt+V or the tab bar's eye/code button.
 *
 * Each kind is described once here; the store, tab bar, context menu and
 * overlay all go through this table. Keep this module free of heavy imports:
 * it is part of the initial renderer chunk. The components live in
 * `components/preview/InlinePreviewOverlay.tsx` and load lazily.
 */
export type InlinePreviewMode = 'preview' | 'source';

export interface InlinePreviewDescriptor {
  /** Shown in labels: "Show <label> Preview". */
  readonly label: string;
  /** Mode used until the user toggles the tab. */
  readonly defaultMode: InlinePreviewMode;
  readonly matches: (tab: EditorTab) => boolean;
}

/** Props every inline preview component receives. */
export interface InlinePreviewProps {
  groupId: string;
  tab: EditorTab;
  onShowSource: () => void;
}

function isFileTabWithExtension(tab: EditorTab | undefined, extension: RegExp): boolean {
  return Boolean(tab && tab.uri.startsWith('file:') && extension.test(tab.path));
}

export function isSvgTab(tab: EditorTab | undefined): boolean {
  return isFileTabWithExtension(tab, /\.svg$/i);
}

export const inlinePreviews = {
  // SVG is text worth editing, but what it draws is what people open it for.
  svg: { label: 'SVG', defaultMode: 'preview', matches: isSvgTab },
  // HTML is mostly edited: the rendered page is one toggle away.
  html: { label: 'HTML', defaultMode: 'source', matches: (tab) => isFileTabWithExtension(tab, /\.html?$/i) },
  // "Preview to side" tabs are already a preview: only source tabs toggle.
  markdown: {
    label: 'Markdown',
    defaultMode: 'source',
    matches: (tab) => isMarkdownTab(tab) && !isMarkdownPreviewUri(tab.uri),
  },
} as const satisfies Record<string, InlinePreviewDescriptor>;

export type InlinePreviewKind = keyof typeof inlinePreviews;

const kinds = Object.keys(inlinePreviews) as InlinePreviewKind[];

export function inlinePreviewKind(tab: EditorTab | undefined): InlinePreviewKind | undefined {
  return tab ? kinds.find((kind) => inlinePreviews[kind].matches(tab)) : undefined;
}

export function inlinePreviewFor(tab: EditorTab | undefined): InlinePreviewDescriptor | undefined {
  const kind = inlinePreviewKind(tab);
  return kind ? inlinePreviews[kind] : undefined;
}
