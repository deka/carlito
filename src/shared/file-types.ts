import type { LanguageId } from './language-registry';

export interface OpenFileResult {
  uri: string;
  path: string;
  languageId: LanguageId;
  content: string;
}

export interface ReadFileRequest {
  path: string;
}

export interface ReadFileResult {
  content: string;
}

export interface ReadFileDataUrlResult {
  dataUrl: string;
}

export interface ReadPdfResult {
  bytes: Uint8Array;
}

export interface SaveFileRequest {
  path: string;
  content: string;
}

export interface SaveFileResult {
  ok: true;
}

export interface SaveAsDialogRequest {
  content: string;
  suggestedName?: string;
}

export interface SaveAsDialogResult {
  path: string;
  uri: string;
  languageId: LanguageId;
}

export interface FileCreateRequest {
  parentPath: string;
  name: string;
}

export interface FileDeleteRequest {
  path: string;
}

export interface FileCopyRequest {
  sourcePath: string;
  destinationDirectory: string;
}

export interface FileMoveRequest {
  sourcePath: string;
  destinationDirectory: string;
}

export interface FileRenameRequest {
  path: string;
  newName: string;
}

export interface FileOperationResult {
  path: string;
  uri: string;
}

export interface WorkspaceFolderResult {
  rootUri: string;
  rootPath: string;
  name: string;
}

/** A recently opened workspace folder, as listed on the Welcome screen. */
export interface RecentWorkspace {
  /** Absolute folder path. */
  path: string;
  /** Folder name (falls back to the full path for a filesystem root). */
  name: string;
  /** Path shortened for display (`~` for the home directory). */
  displayPath: string;
}

export interface RecentWorkspaceRequest {
  path: string;
}

export type GitFileStatus =
  | 'added'
  | 'modified'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'ignored'
  | 'conflict';

export interface FileTreeNode {
  name: string;
  path: string;
  uri: string;
  type: 'file' | 'directory';
  gitStatus?: GitFileStatus;
  children?: FileTreeNode[];
}

export interface GitBaselineResult {
  isGitRepo: boolean;
  tracked: boolean;
  rootPath?: string;
  content?: string;
  error?: string;
}

export interface GitChangedFile {
  path: string;
  uri: string;
  relativePath: string;
  /** Combined status, as shown in the file tree. */
  status: GitFileStatus;
  /** Status of the change recorded in the index; undefined when nothing is staged. */
  staged?: GitFileStatus;
  /** Status of the work-tree change not yet staged; undefined when the work tree matches the index. */
  unstaged?: GitFileStatus;
  /** Previous path of a staged rename or copy. */
  originalPath?: string;
}

export interface GitBranchInfo {
  /** Current branch; undefined when HEAD is detached. */
  name?: string;
  upstream?: string;
  ahead: number;
  behind: number;
}

export interface GitBranchResult {
  isGitRepo: boolean;
  branch?: GitBranchInfo;
  /** Changed files inside the workspace (staged, unstaged or untracked); undefined when unknown. */
  changedFiles?: number;
}

export interface GitStatusResult {
  isGitRepo: boolean;
  rootPath?: string;
  branch?: GitBranchInfo;
  files: GitChangedFile[];
}

export interface GitActionResult {
  ok: boolean;
  /** Combined, trimmed git output (stdout on success, stderr/stdout on failure). */
  output: string;
}

export type GitPullResult = GitActionResult;

/** Stage or unstage absolute paths inside the repository containing `rootPath`. */
export interface GitPathsRequest {
  rootPath: string;
  paths: string[];
}

export interface GitCommitRequest {
  rootPath: string;
  message: string;
}

export interface WorkspaceSearchRequest {
  query: string;
  maxResults?: number;
}

export interface WorkspaceSearchMatch {
  path: string;
  uri: string;
  lineNumber: number;
  column: number;
  preview: string;
  matchStart: number;
  matchEnd: number;
}

export interface WorkspaceSearchResult {
  matches: WorkspaceSearchMatch[];
  truncated: boolean;
}

export interface WorkspaceChangedEvent {
  rootPath: string;
  path?: string;
  eventType: 'rename' | 'change';
}
