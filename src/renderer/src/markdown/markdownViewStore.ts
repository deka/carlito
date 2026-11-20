import { create } from 'zustand';
import type { EditorTab } from '../store/useEditorStore';
import { isMarkdownPreviewUri, isMarkdownTab } from './previewTabs';

/**
 * In-place markdown preview mode, keyed per editor group + tab: the same tab
 * shown in two splits can display source on one side and preview on the other.
 */
interface MarkdownViewState {
  previewKeys: Record<string, true>;
  togglePreview: (groupId: string, tabId: string) => void;
}

function previewKey(groupId: string, tabId: string): string {
  return `${groupId}\u0000${tabId}`;
}

export const useMarkdownViewStore = create<MarkdownViewState>((set) => ({
  previewKeys: {},
  togglePreview: (groupId, tabId) =>
    set((state) => {
      const key = previewKey(groupId, tabId);
      const previewKeys = { ...state.previewKeys };
      if (previewKeys[key]) delete previewKeys[key];
      else previewKeys[key] = true;
      return { previewKeys };
    }),
}));

/** Markdown source tabs (not the "preview to side" tabs) can toggle in place. */
export function canToggleMarkdownPreview(tab: EditorTab | undefined): tab is EditorTab {
  return isMarkdownTab(tab) && !isMarkdownPreviewUri(tab.uri);
}

export function useIsMarkdownPreviewed(groupId: string, tab: EditorTab | undefined): boolean {
  return useMarkdownViewStore((state) =>
    canToggleMarkdownPreview(tab) ? Boolean(state.previewKeys[previewKey(groupId, tab.id)]) : false,
  );
}
