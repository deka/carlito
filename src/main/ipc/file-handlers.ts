import { dialog, ipcMain, shell } from 'electron';
import { cp, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '@shared/ipc';
import { imageMimeTypeForPath, isBinaryPreviewPath, isPdfPath } from '@shared/image-types';
import { languageIdFromPath } from '@shared/language-registry';
import {
  assertSafeChildName,
  isPathInsideOrEqual,
  operationResult,
  pathExists,
  uniqueCopyDestination,
} from './file-operations';
import { rememberLastWorkspacePath } from '../config/app-state';
import { getGitStatusContext } from './git-status';
import { searchWorkspace } from './workspace-search';
import {
  authorizeWindowPath,
  ensureWorkspaceWatcher,
  registerAllowedFile,
  setWindowWorkspaceRoot,
  watchWorkspaceDirectory,
  windowFromEvent,
  workspaceRootFor,
} from './workspace-state';
import { listTree } from './workspace-tree';
import type {
  FileCopyRequest,
  FileCreateRequest,
  FileDeleteRequest,
  FileMoveRequest,
  FileRenameRequest,
  OpenFileResult,
  ReadFileRequest,
  ReadPdfResult,
  SaveAsDialogRequest,
  SaveFileRequest,
  WorkspaceSearchRequest,
} from '@shared/file-types';

export { registerWindowWorkspace } from './workspace-state';

const maxImageFileSize = 10 * 1024 * 1024;

async function readImageDataUrl(path: string): Promise<string> {
  const mimeType = imageMimeTypeForPath(path);
  if (!mimeType) throw new Error('Unsupported image type');

  const file = await open(path, 'r');
  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile()) throw new Error('Image path is not a file');
    if (fileStats.size > maxImageFileSize) throw new Error('Image exceeds the 10 MiB size limit');
    const content = await file.readFile();
    if (content.byteLength > maxImageFileSize)
      throw new Error('Image exceeds the 10 MiB size limit');
    return `data:${mimeType};base64,${content.toString('base64')}`;
  } finally {
    await file.close();
  }
}

const maxPdfFileSize = 200 * 1024 * 1024;

