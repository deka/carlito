import { BrowserWindow, app, nativeTheme, shell } from 'electron';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IPC } from '@shared/ipc';
import { registerWindowWorkspace } from './ipc/file-handlers';
import {
  forgetWindowCloseState,
  requestWindowCloseConfirmation,
  safeExternalUrl,
  shouldAllowWindowClose,
} from './ipc/window-handlers';

/** URL without its query and fragment, to compare a navigation with the app's own page. */
function documentUrl(value: string): string | undefined {
  try {
    const url = new URL(value);
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return undefined;
  }
}

interface CreateWindowOptions {
  initialWorkspacePath?: string;
}

export function createWindow(options: CreateWindowOptions = {}): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 500,
    backgroundColor: '#2e3440',
    title: 'carlo',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`blocked renderer window.open: ${url}`);
    return { action: 'deny' };
  });

  const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
  const entryUrl = devServerUrl ?? pathToFileURL(join(__dirname, '../renderer/index.html')).href;

  // The preload exposes window.api (terminal, files, git) to whatever page is in
  // the main frame, so that frame must never leave the app's own page: a link or
  // image-map area in a previewed file, or a dropped file, would otherwise hand
  // the API to a foreign page. Web links go to the system browser instead.
  win.webContents.on('will-navigate', (event) => {
    if (documentUrl(event.url) === documentUrl(entryUrl)) return;
    event.preventDefault();
    const externalUrl = safeExternalUrl(event.url);
    if (externalUrl && /^https?:/i.test(externalUrl))
      void shell.openExternal(externalUrl).catch(console.error);
    else console.warn(`blocked renderer navigation: ${event.url}`);
  });

  registerWindowWorkspace(win, options.initialWorkspacePath);
  const webContentsId = win.webContents.id;

  win.on('close', (event) => {
    if (shouldAllowWindowClose(win)) return;
    event.preventDefault();
    requestWindowCloseConfirmation(win);
  });

  const sendOsTheme = () =>
    win.webContents.send(IPC.themeOsChanged, { shouldUseDark: nativeTheme.shouldUseDarkColors });
  nativeTheme.on('updated', sendOsTheme);
  win.on('closed', () => {
    forgetWindowCloseState(webContentsId);
    nativeTheme.off('updated', sendOsTheme);
  });

  if (devServerUrl) {
    void win.loadURL(devServerUrl);
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
