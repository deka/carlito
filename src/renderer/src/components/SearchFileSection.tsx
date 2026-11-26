import type { KeyboardEvent, ReactNode } from 'react';
import type { WorkspaceSearchMatch } from '@shared/file-types';
import { HighlightedPreview } from './HighlightedPreview';
import { DevIcon } from './fileTree/DevIcon';
import { iconForNode } from './fileTree/icons';
import { searchResultKey } from '../store/useSearchStore';

/** Indentation per tree level, in pixels. */
export const searchIndent = 12;

interface SearchFileSectionProps {
  path: string;
  name: string;
  /** Folder shown after the name (list view); omitted in the tree view. */
  directory?: string;
  depth: number;
  results: WorkspaceSearchMatch[];
  collapsed: boolean;
  activeResultKey: string | null;
  /** Replacement preview per match; undefined when the replace box is closed. */
  replacementFor?: (result: WorkspaceSearchMatch) => string | null;
  busy: boolean;
  onToggle: () => void;
  onOpen: (result: WorkspaceSearchMatch) => void;
  onReplace: (results: WorkspaceSearchMatch[]) => void;
  onDismiss: (results: WorkspaceSearchMatch[]) => void;
}

export const searchIcons = {
  replace: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M3 4.5h6.5M7.5 2.5l2 2-2 2M13 11.5H6.5M8.5 9.5l-2 2 2 2" />
    </svg>
  ),
  replaceAll: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 3.5h7M7.5 1.5l2 2-2 2M2.5 7.5h7M13.5 12H6.5M8.5 10l-2 2 2 2" />
    </svg>
  ),
  dismiss: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m5 5 6 6M11 5l-6 6" />
    </svg>
  ),
  chevron: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="m6 4 4 4-4 4" />
    </svg>
  ),
};

export function onActivateKey(action: () => void) {
  return (event: KeyboardEvent): void => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      action();
    }
  };
}

export function RowAction({ title, onClick, disabled, children }: { title: string; onClick: () => void; disabled?: boolean; children: ReactNode }) {
  return (
    <button
      className="search-row-action"
      type="button"
      title={title}
      aria-label={title}
      disabled={disabled}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
    >
      {children}
    </button>
  );
}

export function SearchFileSection({
  path,
  name,
  directory,
  depth,
  results,
  collapsed,
  activeResultKey,
  replacementFor,
  busy,
  onToggle,
  onOpen,
  onReplace,
  onDismiss,
}: SearchFileSectionProps) {
  return (
    <li className={`search-file ${collapsed ? 'collapsed' : ''}`}>
      <div
        className="search-file-title"
        role="button"
        tabIndex={0}
        title={path}
        aria-expanded={!collapsed}
        style={{ paddingLeft: 4 + depth * searchIndent }}
        onClick={onToggle}
        onKeyDown={onActivateKey(onToggle)}
      >
        <span className="search-chevron">{searchIcons.chevron}</span>
        <DevIcon icon={iconForNode({ name, path, uri: '', type: 'file' }, false)} />
        <span className="search-file-name">{name}</span>
        {directory ? <span className="search-file-dir">{directory}</span> : null}
        <span className="search-row-actions">
          {replacementFor ? (
            <RowAction title="Replace All in File" disabled={busy} onClick={() => onReplace(results)}>
              {searchIcons.replaceAll}
            </RowAction>
          ) : null}
          <RowAction title="Dismiss" onClick={() => onDismiss(results)}>
            {searchIcons.dismiss}
          </RowAction>
        </span>
        <span className="search-count">{results.length}</span>
      </div>
      {collapsed ? null : (
        <ul>
          {results.map((result) => {
            const key = searchResultKey(result);
            return (
              <li key={key}>
                <div
                  className={`search-row ${key === activeResultKey ? 'active' : ''}`}
                  data-result-key={key}
                  role="button"
                  tabIndex={0}
                  style={{ paddingLeft: 4 + (depth + 1) * searchIndent + 18 }}
                  title={`${result.lineNumber}:${result.column}  ${result.preview.trim().slice(0, 300)}`}
                  onClick={() => onOpen(result)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') onOpen(result);
                  }}
                >
                  <HighlightedPreview result={result} replacement={replacementFor?.(result)} />
                  <span className="search-row-actions">
                    {replacementFor ? (
                      <RowAction title="Replace" disabled={busy} onClick={() => onReplace([result])}>
                        {searchIcons.replace}
                      </RowAction>
                    ) : null}
                    <RowAction title="Dismiss" onClick={() => onDismiss([result])}>
                      {searchIcons.dismiss}
                    </RowAction>
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