async function readPdfBytes(path: string): Promise<Uint8Array> {
  if (!isPdfPath(path)) throw new Error('Not a PDF file');
  const file = await open(path, 'r');
  try {
    const fileStats = await file.stat();
    if (!fileStats.isFile()) throw new Error('PDF path is not a file');
    if (fileStats.size > maxPdfFileSize) throw new Error('PDF exceeds the 200 MiB size limit');
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export function registerFileHandlers(): void {
  ipcMain.handle(IPC.fileOpenDialog, async (event): Promise<OpenFileResult | null> => {
    const win = windowFromEvent(event);
    const result = await dialog.showOpenDialog(win, { properties: ['openFile'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const path = result.filePaths[0]!;
    // Images and PDFs are previewed from their bytes; never decode them as text.
    const content = isBinaryPreviewPath(path) ? '' : await readFile(path, 'utf8');
    await registerAllowedFile(win, path);
    return {
      uri: pathToFileURL(path).toString(),
      path,
      languageId: languageIdFromPath(path),
      content,
    };
  });

  ipcMain.handle(IPC.fileRead, async (event, { path }: ReadFileRequest) => {
    const win = windowFromEvent(event);
    const authorizedPath = await authorizeWindowPath(win, path);
    const content = await readFile(authorizedPath, 'utf8');
    // Detect external edits of open files even when their folder is collapsed.
    watchWorkspaceDirectory(win, dirname(authorizedPath));
    return { content };
  });

  ipcMain.handle(IPC.fileReadDataUrl, async (event, { path }: ReadFileRequest) => {
    const win = windowFromEvent(event);
    const authorizedPath = await authorizeWindowPath(win, path);
    const dataUrl = await readImageDataUrl(authorizedPath);
    // Refresh image previews when the file changes on disk.
    watchWorkspaceDirectory(win, dirname(authorizedPath));
    return { dataUrl };
  });

  ipcMain.handle(IPC.fileReadPdf, async (event, { path }: ReadFileRequest): Promise<ReadPdfResult> => {
    const win = windowFromEvent(event);
    const authorizedPath = await authorizeWindowPath(win, path);
    const bytes = await readPdfBytes(authorizedPath);
    // Refresh PDF previews when the file changes on disk.
    watchWorkspaceDirectory(win, dirname(authorizedPath));
    return { bytes };
  });

  ipcMain.handle(IPC.fileSave, async (event, { path, content }: SaveFileRequest) => {
    const authorizedPath = await authorizeWindowPath(windowFromEvent(event), path);
    await writeFile(authorizedPath, content, 'utf8');
    return { ok: true };
  });

  ipcMain.handle(IPC.fileSaveAsDialog, async (event, request: SaveAsDialogRequest) => {
    const win = windowFromEvent(event);
    const result = await dialog.showSaveDialog(win, {
      defaultPath: request.suggestedName ?? 'untitled.txt',
    });
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, request.content, 'utf8');
    await registerAllowedFile(win, result.filePath);
    return {
      path: result.filePath,
      uri: pathToFileURL(result.filePath).toString(),
      languageId: languageIdFromPath(result.filePath),
    };
  });

  ipcMain.handle(IPC.fileCreate, async (event, { parentPath, name }: FileCreateRequest) => {
    assertSafeChildName(name);
    const win = windowFromEvent(event);
    const authorizedParent = await authorizeWindowPath(win, parentPath);
    const path = await authorizeWindowPath(win, join(authorizedParent, name), {
      allowMissing: true,
    });
    await writeFile(path, '', { encoding: 'utf8', flag: 'wx' });
    return operationResult(path);
  });

  ipcMain.handle(
    IPC.fileCreateDirectory,
    async (event, { parentPath, name }: FileCreateRequest) => {
      assertSafeChildName(name);
      const win = windowFromEvent(event);
      const authorizedParent = await authorizeWindowPath(win, parentPath);
      const path = await authorizeWindowPath(win, join(authorizedParent, name), {
        allowMissing: true,
      });
      await mkdir(path);
      return operationResult(path);
    },
  );

  ipcMain.handle(IPC.fileDelete, async (event, { path }: FileDeleteRequest) => {
    const win = windowFromEvent(event);
    const authorizedPath = await authorizeWindowPath(win, path);
    await authorizeWindowPath(win, dirname(authorizedPath));
    await rm(authorizedPath, {
      recursive: true,
      force: false,
    });
    return { ok: true };
  });

  ipcMain.handle(
    IPC.fileCopy,
    async (event, { sourcePath, destinationDirectory }: FileCopyRequest) => {
      const win = windowFromEvent(event);
      const authorizedSource = await authorizeWindowPath(win, sourcePath);
      const authorizedDestination = await authorizeWindowPath(win, destinationDirectory);
      const sourceStats = await stat(authorizedSource);
      if (
        sourceStats.isDirectory() &&
        isPathInsideOrEqual(authorizedDestination, authorizedSource)
      ) {
        throw new Error('Cannot copy a folder into itself');
      }
      const destinationPath = await authorizeWindowPath(
        win,
        await uniqueCopyDestination(authorizedSource, authorizedDestination),
        { allowMissing: true },
      );
      await cp(authorizedSource, destinationPath, {
        recursive: sourceStats.isDirectory(),
        errorOnExist: true,
        force: false,
      });
      return operationResult(destinationPath);
    },
  );

  ipcMain.handle(IPC.fileRename, async (event, { path, newName }: FileRenameRequest) => {
    assertSafeChildName(newName);
    const authorizedPath = await authorizeWindowPath(windowFromEvent(event), path);
    const destinationPath = await authorizeWindowPath(
      windowFromEvent(event),
      join(dirname(authorizedPath), newName),
      { allowMissing: true },
    );
    if (await pathExists(destinationPath))
      throw new Error('A file or folder with that name already exists');
    await rename(authorizedPath, destinationPath);
    return operationResult(destinationPath);
  });

  ipcMain.handle(
    IPC.fileMove,
    async (event, { sourcePath, destinationDirectory }: FileMoveRequest) => {
      const win = windowFromEvent(event);
      const authorizedSource = await authorizeWindowPath(win, sourcePath);
      const authorizedDestination = await authorizeWindowPath(win, destinationDirectory);
      const root = workspaceRootFor(win);
      if (root && isPathInsideOrEqual(root, authorizedSource)) {
        throw new Error('Cannot move the workspace folder');
      }
      if (!(await stat(authorizedDestination)).isDirectory()) {
        throw new Error('Destination is not a folder');
      }
      const sourceStats = await stat(authorizedSource);
      if (
        sourceStats.isDirectory() &&
        isPathInsideOrEqual(authorizedDestination, authorizedSource)
      ) {
        throw new Error('Cannot move a folder into itself');
      }
      const destinationPath = await authorizeWindowPath(
        win,
        join(authorizedDestination, basename(authorizedSource)),
        { allowMissing: true },
      );
      if (destinationPath === authorizedSource) return operationResult(destinationPath);
      if (await pathExists(destinationPath)) {
        throw new Error(`“${basename(destinationPath)}” already exists in the destination folder`);
      }
      try {
        await rename(authorizedSource, destinationPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EXDEV') throw error;
        await cp(authorizedSource, destinationPath, {
          recursive: sourceStats.isDirectory(),
          errorOnExist: true,
          force: false,
        });
        await rm(authorizedSource, { recursive: true, force: true });
      }
      return operationResult(destinationPath);
    },
  );

  ipcMain.handle(IPC.fileRevealInFolder, async (event, { path }: { path: string }) => {
    shell.showItemInFolder(await authorizeWindowPath(windowFromEvent(event), path));
    return { ok: true };
  });

  ipcMain.handle(IPC.workspaceOpenFolderDialog, async (event) => {
    const win = windowFromEvent(event);
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory'] });
    if (result.canceled || result.filePaths.length === 0) return null;
    const rootPath = result.filePaths[0]!;
    setWindowWorkspaceRoot(win, rootPath);
    ensureWorkspaceWatcher(win, rootPath);
    rememberLastWorkspacePath(rootPath);
    return { rootPath, rootUri: pathToFileURL(rootPath).toString(), name: basename(rootPath) };
  });

  ipcMain.handle(IPC.workspaceCurrentFolder, async (event) => {
    const win = windowFromEvent(event);
    const rootPath = workspaceRootFor(win);
    ensureWorkspaceWatcher(win, rootPath);
    rememberLastWorkspacePath(rootPath);
    return { rootPath, rootUri: pathToFileURL(rootPath).toString(), name: basename(rootPath) };
  });

  ipcMain.handle(
    IPC.workspaceListTree,
    async (
      event,
      {
        rootPath,
        watch: shouldWatch = true,
        recursive = false,
        gitStatus = true,
      }: { rootPath: string; watch?: boolean; recursive?: boolean; gitStatus?: boolean },
    ) => {
      const win = windowFromEvent(event);
      const authorizedRoot = await authorizeWindowPath(win, rootPath);
      if (shouldWatch) ensureWorkspaceWatcher(win, workspaceRootFor(win));
      // Watch every directory shown in the tree (the watcher is non-recursive).
      if (!recursive) watchWorkspaceDirectory(win, authorizedRoot);
      return {
        children: await listTree(authorizedRoot, {
          recursive,
          gitStatus: gitStatus ? await getGitStatusContext(authorizedRoot) : undefined,
        }),
      };
    },
  );

  ipcMain.handle(IPC.workspaceSearch, async (event, request: WorkspaceSearchRequest) => {
    const win = windowFromEvent(event);
    const rootPath = await authorizeWindowPath(win, workspaceRootFor(win));
    return searchWorkspace(rootPath, request);
  });
}
