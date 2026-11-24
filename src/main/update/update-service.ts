import { BrowserWindow, app, clipboard, dialog, ipcMain, net, shell } from 'electron';
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access, chmod, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { IPC } from '@shared/ipc';
import type { UpdateCheckRequest, UpdateState } from '@shared/update-types';
import { loadUserConfig } from '../config/user-config';
import {
  APT_GET,
  AuthorizationError,
  PACKAGE_NAME,
  PKEXEC,
  aptInstall,
  describeError,
  downloadVerifiedDeb,
  manualInstallCommand,
  type ReleaseAsset,
} from './package-install';
import { compareVersions } from './versions';

const execFileAsync = promisify(execFile);

/** Releases are published by `.github/workflows/release.yml` on this repository. */
const RELEASE_REPO = 'deka/carlo';
const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASE_REPO}/releases/latest`;

const FIRST_CHECK_DELAY_MS = 10_000;
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Latest release as seen by the last successful check. Only main ever decides what gets installed. */
interface LatestRelease {
  version: string;
  releaseUrl: string;
  deb?: ReleaseAsset;
  checksums?: ReleaseAsset;
}

let state: UpdateState = { phase: 'idle', currentVersion: app.getVersion() };
let latestRelease: LatestRelease | undefined;
let checkInFlight: Promise<UpdateState> | undefined;
let installInFlight = false;
let relaunchOnQuit = false;

function setState(next: UpdateState): void {
  state = next;
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send(IPC.updateChanged, state);
  }
}

function errorMessage(error: unknown): string {
  return describeError(error);
}

/**
 * Chromium's network stack (system proxy, certificates, IPv4/IPv6 fallback) rather than Node's,
 * for both the check and the download so they can't disagree about reachability.
 */
const netFetch = (url: string, init?: RequestInit): Promise<Response> => net.fetch(url, init);

async function showMessage(
  sender: Electron.WebContents | undefined,
  options: Electron.MessageBoxOptions,
): Promise<Electron.MessageBoxReturnValue> {
  const win = sender ? BrowserWindow.fromWebContents(sender) : BrowserWindow.getFocusedWindow();
  return win ? dialog.showMessageBox(win, options) : dialog.showMessageBox(options);
}

async function fetchLatestRelease(): Promise<LatestRelease> {
  const response = await netFetch(LATEST_RELEASE_URL, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'carlo-update-check' },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`GitHub answered ${response.status} ${response.statusText}`);
  const body = (await response.json()) as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: { name?: unknown; browser_download_url?: unknown }[];
  };
  if (typeof body.tag_name !== 'string') throw new Error('The latest release has no tag.');
  const version = body.tag_name.replace(/^v/, '');
  const assets: ReleaseAsset[] = (body.assets ?? []).flatMap((asset) =>
    typeof asset.name === 'string' && typeof asset.browser_download_url === 'string'
      ? [{ name: asset.name, url: asset.browser_download_url }]
      : [],
  );
  return {
    version,
    releaseUrl:
      typeof body.html_url === 'string'
        ? body.html_url
        : `https://github.com/${RELEASE_REPO}/releases/latest`,
    deb: assets.find((asset) => asset.name === `${PACKAGE_NAME}_${version}_amd64.deb`),
    checksums: assets.find((asset) => asset.name === 'SHA256SUMS'),
  };
}

/** Carlo can only update itself when this very executable was installed by the `carlo` .deb. */
async function canInstallDeb(release: LatestRelease): Promise<boolean> {
  if (!app.isPackaged || process.platform !== 'linux' || process.arch !== 'x64') return false;
  if (!release.deb || !release.checksums) return false;
  try {
    await access(PKEXEC, constants.X_OK);
    await access(APT_GET, constants.X_OK);
    const { stdout } = await execFileAsync('dpkg-query', ['-S', process.execPath]);
    return stdout.split(':')[0]?.trim() === PACKAGE_NAME;
  } catch {
    return false;
  }
}

async function runCheck(): Promise<UpdateState> {
  const previous = state;
  setState({ ...state, phase: 'checking' });
  try {
    const release = await fetchLatestRelease();
    if (compareVersions(release.version, state.currentVersion) <= 0) {
      latestRelease = undefined;
      setState({ phase: 'upToDate', currentVersion: state.currentVersion });
      return state;
    }
    latestRelease = release;
    setState({
      phase: 'available',
      currentVersion: state.currentVersion,
      latestVersion: release.version,
      releaseUrl: release.releaseUrl,
      installable: await canInstallDeb(release),
    });
    return state;
  } catch (error) {
    // Keep whatever we knew before (e.g. a previously found update) when the network fails.
    setState(previous);
    throw error;
  }
}

function checkForUpdates(): Promise<UpdateState> {
  // Never re-check over an install, nor once the new package is on disk.
  if (installInFlight || state.phase === 'installed') return Promise.resolve(state);
  checkInFlight ??= runCheck().finally(() => {
    checkInFlight = undefined;
  });
  return checkInFlight;
}

