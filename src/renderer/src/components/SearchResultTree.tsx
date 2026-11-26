import type { WorkspaceSearchMatch } from '@shared/file-types';
import { relativePath } from '../commands/builtin/pathUtils';
import type { SearchTreeFolder, SearchTreeNode } from '../search/resultTree';
import type { SearchViewMode } from '../store/useSearchStore';
import { DevIcon } from './fileTree/DevIcon';
import { iconForNode } from './fileTree/icons';
import { onActivateKey, RowAction, SearchFileSection, searchIcons, searchIndent } from './SearchFileSection';

interface SearchResultTreeProps {
  viewMode: SearchViewMode;
  /** Tree view nodes. */
  tree: SearchTreeNode[];
  /** List view groups, in path order. */
  groups: [string, WorkspaceSearchMatch[]][];
  rootPath: string;
  collapsedPaths: Set<string>;
  activeResultKey: string | null;
  replacementFor?: (result: WorkspaceSearchMatch) => string | null;
  busy: boolean;
  onToggle: (path: string) => void;
  onOpen: (result: WorkspaceSearchMatch) => void;
  onReplace: (results: WorkspaceSearchMatch[]) => void;
  /** Replace All in Folder: can cover most of the workspace, so it asks first. */
  onReplaceFolder: (results: WorkspaceSearchMatch[]) => void;
  onDismiss: (results: WorkspaceSearchMatch[]) => void;
}

type NodeProps = Omit<SearchResultTreeProps, 'viewMode' | 'tree' | 'groups' | 'rootPath'>;

function FolderNode({ folder, depth, ...props }: NodeProps & { folder: SearchTreeFolder; depth: number }) {
  const collapsed = props.collapsedPaths.has(folder.path);
  const toggle = (): void => props.onToggle(folder.path);
  // The last segment picks the icon (`src/main/ipc` gets the ipc folder icon).
  const iconName = folder.name.slice(folder.name.lastIndexOf('/') + 1);
  return (
    <li className={`search-folder ${collapsed ? 'collapsed' : ''}`}>
      <div
        className="search-file-title search-folder-title"
        role="button"
        tabIndex={0}
        title={folder.path}
        aria-expanded={!collapsed}
        style={{ paddingLeft: 4 + depth * searchIndent }}
        onClick={toggle}
        onKeyDown={onActivateKey(toggle)}
      >
        <span className="search-chevron">{searchIcons.chevron}</span>
        <DevIcon icon={iconForNode({ name: iconName, path: folder.path, uri: '', type: 'directory' }, !collapsed)} />
        <span className="search-file-name search-folder-name">{folder.name}</span>
        <span className="search-row-actions">
          {props.replacementFor ? (
            <RowAction title="Replace All in Folder" disabled={props.busy} onClick={() => props.onReplaceFolder(folder.matches)}>
              {searchIcons.replaceAll}
            </RowAction>
          ) : null}
          <RowAction title="Dismiss" onClick={() => props.onDismiss(folder.matches)}>
            {searchIcons.dismiss}
          </RowAction>
        </span>
        <span className="search-count">{folder.matches.length}</span>
      </div>
      {collapsed ? null : <TreeNodes nodes={folder.children} depth={depth + 1} {...props} />}
    </li>
  );
}

function FileNode({
  path,
  name,
  directory,
  matches,
  depth,
  ...props
}: NodeProps & { path: string; name: string; directory?: string; matches: WorkspaceSearchMatch[]; depth: number }) {
  return (
    <SearchFileSection
      path={path}
      name={name}
      directory={directory}
      depth={depth}
      results={matches}
      collapsed={props.collapsedPaths.has(path)}
      activeResultKey={props.activeResultKey}
      replacementFor={props.replacementFor}
      busy={props.busy}
      onToggle={() => props.onToggle(path)}
      onOpen={props.onOpen}
      onReplace={props.onReplace}
      onDismiss={props.onDismiss}
    />
  );
}

function TreeNodes({ nodes, depth, ...props }: NodeProps & { nodes: SearchTreeNode[]; depth: number }) {
  return (
    <ul>
      {nodes.map((node) =>
        node.kind === 'folder' ? (
          <FolderNode key={`d:${node.path}`} folder={node} depth={depth} {...props} />
        ) : (
          <FileNode key={node.path} path={node.path} name={node.name} matches={node.matches} depth={depth} {...props} />
        ),
      )}
    </ul>
  );
}

/** Search results as a folder tree (like the Explorer) or as a flat list of files. */
export function SearchResultTree({ viewMode, tree, groups, rootPath, ...props }: SearchResultTreeProps) {
  if (viewMode === 'tree') return <TreeNodes nodes={tree} depth={0} {...props} />;
  return (
    <ul>
      {groups.map(([path, matches]) => {
        const relative = relativePath(path, rootPath).replaceAll('\\', '/');
        const slash = relative.lastIndexOf('/');
        return (
          <FileNode
            key={path}
            path={path}
            name={relative.slice(slash + 1)}
            directory={slash > 0 ? relative.slice(0, slash) : undefined}
            matches={matches}
            depth={0}
            {...props}
          />
        );
      })}
    </ul>
  );
}
