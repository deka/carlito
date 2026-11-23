import { create } from 'zustand';
import type { EditorTab } from '../store/useEditorStore';
import { inlinePreviewFor, type InlinePreviewMode } from './inlinePreviews';

/**
 * Inline preview mode, keyed per editor group + tab: the same tab shown in two
 * splits can display source on one side and preview on the other. Only explicit
 * choices are stored; otherwise the kind's default mode applies.
 */
interface InlinePreviewState {
  modes: Record<string, InlinePreviewMode>;
  togglePreview: (groupId: string, tab: EditorTab) => void;
}

function modeKey(groupId: string, tabId: string): string {
  return `${groupId}\u0000${tabId}`;
}

function isPreviewed(modes: InlinePreviewState['modes'], groupId: string, tab: EditorTab | undefined): boolean {
  const descriptor = inlinePreviewFor(tab);
  if (!descriptor || !tab) return false;
  return (modes[modeKey(groupId, tab.id)] ?? descriptor.defaultMode) === 'preview';
}

export const useInlinePreviewStore = create<InlinePreviewState>((set) => ({
  modes: {},
  togglePreview: (groupId, tab) =>
    set((state) => {
      if (!inlinePreviewFor(tab)) return state;
      const next: InlinePreviewMode = isPreviewed(state.modes, groupId, tab) ? 'source' : 'preview';
      return { modes: { ...state.modes, [modeKey(groupId, tab.id)]: next } };
    }),
}));

export function canToggleInlinePreview(tab: EditorTab | undefined): tab is EditorTab {
  return inlinePreviewFor(tab) !== undefined;
}

export function useIsInlinePreviewed(groupId: string, tab: EditorTab | undefined): boolean {
  return useInlinePreviewStore((state) => isPreviewed(state.modes, groupId, tab));
}
