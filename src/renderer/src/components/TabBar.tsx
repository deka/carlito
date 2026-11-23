import { type DragEvent, type MouseEvent, useState } from 'react';
import { disposeModel } from '../editor/models';
import type { EditorTab } from '../store/useEditorStore';
import { isUriOpen, useEditorStore } from '../store/useEditorStore';
import { useContextMenuDismiss } from '../hooks/useContextMenuDismiss';
import { inlinePreviewFor } from '../preview/inlinePreviews';
import { useInlinePreviewStore, useIsInlinePreviewed } from '../preview/inlinePreviewStore';
import { Tab } from './Tab';
import { TabContextMenu } from './TabContextMenu';
import type { TabContextMenuState } from './TabContextMenuState';

const tabDragDataType = 'application/x-carlo-tab';

interface TabDragData {
  tabId: string;
  sourceGroupId: string;
}

interface DropTarget {
  tabId?: string;
  position: 'before' | 'after';
}

interface Props {
  groupId: string;
}

function isTabDrag(event: DragEvent): boolean {
  return event.dataTransfer.types.includes(tabDragDataType);
}

function readTabDragData(event: DragEvent): TabDragData | undefined {
  try {
    const parsed = JSON.parse(event.dataTransfer.getData(tabDragDataType)) as Partial<TabDragData>;
    if (typeof parsed.tabId !== 'string' || typeof parsed.sourceGroupId !== 'string') return undefined;
    return { tabId: parsed.tabId, sourceGroupId: parsed.sourceGroupId };
  } catch {
    return undefined;
  }
}

