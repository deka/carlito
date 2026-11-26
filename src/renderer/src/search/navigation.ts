import { useEditorStore } from '../store/useEditorStore';
import { searchResultKey, useSearchStore } from '../store/useSearchStore';
import { openSearchResult } from './openSearchResult';
import { resultsInDisplayOrder } from './resultTree';

/** F4 / Shift+F4: opens the next or previous search result, wrapping around. */
export async function openAdjacentSearchResult(direction: 1 | -1): Promise<void> {
  const state = useSearchStore.getState();
  const results = resultsInDisplayOrder(state.results, state.viewMode, useEditorStore.getState().workspace?.rootPath);
  if (results.length === 0) return;
  const index = results.findIndex((result) => searchResultKey(result) === state.activeResultKey);
  const nextIndex =
    index === -1 ? (direction > 0 ? 0 : results.length - 1) : (index + direction + results.length) % results.length;
  const next = results[nextIndex]!;
  // Expand first so the row exists when the view scrolls to the active result.
  state.revealPath(next.path);
  state.setActiveResultKey(searchResultKey(next));
  await openSearchResult(next);
}