async function manualCheck(sender: Electron.WebContents): Promise<UpdateState> {
  if (state.phase === 'installed') {
    await promptRestart(sender);
    return state;
  }
  if (installInFlight) return state;
  try {
    const result = await checkForUpdates();
    if (result.phase === 'upToDate') {
      await showMessage(sender, {
        type: 'info',
        message: 'Carlo is up to date.',
        detail: `Version ${result.currentVersion} is the latest release.`,
      });
    } else if (result.phase === 'available') {
      await promptInstall(sender);
    }
  } catch (error) {
    await showMessage(sender, {
      type: 'error',
      message: 'Could not check for updates.',
      detail: errorMessage(error),
    });
  }
  return state;
}

async function installUpdate(sender: Electron.WebContents): Promise<void> {
  const release = latestRelease;
  if (installInFlight || !release?.deb || !release.checksums || !state.installable) return;
  installInFlight = true;
  const available = state;
  const dir = await mkdtemp(join(tmpdir(), 'carlo-update-'));
  let keepDir = false;
  try {
    // apt drops privileges to `_apt` to read local packages; let it traverse the directory.
    await chmod(dir, 0o755);
    setState({ ...available, phase: 'downloading' });
    const debPath = await downloadVerifiedDeb(
      { version: release.version, deb: release.deb, checksums: release.checksums },
      dir,
      netFetch,
    );

    setState({ ...available, phase: 'installing' });
    const outcome = await aptInstall(debPath);
    if (outcome === 'cancelled') {
      setState(available);
      return;
    }
    latestRelease = undefined;
    setState({ ...available, phase: 'installed' });
    await promptRestart(sender);
  } catch (error) {
    setState(available);
    if (error instanceof AuthorizationError) {
      // The verified package is on disk: keep it and let the user install it from a terminal.
      keepDir = true;
      const command = manualInstallCommand(join(dir, release.deb.name));
      const { response } = await showMessage(sender, {
        type: 'error',
        buttons: ['Copy Command', 'Close'],
        defaultId: 0,
        cancelId: 1,
        noLink: true,
        message: `Could not install Carlo ${release.version}.`,
        detail: `${errorMessage(error)}\n\nThe downloaded package was verified. You can install it from a terminal:\n${command}`,
      });
      if (response === 0) clipboard.writeText(command);
      return;
    }
    await showMessage(sender, {
      type: 'error',
      message: `Could not install Carlo ${release.version}.`,
      detail: errorMessage(error),
    });
  } finally {
    installInFlight = false;
    if (!keepDir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function promptInstall(sender: Electron.WebContents): Promise<void> {
  if (state.phase !== 'available' || !state.latestVersion) return;
  const { latestVersion, currentVersion, releaseUrl, installable } = state;
  if (!installable) {
    const { response } = await showMessage(sender, {
      type: 'info',
      buttons: ['Open Release Page', 'Later'],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
      message: `Carlo ${latestVersion} is available.`,
      detail: `You have ${currentVersion}. This copy of Carlo was not installed from the .deb package, so it cannot update itself. Download the new version from the release page.`,
    });
    if (response === 0 && releaseUrl) await shell.openExternal(releaseUrl);
    return;
  }
  const { response } = await showMessage(sender, {
    type: 'question',
    buttons: ['Install', 'Release Notes', 'Later'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
    message: `Carlo ${latestVersion} is available.`,
    detail: `You have ${currentVersion}. Carlo will download and verify the package, then the system will ask for your password to install it.`,
  });
  if (response === 0) await installUpdate(sender);
  else if (response === 1 && releaseUrl) await shell.openExternal(releaseUrl);
}

async function promptRestart(sender: Electron.WebContents | undefined): Promise<void> {
  const { response } = await showMessage(sender, {
    type: 'info',
    buttons: ['Restart Now', 'Later'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    message: state.latestVersion
      ? `Carlo ${state.latestVersion} is installed.`
      : 'Carlo is updated.',
    detail: 'Restart Carlo to use the new version. All windows will be closed.',
  });
  if (response === 0) restart();
}

function restart(): void {
  relaunchOnQuit = true;
  // Goes through the normal close flow, so unsaved tabs still get their prompt.
  app.quit();
}

/** A window refused to close: the quit (and therefore the restart) was abandoned. */
export function cancelPendingRelaunch(): void {
  relaunchOnQuit = false;
}

function scheduleAutomaticChecks(): void {
  if (!app.isPackaged) return;
  const backgroundCheck = () => {
    if (!loadUserConfig().updates.checkAutomatically) return;
    checkForUpdates().catch((error) => console.warn('update check failed:', errorMessage(error)));
  };
  setTimeout(backgroundCheck, FIRST_CHECK_DELAY_MS).unref();
  setInterval(backgroundCheck, CHECK_INTERVAL_MS).unref();
}

export function registerUpdateHandlers(): void {
  ipcMain.handle(IPC.updateState, () => state);
  ipcMain.handle(IPC.updateCheck, async (event, request: UpdateCheckRequest) =>
    request?.manual ? manualCheck(event.sender) : checkForUpdates().catch(() => state),
  );
  ipcMain.handle(IPC.updateInstall, async (event) => {
    if (state.phase === 'installed') await promptRestart(event.sender);
    else await promptInstall(event.sender);
    return state;
  });
  ipcMain.handle(IPC.updateRestart, () => {
    if (state.phase === 'installed') restart();
    return { ok: true };
  });

  app.on('will-quit', () => {
    if (relaunchOnQuit) app.relaunch();
  });
  app.whenReady().then(scheduleAutomaticChecks).catch(console.error);
}
