import type { GitChangedFile, GitFileStatus } from '@shared/file-types';
import { openGitChanges } from '../git/diffTabs';
import { directoryFromRelativePath, titleFromPath } from '../commands/builtin/pathUtils';
import { statusLabels, statusTitles } from '../git/gitStatusMaps';

export type GitFileSection = 'staged' | 'unstaged';

interface GitFileListProps {
  files: GitChangedFile[];
  section: GitFileSection;
  /** Stage (Changes section) or unstage (Staged Changes section) the given files. */
  onAction: (files: GitChangedFile[]) => void;
  disabled: boolean;
}

function sectionStatus(file: GitChangedFile, section: GitFileSection): GitFileStatus {
  return (section === 'staged' ? file.staged : file.unstaged) ?? file.status;
}

export function GitFileList({ files, section, onAction, disabled }: GitFileListProps) {
  const actionLabel = section === 'staged' ? '−' : '+';
  const actionTitle = section === 'staged' ? 'Unstage' : 'Stage';
  return (
    <ul className="git-panel-list">
      {files.map((file) => {
        const status = sectionStatus(file, section);
        return (
          <li
            className="git-panel-row"
            key={file.path}
            title={`${statusTitles[status]} · ${file.relativePath}`}
          >
            <button
              className="git-panel-open"
              type="button"
              onClick={() => openGitChanges(file.path)}
            >
              <span className={`git-panel-status git-${status}`}>{statusLabels[status]}</span>
              <span className="git-panel-file">
                <span>{titleFromPath(file.relativePath)}</span>
                <small>{directoryFromRelativePath(file.relativePath)}</small>
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
    </ul>
  );
}
