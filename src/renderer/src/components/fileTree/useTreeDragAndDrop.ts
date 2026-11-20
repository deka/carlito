import { useEffect, useRef, useState } from 'react';
import type { DragEvent } from 'react';
import type { FileTreeNode, WorkspaceFolderResult } from '@shared/file-types';
import type { TreeDragContextValue } from './types';

const treeDragDataType = 'application/x-carlo-tree-path';
const autoExpandDelayMs = 600;

export interface TreeDragAndDrop extends TreeDragContextValue {
  onBodyDragOver: (event: DragEvent) => void;
  onBodyDrop: (event: DragEvent) => void;
  onBodyDragLeave: (event: DragEvent) => void;
}

export function useTreeDragAndDrop({
  workspace,
  expandedPaths,
  toggleDirectory,
  canMoveNode,
  moveNode,
}: {
  workspace: WorkspaceFolderResult | undefined;
  expandedPaths: Set<string>;
  toggleDirectory: (node: FileTreeNode) => void;
  canMoveNode: (sourcePath: string, destinationDirectory: string) => boolean;
  moveNode: (sourcePath: string, destinationDirectory: string) => Promise<void>;
}): TreeDragAndDrop {
  // dataTransfer payloads are unreadable during dragover, so keep the dragged path locally.
  const draggedPathRef = useRef<string | undefined>(undefined);
  const expandTimerRef = useRef<{ path: string; handle: number } | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<string | undefined>(undefined);

  function clearExpandTimer(): void {
    if (expandTimerRef.current) window.clearTimeout(expandTimerRef.current.handle);
    expandTimerRef.current = undefined;
  }

  useEffect(() => clearExpandTimer, []);

  function reset(): void {
    draggedPathRef.current = undefined;
    clearExpandTimer();
    setDropTarget(undefined);
  }

  function isTreeDrag(event: DragEvent): boolean {
    return draggedPathRef.current !== undefined && event.dataTransfer.types.includes(treeDragDataType);
  }

  function acceptDrop(event: DragEvent, destinationDirectory: string): boolean {
    event.stopPropagation();
    if (!isTreeDrag(event)) return false;
    const sourcePath = draggedPathRef.current!;
    if (!canMoveNode(sourcePath, destinationDirectory)) {
      event.dataTransfer.dropEffect = 'none';
      setDropTarget(undefined);
      return false;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    setDropTarget(destinationDirectory);
    return true;
  }

  function scheduleAutoExpand(node: FileTreeNode): void {
    if (node.type !== 'directory' || expandedPaths.has(node.path)) {
      clearExpandTimer();
      return;
    }
    if (expandTimerRef.current?.path === node.path) return;
    clearExpandTimer();
    const handle = window.setTimeout(() => {
      expandTimerRef.current = undefined;
      toggleDirectory(node);
    }, autoExpandDelayMs);
    expandTimerRef.current = { path: node.path, handle };
  }

  function drop(event: DragEvent, destinationDirectory: string): void {
    event.stopPropagation();
    if (!isTreeDrag(event)) return;
    const sourcePath = draggedPathRef.current!;
    reset();
    if (!canMoveNode(sourcePath, destinationDirectory)) return;
    event.preventDefault();
    void moveNode(sourcePath, destinationDirectory);
  }

  return {
    dropTarget,
    onDragStart: (event, node) => {
      event.stopPropagation();
      draggedPathRef.current = node.path;
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(treeDragDataType, node.path);
    },
    onDragOver: (event, node, destinationDirectory) => {
      if (acceptDrop(event, destinationDirectory)) scheduleAutoExpand(node);
      else clearExpandTimer();
    },
    onDrop: drop,
    onDragEnd: reset,
    onBodyDragOver: (event) => {
      clearExpandTimer();
      if (workspace) acceptDrop(event, workspace.rootPath);
    },
    onBodyDrop: (event) => {
      if (workspace) drop(event, workspace.rootPath);
    },
    onBodyDragLeave: (event) => {
      const next = event.relatedTarget;
      if (next instanceof Node && event.currentTarget.contains(next)) return;
      clearExpandTimer();
      setDropTarget(undefined);
    },
  };
}