export function TabBar({ groupId }: Props) {
  const {
    tabs,
    groups,
    activeGroupId,
    setActive,
    setActiveGroup,
    moveTabToGroup,
    splitActive,
    closeGroup,
    workspace,
  } = useEditorStore();
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | undefined>(undefined);
  const [draggingTabId, setDraggingTabId] = useState<string | undefined>(undefined);
  const [dropTarget, setDropTarget] = useState<DropTarget | undefined>(undefined);
  const group = groups.find((candidate) => candidate.id === groupId);
  const groupTabs = group
    ? group.tabIds.flatMap((id) => tabs.find((tab) => tab.id === id) ?? [])
    : [];

  const activeGroupTab = groupTabs.find((tab) => tab.id === group?.activeTabId);
  const previewed = useIsInlinePreviewed(groupId, activeGroupTab);
  const inlinePreview = inlinePreviewFor(activeGroupTab);

  useContextMenuDismiss(contextMenu !== undefined, () => setContextMenu(undefined));

  async function closeTabsWithPrompt(tabsToClose: EditorTab[]): Promise<void> {
    const { closeTabWithPrompt } = await import('../editor/saveActions');
    for (const tab of tabsToClose) {
      const currentTab = useEditorStore.getState().tabs.find((candidate) => candidate.id === tab.id);
      if (!currentTab) continue;
      const closed = await closeTabWithPrompt(currentTab, groupId);
      if (!closed) break;
    }
  }

  function closeSavedTabsInGroup(tabsToClose: EditorTab[]): Promise<void> {
    for (const tab of tabsToClose) {
      const state = useEditorStore.getState();
      const currentTab = state.tabs.find((candidate) => candidate.id === tab.id);
      const isInGroup = state.groups.find((candidate) => candidate.id === groupId)?.tabIds.includes(tab.id);
      if (!currentTab || currentTab.dirty || !isInGroup) continue;
      const closed = state.closeTabInGroup(tab.id, groupId);
      if (closed && !isUriOpen(closed.uri)) disposeModel(closed.uri);
    }
    return Promise.resolve();
  }

  function openContextMenu(event: MouseEvent, tab: EditorTab): void {
    event.preventDefault();
    event.stopPropagation();
    setActive(tab.id, groupId);
    setContextMenu({ x: event.clientX, y: event.clientY, tab });
  }

  function runContextAction(action: () => void | Promise<void>): void {
    setContextMenu(undefined);
    void Promise.resolve(action()).catch(console.error);
  }

  function startTabDrag(event: DragEvent<HTMLButtonElement>, tab: EditorTab): void {
    const data: TabDragData = { tabId: tab.id, sourceGroupId: groupId };
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData(tabDragDataType, JSON.stringify(data));
    setDraggingTabId(tab.id);
    setContextMenu(undefined);
  }

  function showTabDropTarget(event: DragEvent<HTMLDivElement>, tabId: string): void {
    if (!isTabDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    const bounds = event.currentTarget.getBoundingClientRect();
    const position = event.clientX < bounds.left + bounds.width / 2 ? 'before' : 'after';
    setDropTarget({ tabId, position });
  }

  function dropTab(event: DragEvent, insertionIndex: number): void {
    if (!isTabDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    const data = readTabDragData(event);
    setDropTarget(undefined);
    if (!data) return;
    moveTabToGroup(data.tabId, data.sourceGroupId, groupId, insertionIndex);
  }

  function dropOnTab(event: DragEvent<HTMLDivElement>, index: number): void {
    const bounds = event.currentTarget.getBoundingClientRect();
    const insertionIndex = event.clientX < bounds.left + bounds.width / 2 ? index : index + 1;
    dropTab(event, insertionIndex);
  }

  function showEndDropTarget(event: DragEvent<HTMLDivElement>): void {
    if (!isTabDrag(event)) return;
    if ((event.target as HTMLElement).closest('.tab')) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    const lastTab = groupTabs.at(-1);
    setDropTarget({ tabId: lastTab?.id, position: 'after' });
  }

  return (
    <div
      className={`tab-bar ${groupId === activeGroupId ? 'active-group' : ''}`}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(undefined);
      }}
    >
      <div className="tab-navigation">
        <button
          className="nav-button"
          title="Go Back"
          onClick={() => void import('../editor/navigationHistory').then(({ navigateBack }) => navigateBack())}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m9.5 3.5-4.5 4.5 4.5 4.5" /></svg>
        </button>
        <button
          className="nav-button"
          title="Go Forward"
          onClick={() => void import('../editor/navigationHistory').then(({ navigateForward }) => navigateForward())}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m6.5 3.5 4.5 4.5-4.5 4.5" /></svg>
        </button>
      </div>
      <div
        className={`tab-strip ${dropTarget && groupTabs.length === 0 ? 'drop-empty' : ''}`}
        onDragOver={showEndDropTarget}
        onDrop={(event) => dropTab(event, groupTabs.length)}
        onWheel={(event) => {
          const tabStrip = event.currentTarget;
          if (tabStrip.scrollWidth <= tabStrip.clientWidth) return;
          if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return;
          tabStrip.scrollLeft += event.deltaY;
          event.preventDefault();
        }}
      >
        {groupTabs.map((tab, index) => (
          <Tab
            key={tab.id}
            tab={tab}
            active={tab.id === group?.activeTabId}
            dragging={tab.id === draggingTabId}
            dropPosition={dropTarget?.tabId === tab.id ? dropTarget.position : undefined}
            onSelect={() => setActive(tab.id, groupId)}
            onClose={() => {
              void import('../editor/saveActions')
                .then(({ closeTabWithPrompt }) => closeTabWithPrompt(tab, groupId))
                .catch(console.error);
            }}
            onContextMenu={(event) => openContextMenu(event, tab)}
            onDragStart={(event) => startTabDrag(event, tab)}
            onDragEnd={() => {
              setDraggingTabId(undefined);
              setDropTarget(undefined);
            }}
            onDragOver={(event) => showTabDropTarget(event, tab.id)}
            onDrop={(event) => dropOnTab(event, index)}
          />
        ))}
      </div>
      <div
        className="tab-bar-spacer"
        aria-hidden="true"
        onDragOver={showEndDropTarget}
        onDrop={(event) => dropTab(event, groupTabs.length)}
      />
      {inlinePreview && activeGroupTab ? (
        <button
          className={`preview-toggle ${previewed ? 'active' : ''}`}
          type="button"
          title={previewed ? 'Show Source (Ctrl+Alt+V)' : 'Show Preview (Ctrl+Alt+V)'}
          aria-label={`Show ${inlinePreview.label} ${previewed ? 'Source' : 'Preview'}`}
          aria-pressed={previewed}
          onClick={() => {
            setActiveGroup(groupId);
            useInlinePreviewStore.getState().togglePreview(groupId, activeGroupTab);
          }}
        >
          {previewed ? (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
            </svg>
          ) : (
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="M1.5 8s2.5-4.5 6.5-4.5S14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8Z" />
              <circle cx="8" cy="8" r="2" />
            </svg>
          )}
        </button>
      ) : null}
      {group?.activeTabId ? (
        <button
          className="group-split"
          type="button"
          title="Split Editor Right (Ctrl+Alt+Right)"
          aria-label="Split Editor Right"
          onClick={() => {
            setActiveGroup(groupId);
            splitActive('vertical');
          }}
        >
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <rect x="2.5" y="2.5" width="11" height="11" rx="1.5" />
            <path d="M8 3v10" />
          </svg>
        </button>
      ) : null}
      {groups.length > 1 ? (
        <button className="group-close" title="Close split" onClick={() => closeGroup(groupId)}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="m5 5 6 6M11 5l-6 6" /></svg>
        </button>
      ) : null}
      {contextMenu ? (
        <TabContextMenu
          contextMenu={contextMenu}
          groupTabs={groupTabs}
          groupId={groupId}
          workspace={workspace}
          onClose={() => setContextMenu(undefined)}
          onRunAction={runContextAction}
          onSetActive={setActive}
          onCloseTabsWithPrompt={closeTabsWithPrompt}
          onCloseSavedTabs={closeSavedTabsInGroup}
        />
      ) : null}
    </div>
  );
}
