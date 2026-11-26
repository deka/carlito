import { useCallback, useMemo, useState, type ReactNode } from 'react';
import type { GitChangedFile, GitFileStatus } from '@shared/file-types';
import { titleFromPath } from '../commands/builtin/pathUtils';
import { statusLabels, statusTitles } from '../git/gitStatusMaps';

export type GitFileSection = 'staged' | 'unstaged';

interface GitFileListProps {
  files: GitChangedFile[];
  section: GitFileSection;
  /** Stage (Changes section) or unstage (Staged Changes section) the given files. */
  onAction: (files: GitChangedFile[]) => void;
  /** Show the changes of a file. */
  onOpen: (file: GitChangedFile) => void;
  disabled: boolean;
}

interface GitTreeFolder {
  /** Slash-separated path relative to the workspace, used as the collapse key. */
  key: string;
  /** Displayed name; chains of single-child folders are merged (`src/main/ipc`). */
  name: string;
  folders: GitTreeFolder[];
  files: GitChangedFile[];
  /** Every file below this folder, for folder-level stage/unstage. */
  allFiles: GitChangedFile[];
}

function sectionStatus(file: GitChangedFile, section: GitFileSection): GitFileStatus {
  return (section === 'staged' ? file.staged : file.unstaged) ?? file.status;
}

function buildTree(files: GitChangedFile[]): GitTreeFolder {
  const root: GitTreeFolder = { key: '', name: '', folders: [], files: [], allFiles: [] };
  for (const file of files) {
    const segments = file.relativePath.replaceAll('\\', '/').split('/').filter(Boolean);
    segments.pop();
    let folder = root;
    folder.allFiles.push(file);
    for (const segment of segments) {
      const key = folder.key ? `${folder.key}/${segment}` : segment;
      let child = folder.folders.find((candidate) => candidate.key === key);
      if (!child) {
        child = { key, name: segment, folders: [], files: [], allFiles: [] };
        folder.folders.push(child);
      }
      child.allFiles.push(file);
      folder = child;
    }
    folder.files.push(file);
  }
  return sortAndCompact(root);
}

function sortAndCompact(folder: GitTreeFolder): GitTreeFolder {
  let current = folder;
  // Merge `a` → `b` when `a` holds nothing but `b` (never the root).
  while (current.key && current.files.length === 0 && current.folders.length === 1) {
    const only = current.folders[0]!;
    current = { ...only, name: `${current.name}/${only.name}` };
  }
  return {
    ...current,
    folders: current.folders.map(sortAndCompact).sort((a, b) => a.name.localeCompare(b.name)),
    files: [...current.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

const chevron = (
  <svg viewBox="0 0 16 16" aria-hidden="true">
    <path d="m6 4 4 4-4 4" />
  </svg>
);

export function GitFileList({ files, section, onAction, onOpen, disabled }: GitFileListProps) {
  const tree = useMemo(() => buildTree(files), [files]);
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const toggleFolder = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  }, []);

  const actionLabel = section === 'staged' ? '−' : '+';
  const actionTitle = section === 'staged' ? 'Unstage' : 'Stage';
  const indent = (depth: number) => ({ paddingLeft: 8 + depth * 14 });

  function renderFolder(folder: GitTreeFolder, depth: number): ReactNode {
    return (
      <>
        {folder.folders.map((child) => {
          const isCollapsed = collapsed.has(child.key);
          return (
            <li className="git-panel-folder" key={`d:${child.key}`}>
              <div className="git-panel-row" title={child.key}>
                <button
                  className="git-panel-open git-panel-folder-open"
                  type="button"
                  style={indent(depth)}
                  aria-expanded={!isCollapsed}
                  onClick={() => toggleFolder(child.key)}
                >
                  <span className={`git-panel-chevron${isCollapsed ? '' : ' expanded'}`}>{chevron}</span>
                  <span className="git-panel-file">
                    <span>{child.name}</span>
                    <small>{child.allFiles.length}</small>
                  </span>
                </button>
                <button
                  className="git-panel-action git-panel-row-action"
                  type="button"
                  onClick={() => onAction(child.allFiles)}
                  disabled={disabled}
                  title={`${actionTitle} ${child.key}`}
                  aria-label={`${actionTitle} ${child.key}`}
                >
                  {actionLabel}
                </button>
              </div>
              {isCollapsed ? null : <ul className="git-panel-list">{renderFolder(child, depth + 1)}</ul>}
            </li>
          );
        })}
        {folder.files.map((file) => {
          const status = sectionStatus(file, section);
          return (
            <li className="git-panel-row" key={file.path} title={`${statusTitles[status]} · ${file.relativePath}`}>
              <button className="git-panel-open" type="button" style={indent(depth)} onClick={() => onOpen(file)}>
                <span className={`git-panel-status git-${status}`}>{statusLabels[status]}</span>
                <span className="git-panel-file">
                  <span>{titleFromPath(file.relativePath)}</span>
                </span>
              </button>
              <button
                className="git-panel-action git-panel-row-action"
                type="button"
                onClick={() => onAction([file])}
                disabled={disabled}
                title={`${actionTitle} ${file.relativePath}`}
                aria-label={`${actionTitle} ${file.relativePath}`}
              >
                {actionLabel}
              </button>
            </li>
          );
        })}
      </>
    );
  }

  return <ul className="git-panel-list">{renderFolder(tree, 0)}</ul>;
}
