import { useEditorStore } from '../store/useEditorStore';

/** Switch this window to a folder from the recent list (Welcome screen, File > Open Recent). */
export async function openRecentWorkspace(path: string): Promise<void> {
  try {
    const folder = await window.api.workspace.recent.open(path);
    if (folder) useEditorStore.getState().setWorkspace(folder);
  } catch (error) {
    console.error('failed to open recent workspace', error);
  }
}
