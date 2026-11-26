import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useShallow } from 'zustand/shallow';
import type { WorkspaceSearchMatch } from '@shared/file-types';
import { useEditorStore } from '../store/useEditorStore';
import { useSearchStore, searchResultKey, type SearchToggle } from '../store/useSearchStore';
import { openSearchResult } from '../search/openSearchResult';
import { replaceMatches, replacementFor, resultsAfterReplace, type ReplaceRequest } from '../search/replace';
import { buildSearchTree, searchTreeKeys } from '../search/resultTree';
import { groupByPath } from '../utils/groupByPath';
import { searchIcons } from './SearchFileSection';
import { SearchResultTree } from './SearchResultTree';

const maxResults = 2000;

const plural = (count: number, word: string): string => `${count} ${word}${count === 1 ? '' : 's'}`;

const headerIcons = {
  refresh: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 5.5A5 5 0 1 0 13 10M12.5 2.5v3.25H9.25" /></svg>
  ),
  clear: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h8M2.5 7.5h6M2.5 11h3.5M9.5 10l4 4M13.5 10l-4 4" /></svg>
  ),
  collapse: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h9v11h-9zM6 8h4" /></svg>
  ),
  expand: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 2.5h9v11h-9zM6 8h4M8 6v4" /></svg>
  ),
  viewAsTree: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 3h3M4 3v8.5h3M4 7h3M9.5 7h4M9.5 11.5h4M9.5 3h4" /></svg>
  ),
  viewAsList: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 4h11M2.5 8h11M2.5 12h11" /></svg>
  ),
  details: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 8h.01M8 8h.01M12 8h.01" /></svg>
  ),
  ignoreFiles: (
    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 2.5h5l3 3v8h-8zM9.5 2.5v3h3M6.5 9.5h4" /></svg>
  ),
};

function Toggle({
  active,
  title,
  onToggle,
  children,
}: {
  active: boolean;
  title: string;
  onToggle: () => void;
  children: ReactNode;
}) {
  return (
    <button
      className={`search-toggle ${active ? 'active' : ''}`}
      type="button"
      title={title}
      aria-label={title}
      aria-pressed={active}
      // Keep the focus (and caret) in the input.
      onMouseDown={(event) => event.preventDefault()}
      onClick={onToggle}
    >
      {children}
    </button>
  );
}

