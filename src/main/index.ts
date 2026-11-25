import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC } from '@shared/ipc';
import { loadLanguageConfig } from './config/language-config';
import { loadUserConfig } from './config/user-config';
import { registerCliHandlers } from './ipc/cli-handlers';
import { registerConfigHandlers } from './ipc/config-handlers';
import { registerFileHandlers } from './ipc/file-handlers';
import { registerGitHandlers } from './ipc/git-handlers';
import { registerLspHandlers } from './ipc/lsp-handlers';
import { registerRecentWorkspaceHandlers } from './ipc/recent-workspace-handlers';
import { registerTerminalHandlers } from './ipc/terminal-handlers';
import { registerWindowHandlers } from './ipc/window-handlers';
import { registerUpdateHandlers } from './update/update-service';
import { registerLocalResourceProtocol, registerLocalResourceScheme } from './local-resource-protocol';
import { installAppMenu, registerMenuHandlers } from './menu';
import { initialWorkspacePath } from './workspace';
import { createWindow } from './window';

registerLocalResourceScheme();

// The single-instance lock is keyed on userData. Give dev builds their own profile so
// `npm run dev` does not hand off to an installed Carlo that is already running.
if (!app.isPackaged) app.setPath('userData', `${app.getPath('userData')}-dev`);

const gotSingleInstanceLock = app.requestSingleInstanceLock();

if (!gotSingleInstanceLock) {
  app.quit();
} else {
  ipcMain.handle(IPC.ping, () => 'pong');
  loadLanguageConfig();
  loadUserConfig();
  registerCliHandlers();
  registerConfigHandlers();
  registerFileHandlers();
  registerGitHandlers();
  registerLspHandlers();
  registerRecentWorkspaceHandlers();
  registerTerminalHandlers();
  registerWindowHandlers();
  registerUpdateHandlers();
  installAppMenu();
  registerMenuHandlers();

  app.on('second-instance', (_event, argv, workingDirectory) => {
    const win = createWindow({ initialWorkspacePath: initialWorkspacePath(argv, workingDirectory) });
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(() => {
    registerLocalResourceProtocol();
    createWindow({ initialWorkspacePath: initialWorkspacePath() });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow({ initialWorkspacePath: initialWorkspacePath() });
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
