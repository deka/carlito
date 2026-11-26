import { ipcRenderer } from 'electron';
import type { CarloUserConfig } from '@shared/app-config';
import { IPC } from '@shared/ipc';
import type {
  FileCopyRequest,
  FileCreateRequest,
  FileDeleteRequest,
  FileOperationResult,
  FileMoveRequest,
  FileRenameRequest,
  FileTreeNode,
  GitBaselineResult,
  GitActionResult,
  GitCommitRequest,
  GitPathsRequest,
  GitPullResult,
  GitStatusResult,
  GitBranchResult,
  OpenFileResult,
  ReadFileDataUrlResult,
  ReadPdfResult,
  ReadFileResult,
  RecentWorkspace,
  SaveAsDialogRequest,
  SaveAsDialogResult,
  SaveFileRequest,
  WorkspaceChangedEvent,
  WorkspaceFolderResult,
  WorkspaceReplaceRequest,
  WorkspaceReplaceResult,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '@shared/file-types';
import type { LanguageConfig } from '@shared/language-registry';
import type {
  LspFromServerPayload,
  LspServerExit,
  LspServerLog,
  LspServerStderr,
  LspStartOptions,
  LspStartResult,
} from '@shared/lsp-types';
import type { UpdateState } from '@shared/update-types';
import type {
  TerminalCreateRequest,
  TerminalCreateResult,
  TerminalDataEvent,
  TerminalExitEvent,
} from '@shared/terminal-types';
import type { Message } from 'vscode-jsonrpc';

const on = <T>(channel: string, cb: (payload: T) => void) => {
  const handler = (_event: Electron.IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
};

export const api = Object.freeze({
  ping: () => ipcRenderer.invoke(IPC.ping) as Promise<string>,
  app: {
    installCommandLine: () =>
      ipcRenderer.invoke(IPC.appInstallCommandLine) as Promise<
        | { ok: true; path: string; warning?: string }
        | { ok: false; error: string; instructions?: string }
      >,
    /** Quit Carlo; each window still gets a chance to save unsaved changes. */
    quit: () => ipcRenderer.invoke(IPC.appQuit) as Promise<{ ok: true }>,
  },
  update: {
    state: () => ipcRenderer.invoke(IPC.updateState) as Promise<UpdateState>,
    /** A manual check reports its result in a dialog; a background one stays silent. */
    check: (manual: boolean) =>
      ipcRenderer.invoke(IPC.updateCheck, { manual }) as Promise<UpdateState>,
    /** Opens the install (or restart) prompt for the release found by the last check. */
    install: () => ipcRenderer.invoke(IPC.updateInstall) as Promise<UpdateState>,
    restart: () => ipcRenderer.invoke(IPC.updateRestart) as Promise<{ ok: true }>,
    onChanged: (cb: (state: UpdateState) => void) => on<UpdateState>(IPC.updateChanged, cb),
  },
  config: {
    language: () => ipcRenderer.invoke(IPC.configLanguage) as Promise<LanguageConfig>,
    user: () => ipcRenderer.invoke(IPC.configUser) as Promise<CarloUserConfig>,
    saveUser: (config: CarloUserConfig) =>
      ipcRenderer.invoke(IPC.configUserSave, config) as Promise<CarloUserConfig>,
    userPath: () => ipcRenderer.invoke(IPC.configUserPath) as Promise<{ path: string }>,
  },
  file: {
    openDialog: () => ipcRenderer.invoke(IPC.fileOpenDialog) as Promise<OpenFileResult | null>,
    read: (path: string) => ipcRenderer.invoke(IPC.fileRead, { path }) as Promise<ReadFileResult>,
    readDataUrl: (path: string) =>
      ipcRenderer.invoke(IPC.fileReadDataUrl, { path }) as Promise<ReadFileDataUrlResult>,
    readPdf: (path: string) => ipcRenderer.invoke(IPC.fileReadPdf, { path }) as Promise<ReadPdfResult>,
    save: (request: SaveFileRequest) =>
      ipcRenderer.invoke(IPC.fileSave, request) as Promise<{ ok: true }>,
    saveAsDialog: (request: SaveAsDialogRequest) =>
      ipcRenderer.invoke(IPC.fileSaveAsDialog, request) as Promise<SaveAsDialogResult | null>,
    create: (request: FileCreateRequest) =>
      ipcRenderer.invoke(IPC.fileCreate, request) as Promise<FileOperationResult>,
    createDirectory: (request: FileCreateRequest) =>
      ipcRenderer.invoke(IPC.fileCreateDirectory, request) as Promise<FileOperationResult>,
    delete: (request: FileDeleteRequest) =>
      ipcRenderer.invoke(IPC.fileDelete, request) as Promise<{ ok: true }>,
    copy: (request: FileCopyRequest) =>
      ipcRenderer.invoke(IPC.fileCopy, request) as Promise<FileOperationResult>,
    rename: (request: FileRenameRequest) =>
      ipcRenderer.invoke(IPC.fileRename, request) as Promise<FileOperationResult>,
    move: (request: FileMoveRequest) =>
      ipcRenderer.invoke(IPC.fileMove, request) as Promise<FileOperationResult>,
    revealInFolder: (path: string) =>
      ipcRenderer.invoke(IPC.fileRevealInFolder, { path }) as Promise<{ ok: true }>,
  },
  git: {
    baseline: (path: string) =>
      ipcRenderer.invoke(IPC.gitBaseline, { path }) as Promise<GitBaselineResult>,
    status: (rootPath: string) =>
      ipcRenderer.invoke(IPC.gitStatus, { rootPath }) as Promise<GitStatusResult>,
    branch: (rootPath: string) =>
      ipcRenderer.invoke(IPC.gitBranch, { rootPath }) as Promise<GitBranchResult>,
    pull: (rootPath: string) =>
      ipcRenderer.invoke(IPC.gitPull, { rootPath }) as Promise<GitPullResult>,
    push: (rootPath: string) =>
      ipcRenderer.invoke(IPC.gitPush, { rootPath }) as Promise<GitActionResult>,
    stage: (request: GitPathsRequest) =>
      ipcRenderer.invoke(IPC.gitStage, request) as Promise<GitActionResult>,
    unstage: (request: GitPathsRequest) =>
      ipcRenderer.invoke(IPC.gitUnstage, request) as Promise<GitActionResult>,
    commit: (request: GitCommitRequest) =>
      ipcRenderer.invoke(IPC.gitCommit, request) as Promise<GitActionResult>,
  },
  window: {
    zoomIn: () => ipcRenderer.invoke(IPC.windowZoomIn) as Promise<{ zoomLevel: number }>,
    zoomOut: () => ipcRenderer.invoke(IPC.windowZoomOut) as Promise<{ zoomLevel: number }>,
    zoomReset: () => ipcRenderer.invoke(IPC.windowZoomReset) as Promise<{ zoomLevel: number }>,
    toggleDevTools: () => ipcRenderer.invoke(IPC.windowToggleDevTools) as Promise<{ ok: true }>,
    closeProceed: () => ipcRenderer.invoke(IPC.windowCloseProceed) as Promise<{ ok: true }>,
    closeCancel: () => ipcRenderer.invoke(IPC.windowCloseCancel) as Promise<{ ok: true }>,
    onCloseRequested: (cb: () => void) => on<void>(IPC.windowCloseRequested, cb),
  },
  dialog: {
    unsavedChanges: (name: string) =>
      ipcRenderer.invoke(IPC.dialogUnsavedChanges, { name }) as Promise<'save' | 'discard' | 'cancel'>,
  },
  workspace: {
    openFolderDialog: () =>
      ipcRenderer.invoke(IPC.workspaceOpenFolderDialog) as Promise<WorkspaceFolderResult | null>,
    currentFolder: () =>
      ipcRenderer.invoke(IPC.workspaceCurrentFolder) as Promise<WorkspaceFolderResult>,
    listTree: (rootPath: string, options?: { watch?: boolean; recursive?: boolean; gitStatus?: boolean }) =>
      ipcRenderer.invoke(IPC.workspaceListTree, { rootPath, ...options }) as Promise<{
        children: FileTreeNode[];
      }>,
    search: (request: WorkspaceSearchRequest) =>
      ipcRenderer.invoke(IPC.workspaceSearch, request) as Promise<WorkspaceSearchResult>,
    replace: (request: WorkspaceReplaceRequest) =>
      ipcRenderer.invoke(IPC.workspaceReplace, request) as Promise<WorkspaceReplaceResult>,
    onChanged: (cb: (event: WorkspaceChangedEvent) => void) =>
      on<WorkspaceChangedEvent>(IPC.workspaceChanged, cb),
    recent: {
      list: () => ipcRenderer.invoke(IPC.workspaceRecentList) as Promise<RecentWorkspace[]>,
      /** Open a folder from the recent list in this window; null if it is gone or unknown. */
      open: (path: string) =>
        ipcRenderer.invoke(IPC.workspaceRecentOpen, { path }) as Promise<WorkspaceFolderResult | null>,
      remove: (path: string) =>
        ipcRenderer.invoke(IPC.workspaceRecentRemove, { path }) as Promise<{ ok: true }>,
      clear: () => ipcRenderer.invoke(IPC.workspaceRecentClear) as Promise<{ ok: true }>,
      onChanged: (cb: () => void) => on<void>(IPC.workspaceRecentChanged, cb),
    },
  },
  lsp: {
    start: (opts: LspStartOptions) =>
      ipcRenderer.invoke(IPC.lspStart, opts) as Promise<LspStartResult>,
    stop: (connectionId: string) =>
      ipcRenderer.invoke(IPC.lspStop, { connectionId }) as Promise<{ ok: true }>,
    toServer: (connectionId: string, message: Message) =>
      ipcRenderer.send(IPC.lspToServer, { connectionId, message }),
    onFromServer: (cb: (connectionId: string, message: Message) => void) =>
      on<LspFromServerPayload>(IPC.lspFromServer, ({ connectionId, message }) =>
        cb(connectionId, message),
      ),
    onServerExit: (cb: (payload: LspServerExit) => void) =>
      on<LspServerExit>(IPC.lspServerExit, cb),
    onServerStderr: (cb: (payload: LspServerStderr) => void) =>
      on<LspServerStderr>(IPC.lspServerStderr, cb),
    onServerLog: (cb: (payload: LspServerLog) => void) => on<LspServerLog>(IPC.lspServerLog, cb),
  },
  terminal: {
    create: (request: TerminalCreateRequest) =>
      ipcRenderer.invoke(IPC.terminalCreate, request) as Promise<TerminalCreateResult>,
    write: (id: string, data: string) => ipcRenderer.send(IPC.terminalWrite, { id, data }),
    resize: (id: string, cols: number, rows: number) =>
      ipcRenderer.send(IPC.terminalResize, { id, cols, rows }),
    kill: (id: string) => ipcRenderer.invoke(IPC.terminalKill, { id }) as Promise<{ ok: true }>,
    onData: (cb: (event: TerminalDataEvent) => void) => on<TerminalDataEvent>(IPC.terminalData, cb),
    onExit: (cb: (event: TerminalExitEvent) => void) => on<TerminalExitEvent>(IPC.terminalExit, cb),
  },
  theme: {
    onOsChanged: (cb: (payload: { shouldUseDark: boolean }) => void) => on(IPC.themeOsChanged, cb),
  },
  shell: {
    openExternal: (url: string) =>
      ipcRenderer.invoke(IPC.shellOpenExternal, { url }) as Promise<
        { ok: true } | { ok: false; error: string }
      >,
  },
});

export type CarloApi = typeof api;