export function SearchView() {
  const queryRef = useRef<HTMLInputElement | null>(null);
  const replaceRef = useRef<HTMLInputElement | null>(null);
  const searchSeq = useRef(0);
  const [replacing, setReplacing] = useState(false);
  const workspace = useEditorStore((state) => state.workspace);

  const state = useSearchStore(
    useShallow((s) => ({
      query: s.query,
      replaceText: s.replaceText,
      includes: s.includes,
      excludes: s.excludes,
      isCaseSensitive: s.isCaseSensitive,
      isWordMatch: s.isWordMatch,
      isRegex: s.isRegex,
      preserveCase: s.preserveCase,
      useIgnoreFiles: s.useIgnoreFiles,
      showReplace: s.showReplace,
      showDetails: s.showDetails,
      viewMode: s.viewMode,
      results: s.results,
      loading: s.loading,
      truncated: s.truncated,
      error: s.error,
      message: s.message,
      hasSearched: s.hasSearched,
      collapsedPaths: s.collapsedPaths,
      activeResultKey: s.activeResultKey,
      refreshSeq: s.refreshSeq,
      focusRequest: s.focusRequest,
    })),
  );
  const actions = useSearchStore.getState();
  const { query, isRegex, isCaseSensitive, isWordMatch, includes, excludes, useIgnoreFiles } = state;

  // Ctrl+Shift+F / Ctrl+Shift+H, and the first display of the view.
  useEffect(() => {
    const target = state.focusRequest.target === 'replace' ? replaceRef.current : queryRef.current;
    const handle = window.setTimeout(() => {
      target?.focus();
      target?.select();
    }, 0);
    return () => window.clearTimeout(handle);
  }, [state.focusRequest]);

  useEffect(() => {
    const store = useSearchStore.getState();
    const request = { query, isRegex, isCaseSensitive, isWordMatch, includes, excludes, useIgnoreFiles, maxResults };
    const signature = JSON.stringify([workspace?.rootPath, state.refreshSeq, request]);
    if (signature === store.lastSearchSignature) return;
    const seq = ++searchSeq.current;
    if (!workspace || !query) {
      store.setLastSearchSignature(signature);
      store.setLoading(false);
      store.setError(null);
      store.setResults([], false);
      return;
    }
    const handle = window.setTimeout(() => {
      store.setLastSearchSignature(signature);
      store.setLoading(true);
      store.setError(null);
      window.api.workspace
        .search(request)
        .then((result) => {
          if (seq !== searchSeq.current) return;
          store.setResults(result.matches, result.truncated);
          if (result.error) store.setError(result.error);
        })
        .catch((searchError: unknown) => {
          if (seq !== searchSeq.current) return;
          console.error(searchError);
          store.setError(searchError instanceof Error ? searchError.message : 'Search failed');
        })
        .finally(() => {
          if (seq === searchSeq.current) store.setLoading(false);
        });
    }, 300);
    return () => window.clearTimeout(handle);
  }, [workspace, query, isRegex, isCaseSensitive, isWordMatch, includes, excludes, useIgnoreFiles, state.refreshSeq]);

  const groupedResults = useMemo(() => groupByPath(state.results), [state.results]);
  const rootPath = workspace?.rootPath;
  const tree = useMemo(
    () => (state.viewMode === 'tree' && rootPath ? buildSearchTree(groupedResults, rootPath) : []),
    [groupedResults, rootPath, state.viewMode],
  );

  // F4 / Shift+F4 can land on a result outside the visible part of the list.
  const bodyRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const key = state.activeResultKey;
    if (!key) return;
    const row = [...(bodyRef.current?.querySelectorAll<HTMLElement>('[data-result-key]') ?? [])].find(
      (element) => element.dataset.resultKey === key,
    );
    row?.scrollIntoView({ block: 'nearest' });
  }, [state.activeResultKey]);

  const replaceRequest: ReplaceRequest = useMemo(
    () => ({
      query: state.query,
      replaceText: state.replaceText,
      options: { isRegex, isCaseSensitive, isWordMatch, preserveCase: state.preserveCase },
    }),
    [state.query, state.replaceText, isRegex, isCaseSensitive, isWordMatch, state.preserveCase],
  );
  const previewReplacement = useCallback(
    (result: WorkspaceSearchMatch) => replacementFor(result, replaceRequest),
    [replaceRequest],
  );

  const replace = useCallback(
    async (matches: WorkspaceSearchMatch[], confirmFirst: boolean): Promise<void> => {
      if (replacing || matches.length === 0) return;
      const fileCount = new Set(matches.map((match) => match.path)).size;
      if (confirmFirst) {
        const truncatedNote = useSearchStore.getState().truncated
          ? '\n\nThe result list is truncated: only the listed occurrences will be replaced.'
          : '';
        const target = replaceRequest.replaceText ? `with "${replaceRequest.replaceText}"` : 'with nothing';
        if (!window.confirm(`Replace ${plural(matches.length, 'occurrence')} across ${plural(fileCount, 'file')} ${target}?${truncatedNote}`)) {
          return;
        }
      }
      setReplacing(true);
      try {
        const outcome = await replaceMatches(matches, replaceRequest);
        const store = useSearchStore.getState();
        store.setResultsAfterEdit(resultsAfterReplace(store.results, outcome.replaced));
        const parts = [`Replaced ${plural(outcome.applied, 'occurrence')} across ${plural(outcome.fileCount, 'file')}.`];
        if (outcome.skipped > 0) parts.push(`${plural(outcome.skipped, 'occurrence')} skipped (file changed or pattern not supported).`);
        if (outcome.errors.length > 0) parts.push(outcome.errors.join('\n'));
        store.setMessage(parts.join(' '));
        // Partial results or multi-line replacements make the list stale: search again.
        if (outcome.skipped > 0 || outcome.errors.length > 0 || outcome.replaced.some(({ replacement }) => replacement.includes('\n'))) {
          store.refresh();
        }
      } catch (error) {
        console.error(error);
        useSearchStore.getState().setMessage(error instanceof Error ? error.message : 'Replace failed');
      } finally {
        setReplacing(false);
      }
    },
    [replaceRequest, replacing],
  );

  const dismiss = useCallback((matches: WorkspaceSearchMatch[]) => {
    const removed = new Set(matches);
    const store = useSearchStore.getState();
    store.setResultsAfterEdit(store.results.filter((result) => !removed.has(result)));
  }, []);

  const openResult = useCallback((result: WorkspaceSearchMatch) => {
    useSearchStore.getState().setActiveResultKey(searchResultKey(result));
    void openSearchResult(result).catch(console.error);
  }, []);

  const optionShortcuts = (event: KeyboardEvent<HTMLInputElement>): boolean => {
    if (!event.altKey || event.ctrlKey || event.metaKey) return false;
    const option: SearchToggle | undefined = (
      { c: 'isCaseSensitive', w: 'isWordMatch', r: 'isRegex', p: 'preserveCase' } as const
    )[event.key.toLowerCase() as 'c' | 'w' | 'r' | 'p'];
    if (!option) return false;
    event.preventDefault();
    actions.toggle(option);
    return true;
  };

  const onQueryKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (optionShortcuts(event)) return;
    if (event.key === 'Enter') {
      event.preventDefault();
      actions.refresh();
    }
  };

  const onReplaceKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (optionShortcuts(event)) return;
    if (event.key === 'Enter' && event.ctrlKey && event.altKey) {
      event.preventDefault();
      void replace(useSearchStore.getState().results, true);
    }
  };

  const topLevelKeys = state.viewMode === 'tree' ? tree.map((node) => node.path) : groupedResults.map(([path]) => path);
  const allCollapsed = topLevelKeys.length > 0 && topLevelKeys.every((key) => state.collapsedPaths.has(key));
  const collapseAll = (): void => {
    if (allCollapsed) actions.setAllCollapsed(null);
    else actions.setAllCollapsed([...searchTreeKeys(tree), ...groupedResults.map(([path]) => path)]);
  };
  const viewAsList = state.viewMode === 'tree';
  const hasResults = state.results.length > 0;

  return (
    <aside className="search-view" aria-label="Search">
      <div className="file-tree-header">
        <div className="file-tree-heading">
          <span className="file-tree-eyebrow">Search</span>
        </div>
        <div className="file-tree-header-actions">
          <button onClick={() => actions.refresh()} title="Refresh" aria-label="Refresh" disabled={!query}>
            {headerIcons.refresh}
          </button>
          <button
            onClick={() => {
              actions.clearResults();
              actions.requestFocus('query');
            }}
            title="Clear Search Results"
            aria-label="Clear Search Results"
            disabled={!query && !hasResults}
          >
            {headerIcons.clear}
          </button>
          <button
            onClick={() => actions.setViewMode(viewAsList ? 'list' : 'tree')}
            title={viewAsList ? 'View as List' : 'View as Tree'}
            aria-label={viewAsList ? 'View as List' : 'View as Tree'}
          >
            {viewAsList ? headerIcons.viewAsList : headerIcons.viewAsTree}
          </button>
          <button
            onClick={collapseAll}
            title={allCollapsed ? 'Expand All' : 'Collapse All'}
            aria-label={allCollapsed ? 'Expand All' : 'Collapse All'}
            disabled={!hasResults}
          >
            {allCollapsed ? headerIcons.expand : headerIcons.collapse}
          </button>
        </div>
      </div>

      <div className="search-controls">
        <div className="search-inputs">
          <button
            className={`search-replace-toggle ${state.showReplace ? 'open' : ''}`}
            type="button"
            title="Toggle Replace (Ctrl+Shift+H)"
            aria-label="Toggle Replace"
            aria-expanded={state.showReplace}
            onClick={() => actions.setShowReplace(!state.showReplace)}
          >
            {searchIcons.chevron}
          </button>
          <div className="search-input-stack">
            <div className="search-input-box">
              <input
                ref={queryRef}
                value={state.query}
                onChange={(event) => actions.setQuery(event.target.value)}
                onKeyDown={onQueryKeyDown}
                placeholder="Search"
                aria-label="Search"
                spellCheck={false}
              />
              <span className="search-input-toggles">
                <Toggle active={isCaseSensitive} title="Match Case (Alt+C)" onToggle={() => actions.toggle('isCaseSensitive')}>
                  Aa
                </Toggle>
                <Toggle active={isWordMatch} title="Match Whole Word (Alt+W)" onToggle={() => actions.toggle('isWordMatch')}>
                  <span className="search-toggle-word">ab</span>
                </Toggle>
                <Toggle active={isRegex} title="Use Regular Expression (Alt+R)" onToggle={() => actions.toggle('isRegex')}>
                  .*
                </Toggle>
              </span>
            </div>
            {state.showReplace ? (
              <div className="search-replace-row">
                <div className="search-input-box">
                  <input
                    ref={replaceRef}
                    value={state.replaceText}
                    onChange={(event) => actions.setReplaceText(event.target.value)}
                    onKeyDown={onReplaceKeyDown}
                    placeholder="Replace"
                    aria-label="Replace"
                    spellCheck={false}
                  />
                  <span className="search-input-toggles">
                    <Toggle active={state.preserveCase} title="Preserve Case (Alt+P)" onToggle={() => actions.toggle('preserveCase')}>
                      AB
                    </Toggle>
                  </span>
                </div>
                <button
                  className="search-replace-all"
                  type="button"
                  title="Replace All (Ctrl+Alt+Enter)"
                  aria-label="Replace All"
                  disabled={!hasResults || replacing}
                  onClick={() => void replace(state.results, true)}
                >
                  {searchIcons.replaceAll}
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="search-details-toggle">
          <button
            type="button"
            className={state.showDetails ? 'active' : ''}
            title="Toggle Search Details"
            aria-label="Toggle Search Details"
            aria-expanded={state.showDetails}
            onClick={() => actions.setShowDetails(!state.showDetails)}
          >
            {headerIcons.details}
          </button>
        </div>
        {state.showDetails ? (
          <div className="search-details">
            <label>
              <span>files to include</span>
              <div className="search-input-box">
                <input
                  value={state.includes}
                  onChange={(event) => actions.setIncludes(event.target.value)}
                  placeholder="e.g. *.ts, src/**/include"
                  spellCheck={false}
                />
              </div>
            </label>
            <label>
              <span>files to exclude</span>
              <div className="search-input-box">
                <input
                  value={state.excludes}
                  onChange={(event) => actions.setExcludes(event.target.value)}
                  placeholder="e.g. *.ts, src/**/exclude"
                  spellCheck={false}
                />
                <span className="search-input-toggles">
                  <Toggle
                    active={useIgnoreFiles}
                    title="Use Exclude Settings and Ignore Files"
                    onToggle={() => actions.toggle('useIgnoreFiles')}
                  >
                    {headerIcons.ignoreFiles}
                  </Toggle>
                </span>
              </div>
            </label>
          </div>
        ) : null}
      </div>

      <div className="search-body" ref={bodyRef}>
        {!workspace ? <div className="search-empty">Open a folder to search files.</div> : null}
        {workspace && state.error ? <div className="search-empty search-error">{state.error}</div> : null}
        {state.message ? <div className="search-message">{state.message}</div> : null}
        {workspace && state.loading && !hasResults ? <div className="search-empty">Searching…</div> : null}
        {workspace && !state.loading && !state.error && state.hasSearched && query && !hasResults && !state.message ? (
          <div className="search-empty">No results found. Review your settings for configured exclusions and check your gitignore files.</div>
        ) : null}
        {workspace && hasResults ? (
          <>
            <div className="search-summary">
              {plural(state.results.length, 'result')} in {plural(groupedResults.length, 'file')}
              {state.truncated ? (
                <div className="search-warning">
                  The result set only contains a subset of all matches. Be more specific in your search to narrow down the results.
                </div>
              ) : null}
            </div>
            <SearchResultTree
              viewMode={state.viewMode}
              tree={tree}
              groups={groupedResults}
              rootPath={workspace.rootPath}
              collapsedPaths={state.collapsedPaths}
              activeResultKey={state.activeResultKey}
              replacementFor={state.showReplace ? previewReplacement : undefined}
              busy={replacing}
              onToggle={actions.toggleCollapsed}
              onOpen={openResult}
              onReplace={(matches) => void replace(matches, false)}
              onReplaceFolder={(matches) => void replace(matches, true)}
              onDismiss={dismiss}
            />
          </>
        ) : null}
      </div>
    </aside>
  );
}
