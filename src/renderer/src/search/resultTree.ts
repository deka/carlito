import type { WorkspaceSearchMatch } from '@shared/file-types';
import { groupByPath } from '../utils/groupByPath';

export interface SearchTreeFile {
  kind: 'file';
  /** Absolute path as returned by the search (also the collapse key). */
  path: string;
  name: string;
  matches: WorkspaceSearchMatch[];
}

export interface SearchTreeFolder {
  kind: 'folder';
  /** Absolute folder path with `/` separators (collapse key). */
  path: string;
  /** Display name; compacted chains read `src/main/ipc`. */
  name: string;
  children: SearchTreeNode[];
  /** Every match below this folder. */
  matches: WorkspaceSearchMatch[];
}

export type SearchTreeNode = SearchTreeFile | SearchTreeFolder;

interface MutableFolder {
  path: string;
  name: string;
  folders: Map<string, MutableFolder>;
  files: SearchTreeFile[];
}

const byName = (a: { name: string }, b: { name: string }): number =>
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

function finish(folder: MutableFolder): SearchTreeFolder {
  const folders = [...folder.folders.values()].map(finish).sort(byName);
  const files = [...folder.files].sort(byName);
  // A folder that only holds one folder is shown on one row, as VS Code does.
  if (files.length === 0 && folders.length === 1) {
    const only = folders[0]!;
    return { ...only, name: folder.name ? `${folder.name}/${only.name}` : only.name };
  }
  const children: SearchTreeNode[] = [...folders, ...files];
  return {
    kind: 'folder',
    path: folder.path,
    name: folder.name,
    children,
    matches: children.flatMap((child) => child.matches),
  };
}

/**
 * Groups search results by folder, relative to the workspace root, like the Explorer.
 * Folders come first, then files, both sorted by name.
 */
export function buildSearchTree(groups: [string, WorkspaceSearchMatch[]][], rootPath: string): SearchTreeNode[] {
  const root = rootPath.replaceAll('\\', '/').replace(/\/+$/, '');
  const top: MutableFolder = { path: root, name: '', folders: new Map(), files: [] };
  for (const [path, matches] of groups) {
    const normalized = path.replaceAll('\\', '/');
    const relative = normalized.startsWith(`${root}/`) ? normalized.slice(root.length + 1) : null;
    const segments = relative ? relative.split('/') : [normalized.slice(normalized.lastIndexOf('/') + 1)];
    let folder = top;
    for (const segment of segments.slice(0, -1)) {
      let child = folder.folders.get(segment);
      if (!child) {
        child = { path: `${folder.path}/${segment}`, name: segment, folders: new Map(), files: [] };
        folder.folders.set(segment, child);
      }
      folder = child;
    }
    folder.files.push({ kind: 'file', path, name: segments[segments.length - 1]!, matches });
  }
  // The root itself is never shown: only its children.
  const folders = [...top.folders.values()].map(finish).sort(byName);
  return [...folders, ...[...top.files].sort(byName)];
}

/** Collapse keys of every folder and file of the tree. */
export function searchTreeKeys(nodes: SearchTreeNode[]): string[] {
  return nodes.flatMap((node) => (node.kind === 'folder' ? [node.path, ...searchTreeKeys(node.children)] : [node.path]));
}

function treeMatches(nodes: SearchTreeNode[]): WorkspaceSearchMatch[] {
  return nodes.flatMap((node) => (node.kind === 'folder' ? treeMatches(node.children) : node.matches));
}

/** Results in display order: the tree puts folders before files, the list keeps path order. */
export function resultsInDisplayOrder(
  results: WorkspaceSearchMatch[],
  viewMode: 'tree' | 'list',
  rootPath: string | undefined,
): WorkspaceSearchMatch[] {
  if (viewMode === 'list' || !rootPath) return results;
  return treeMatches(buildSearchTree(groupByPath(results), rootPath));
}
