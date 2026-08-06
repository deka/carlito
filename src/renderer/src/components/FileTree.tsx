import type { FormEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { InlineCreateRow } from './fileTree/InlineCreateRow';
import { TreeNode } from './fileTree/TreeNode';
import { CreateContext } from './fileTree/types';
import { useActiveTabPath } from './fileTree/useActiveTabPath';
import { useFileTreeOperations } from './fileTree/useFileTreeOperations';
import { useInitialWorkspace } from './fileTree/useInitialWorkspace';
import { useRevealActivePath } from './fileTree/useRevealActivePath';
import { useTreeContextMenu } from './fileTree/useTreeContextMenu';
import { useWorkspaceTree } from './fileTree/useWorkspaceTree';
import { useWorkspaceWatcher } from './fileTree/useWorkspaceWatcher';

export function FileTree() {
  useInitialWorkspace();
  const workspace = useEditorStore((state) => state.workspace) ?? undefined;
  const activeTabPath = useActiveTabPath();
  const tree = useWorkspaceTree(workspace);
  const { contextMenu, openContextMenu, closeContextMenu } = useTreeContextMenu(workspace);
  const operations = useFileTreeOperations({ workspace, tree, closeContextMenu });

  useWorkspaceWatcher(workspace, tree.reloadPreservingScroll);
  useRevealActivePath({
    workspace,
    activeTabPath,
    nodes: tree.nodes,
    expandedPaths: tree.expandedPaths,
    bodyRef: tree.bodyRef,
    setExpandedPaths: tree.setExpandedPaths,
    setNodes: tree.setNodes,
  });

  const createContextValue = {
    prompt: operations.createPrompt,
    name: operations.createName,
    inputRef: operations.createInputRef,
    onNameChange: operations.setCreateName,
    onSubmit: (event: FormEvent) => void operations.submitCreate(event),
    onCancel: operations.cancelCreate,
  };

  return (
    <aside className="file-tree">
      <div className="file-tree-header">
        <div className="file-tree-heading">
          <span className="file-tree-eyebrow">Explorer</span>
          <strong>{workspace?.name ?? 'No workspace'}</strong>
        </div>
        <div className="file-tree-header-actions">
          {workspace ? (
            <>
              <button onClick={() => tree.setExpandedPaths(new Set())} title="Collapse all" aria-label="Collapse all">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4-4 4 4M8 2v8M3 13h10" /></svg>
              </button>
              <button onClick={() => void tree.reload().catch(console.error)} title="Refresh" aria-label="Refresh Explorer">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M12.5 5.5A5 5 0 1 0 13 10M12.5 2.5v3.25H9.25" /></svg>
              </button>
            </>
          ) : null}
        </div>
      </div>
      <div className="file-tree-body" ref={tree.bodyRef} onContextMenu={(event) => openContextMenu(event)}>
        {tree.loading ? (
          <div className="tree-empty">Loading…</div>
        ) : (
          <CreateContext.Provider value={createContextValue}>
            <ul>
              {workspace && operations.createPrompt?.parentPath === workspace.rootPath ? (
                <InlineCreateRow
                  kind={operations.createPrompt.kind}
                  depth={0}
                  name={operations.createName}
                  inputRef={operations.createInputRef}
                  onChange={operations.setCreateName}
                  onSubmit={(event) => void operations.submitCreate(event)}
                  onCancel={operations.cancelCreate}
                />
              ) : null}
              {tree.nodes.map((node) => (
                <TreeNode
                  key={node.path}
                  node={node}
                  depth={0}
                  activePath={activeTabPath}
                  expandedPaths={tree.expandedPaths}
                  onToggleDirectory={tree.toggleDirectory}
                  onOpenFile={operations.openNode}
                  onContextMenu={openContextMenu}
                />
              ))}
            </ul>
          </CreateContext.Provider>
        )}
      </div>
      {contextMenu ? (
        <div
          className="tree-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(event) => event.stopPropagation()}
          onContextMenu={(event) => event.preventDefault()}
        >
          <button disabled={!contextMenu.node} onClick={() => operations.copyNode(contextMenu)}>
            Copy
          </button>
          <button disabled={!operations.clipboard} onClick={() => operations.pasteNode(contextMenu)}>
            Paste{operations.clipboard ? ` "${operations.clipboard.name}"` : ''}
          </button>
          <div className="tree-context-separator" />
          <button disabled={!contextMenu.node} onClick={() => operations.copyAbsolutePath(contextMenu)}>
            Copy Path
          </button>
          <button disabled={!contextMenu.node} onClick={() => operations.copyRelativePath(contextMenu)}>
            Copy Relative Path
          </button>
          <button disabled={!contextMenu.node} onClick={() => operations.revealInFolder(contextMenu)}>
            Reveal in Finder
          </button>
          <div className="tree-context-separator" />
          <button onClick={() => operations.startCreate(contextMenu, 'file')}>New File…</button>
          <button onClick={() => operations.startCreate(contextMenu, 'directory')}>New Folder…</button>
          <button disabled={!contextMenu.node} onClick={() => operations.renameNode(contextMenu)}>
            Rename…
          </button>
          <div className="tree-context-separator" />
          <button className="danger" disabled={!contextMenu.node} onClick={() => operations.deleteNode(contextMenu)}>
            Delete
          </button>
        </div>
      ) : null}
    </aside>
  );
}
