/**
 * The rich markdown editor writes into the tab's text model on a short delay.
 * Anything that reads the model for persistence (save, save as, close prompt)
 * flushes first so the last keystrokes are never lost. Kept dependency-free so
 * save paths do not pull the editor chunk.
 */
const flushers = new Map<string, Set<() => void>>();

export function registerRichEditFlusher(uri: string, flush: () => void): () => void {
  let set = flushers.get(uri);
  if (!set) {
    set = new Set();
    flushers.set(uri, set);
  }
  set.add(flush);
  return () => {
    set.delete(flush);
    if (set.size === 0) flushers.delete(uri);
  };
}

export function flushRichEdits(uri: string): void {
  flushers.get(uri)?.forEach((flush) => {
    try {
      flush();
    } catch (error) {
      console.error('Could not apply pending markdown edits', error);
    }
  });
}

export function flushAllRichEdits(): void {
  for (const uri of [...flushers.keys()]) flushRichEdits(uri);
}
