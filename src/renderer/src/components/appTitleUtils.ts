import { useDevcontainerStore } from '../store/useDevcontainerStore';
import { useEditorStore } from '../store/useEditorStore';

export function titleFromState(): string {
  const { activeGroupId, groups, tabs, workspace: openWorkspace } = useEditorStore.getState();
  const inContainer = useDevcontainerStore.getState().state.status === 'running';
  const workspace = openWorkspace && {
    ...openWorkspace,
    name: inContainer ? `${openWorkspace.name} [Dev Container]` : openWorkspace.name,
  };
  const activeTabId = groups.find((group) => group.id === activeGroupId)?.activeTabId;
  const tab = tabs.find((candidate) => candidate.id === activeTabId);
  if (tab) {
    const dirty = tab.dirty ? '● ' : '';
    return workspace ? `${dirty}${tab.title} — ${workspace.name} — Carlito` : `${dirty}${tab.title} — Carlito`;
  }
  return workspace ? `${workspace.name} — Carlito` : 'Carlito';
}
