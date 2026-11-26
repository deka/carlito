import { create } from 'zustand';
import type { WorkspaceSearchMatch } from '@shared/file-types';

export type SearchViewMode = 'tree' | 'list';

export type SearchToggle = 'isCaseSensitive' | 'isWordMatch' | 'isRegex' | 'preserveCase' | 'useIgnoreFiles';

interface SearchState {
  query: string;
  replaceText: string;
  includes: string;
  excludes: string;
  isCaseSensitive: boolean;
  isWordMatch: boolean;
  isRegex: boolean;
  preserveCase: boolean;
  useIgnoreFiles: boolean;
  showReplace: boolean;
  showDetails: boolean;
  /** Results grouped by folder (like the Explorer) or as a flat list of files. */
  viewMode: SearchViewMode;

  results: WorkspaceSearchMatch[];
  loading: boolean;
  truncated: boolean;
  error: string | null;
  /** Feedback after a replace (counts, skipped matches). */
  message: string | null;
  hasSearched: boolean;
  /** Collapsed files (their path) and folders (absolute path with `/` separators). */
  collapsedPaths: Set<string>;
  /** Result last opened from the list or with F4 / Shift+F4. */
  activeResultKey: string | null;
  /** Bumped to re-run the search with unchanged inputs. */
  refreshSeq: number;
  /**
   * Inputs of the search the results come from. Remounting the view (sidebar hidden then shown)
   * must not search again: that would bring back dismissed or already replaced matches.
   */
  lastSearchSignature: string | null;
  /** Bumped to move the keyboard focus into an input of the search view. */
  focusRequest: { target: 'query' | 'replace'; seq: number };

  setQuery: (query: string) => void;
  setReplaceText: (replaceText: string) => void;
  setIncludes: (includes: string) => void;
  setExcludes: (excludes: string) => void;
  toggle: (option: SearchToggle) => void;
  setShowReplace: (showReplace: boolean) => void;
  setShowDetails: (showDetails: boolean) => void;
  setViewMode: (viewMode: SearchViewMode) => void;
  setLoading: (loading: boolean) => void;
  setResults: (results: WorkspaceSearchMatch[], truncated: boolean) => void;
  setError: (error: string | null) => void;
  setMessage: (message: string | null) => void;
  setResultsAfterEdit: (results: WorkspaceSearchMatch[]) => void;
  clearResults: () => void;
  refresh: () => void;
  requestFocus: (target: 'query' | 'replace') => void;
  toggleCollapsed: (path: string) => void;
  /** Collapses the given files and folders; `null` expands everything. */
  setAllCollapsed: (paths: string[] | null) => void;
  /** Expands a file and every folder above it. */
  revealPath: (path: string) => void;
  setActiveResultKey: (key: string | null) => void;
  setLastSearchSignature: (signature: string | null) => void;
}

export function searchResultKey(result: WorkspaceSearchMatch): string {
  return `${result.path}:${result.lineNumber}:${result.matchStart}`;
}

export const useSearchStore = create<SearchState>((set, get) => ({
  query: '',
  replaceText: '',
  includes: '',
  excludes: '',
  isCaseSensitive: false,
  isWordMatch: false,
  isRegex: false,
  preserveCase: false,
  useIgnoreFiles: true,
  showReplace: false,
  showDetails: false,
  viewMode: 'tree',

  results: [],
  loading: false,
  truncated: false,
  error: null,
  message: null,
  hasSearched: false,
  collapsedPaths: new Set(),
  activeResultKey: null,
  refreshSeq: 0,
  lastSearchSignature: null,
  focusRequest: { target: 'query', seq: 0 },

  setQuery: (query) => set({ query, hasSearched: false, message: null }),
  setReplaceText: (replaceText) => set({ replaceText }),
  setIncludes: (includes) => set({ includes, message: null }),
  setExcludes: (excludes) => set({ excludes, message: null }),
  toggle: (option) =>
    set((state) => ({ [option]: !state[option], message: null }) as Pick<SearchState, SearchToggle | 'message'>),
  setShowReplace: (showReplace) => set({ showReplace }),
  setShowDetails: (showDetails) => set({ showDetails }),
  setViewMode: (viewMode) => set({ viewMode }),
  setLoading: (loading) => set({ loading }),
  setResults: (results, truncated) =>
    set({ results, truncated, error: null, hasSearched: true, collapsedPaths: new Set(), activeResultKey: null }),
  setError: (error) => set({ error }),
  setMessage: (message) => set({ message }),
  setResultsAfterEdit: (results) => set({ results }),
  clearResults: () =>
    set({ query: '', results: [], truncated: false, error: null, message: null, hasSearched: false, activeResultKey: null }),
  refresh: () => set({ refreshSeq: get().refreshSeq + 1 }),
  requestFocus: (target) => set({ focusRequest: { target, seq: get().focusRequest.seq + 1 } }),
  toggleCollapsed: (path) =>
    set((state) => {
      const collapsedPaths = new Set(state.collapsedPaths);
      if (!collapsedPaths.delete(path)) collapsedPaths.add(path);
      return { collapsedPaths };
    }),
  setAllCollapsed: (paths) => set({ collapsedPaths: new Set(paths ?? []) }),
  revealPath: (path) =>
    set((state) => {
      const normalized = path.replaceAll('\\', '/');
      const collapsedPaths = new Set(
        [...state.collapsedPaths].filter((key) => key !== path && !normalized.startsWith(`${key}/`)),
      );
      return collapsedPaths.size === state.collapsedPaths.size ? {} : { collapsedPaths };
    }),
  setActiveResultKey: (activeResultKey) => set({ activeResultKey }),
  setLastSearchSignature: (lastSearchSignature) => set({ lastSearchSignature }),
}));
