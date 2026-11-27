import { create } from 'zustand';
import type { DevcontainerState } from '@shared/devcontainer-types';
import { useBottomPanelStore } from './useBottomPanelStore';
import { useEditorStore } from './useEditorStore';

const maxLogLength = 512 * 1024;

interface DevcontainerStoreState {
  /** Workspace the state below belongs to. */
  rootPath?: string;
  state: DevcontainerState;
  log: string;
}

export const useDevcontainerStore = create<DevcontainerStoreState>(() => ({
  state: { status: 'none' },
  log: '',
}));

function currentRoot(): string | undefined {
  return useEditorStore.getState().workspace?.rootPath;
}

/**
 * Language servers run in the container once connected and on the host otherwise:
 * restart the workspace's clients when that changes, for the languages of open tabs.
 */
async function restartLanguageClients(): Promise<void> {
  const { workspace, tabs } = useEditorStore.getState();
  if (!workspace) return;
  const service = await import('../lsp/LanguageClientService');
  await service.stopLanguageClientsForWorkspace(workspace.rootUri);
  const started = new Set<string>();
  for (const tab of tabs) {
    if (!tab.uri.startsWith('file:') || started.has(tab.languageId)) continue;
    started.add(tab.languageId);
    void service.ensureLanguageClient(tab.languageId, workspace.rootUri, tab.uri).catch(console.error);
  }
}

function applyState(rootPath: string, state: DevcontainerState): void {
  const previous = useDevcontainerStore.getState();
  if (previous.rootPath !== rootPath) return;
  const wasRunning = previous.state.status === 'running';
  useDevcontainerStore.setState({ state });
  if (wasRunning !== (state.status === 'running')) void restartLanguageClients().catch(console.error);
}

async function loadWorkspace(rootPath: string): Promise<void> {
  useDevcontainerStore.setState({ rootPath, state: { status: 'none' }, log: '' });
  const [state, { log }] = await Promise.all([
    window.api.devcontainer.state(rootPath),
    window.api.devcontainer.log(rootPath),
  ]);
  if (useDevcontainerStore.getState().rootPath !== rootPath) return;
  useDevcontainerStore.setState((current) => ({ log: current.log || log }));
  applyState(rootPath, state);
}

/** Track the dev container of the window's workspace. Returns a cleanup function. */
export function watchDevcontainer(): () => void {
  const offChanged = window.api.devcontainer.onChanged(({ rootPath, state }) => applyState(rootPath, state));
  const offLog = window.api.devcontainer.onLog(({ rootPath, data, reset }) => {
    if (useDevcontainerStore.getState().rootPath !== rootPath) return;
    useDevcontainerStore.setState((current) => ({
      log: (reset ? data : current.log + data).slice(-maxLogLength),
    }));
  });
  let watchedRoot = currentRoot();
  if (watchedRoot) void loadWorkspace(watchedRoot).catch(console.error);
  const offWorkspace = useEditorStore.subscribe((state) => {
    const rootPath = state.workspace?.rootPath;
    if (!rootPath || rootPath === watchedRoot) return;
    watchedRoot = rootPath;
    void loadWorkspace(rootPath).catch(console.error);
  });
  return () => {
    offChanged();
    offLog();
    offWorkspace();
  };
}

/** Opening in the container or reopening locally: the workbench must not be changed meanwhile. */
export function isDevcontainerBusy(state: DevcontainerState = useDevcontainerStore.getState().state): boolean {
  return state.status === 'starting' || state.status === 'stopping';
}

export function devcontainerAvailable(): boolean {
  return useDevcontainerStore.getState().state.status !== 'none';
}

export function showDevcontainerLog(): void {
  if (devcontainerAvailable()) useBottomPanelStore.getState().openPanel('devcontainer');
}

export async function reopenInContainer(rebuild = false): Promise<void> {
  const rootPath = currentRoot();
  if (!rootPath || !devcontainerAvailable()) return;
  showDevcontainerLog();
  applyState(rootPath, await window.api.devcontainer.open(rootPath, rebuild));
}

/**
 * Stop the container and work locally again. Tabs opened in the container (files,
 * previews, terminals) are closed first; cancelling an unsaved-changes prompt aborts.
 */
export async function reopenLocally(): Promise<void> {
  const rootPath = currentRoot();
  const { status } = useDevcontainerStore.getState().state;
  if (!rootPath || status === 'none' || status === 'stopping') return;
  if (status === 'running') {
    const { closeAllTabsWithPrompt } = await import('../editor/saveActions');
    if (!(await closeAllTabsWithPrompt())) return;
  }
  applyState(rootPath, await window.api.devcontainer.close(rootPath));
}
