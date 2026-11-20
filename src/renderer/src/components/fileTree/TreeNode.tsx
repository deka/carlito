import type { MouseEvent } from 'react';
import type { FileTreeNode, GitFileStatus } from '@shared/file-types';
import { DevIcon } from './DevIcon';
import { iconForNode } from './icons';
import { InlineCreateRow } from './InlineCreateRow';
import { parentDirectory } from './treeUtils';
import { useCreateContext, useTreeDragContext } from './types';

const gitStatusLabels: Record<GitFileStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  ignored: 'I',
  conflict: 'C',
};

export function TreeNode({
  node,
  depth,
  activePath,
  expandedPaths,
  onToggleDirectory,
  onOpenFile,
  onContextMenu,
}: {
  node: FileTreeNode;
  depth: number;
  activePath: string | undefined;
  expandedPaths: Set<string>;
  onToggleDirectory: (node: FileTreeNode) => void;
  onOpenFile: (node: FileTreeNode) => void;
  onContextMenu: (event: MouseEvent, node: FileTreeNode) => void;
}) {
  const createCtx = useCreateContext();
  const dragCtx = useTreeDragContext();
  const expanded = expandedPaths.has(node.path);
  const isDirectory = node.type === 'directory';
  const icon = iconForNode(node, expanded);
  const dropDirectory = isDirectory ? node.path : parentDirectory(node.path);
  return (
    <li>
      <button
        className={`tree-row ${isDirectory ? 'directory' : 'file'} ${node.gitStatus ? `git-${node.gitStatus}` : ''} ${node.path === activePath ? 'active' : ''} ${isDirectory && dragCtx.dropTarget === node.path ? 'drop-target' : ''}`}
        data-tree-path={node.path}
        draggable
        onDragStart={(event) => dragCtx.onDragStart(event, node)}
        onDragOver={(event) => dragCtx.onDragOver(event, node, dropDirectory)}
        onDrop={(event) => dragCtx.onDrop(event, dropDirectory)}
        onDragEnd={dragCtx.onDragEnd}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (isDirectory ? onToggleDirectory(node) : onOpenFile(node))}
        onContextMenu={(event) => onContextMenu(event, node)}
        title={node.gitStatus ? `${node.path} · ${node.gitStatus}` : node.path}
      >
        <span className="tree-chevron">{isDirectory ? (expanded ? '▾' : '▸') : ''}</span>
        <DevIcon icon={icon} />
        <span className="tree-name">{node.name}</span>
        {node.gitStatus ? <span className="tree-git-badge">{gitStatusLabels[node.gitStatus]}</span> : null}
      </button>
      {isDirectory && expanded && node.children ? (
        <ul className={dragCtx.dropTarget === node.path ? 'drop-target-children' : undefined}>
          {createCtx.prompt?.parentPath === node.path ? (
            <InlineCreateRow
              kind={createCtx.prompt.kind}
              depth={depth + 1}
              name={createCtx.name}
              inputRef={createCtx.inputRef}
              onChange={createCtx.onNameChange}
              onSubmit={createCtx.onSubmit}
              onCancel={createCtx.onCancel}
            />
          ) : null}
          {node.children.map((child) => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activePath={activePath}
              expandedPaths={expandedPaths}
              onToggleDirectory={onToggleDirectory}
              onOpenFile={onOpenFile}
              onContextMenu={onContextMenu}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}
