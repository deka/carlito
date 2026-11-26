import { lazy, Suspense, useEffect, useState } from 'react';
import { ActivityBar } from './components/ActivityBar';
import { GitDialog } from './components/GitDialog';
import { BottomPanel } from './components/BottomPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { Sidebar } from './components/Sidebar';
import { StatusBar } from './components/StatusBar';
import { TabBar } from './components/TabBar';
import { WelcomeScreen } from './components/WelcomeScreen';
import { titleFromState } from './components/appTitleUtils';
import { InlinePreview } from './components/preview/InlinePreviewOverlay';
import { ensureVscodeServices, loadAfterVscodeServices } from './vscode/servicesReady';
import { useKeybindings } from './hooks/useKeybindings';
import { useSidebarResize } from './hooks/useSidebarResize';
import { useWorkspaceExternalChanges } from './hooks/useWorkspaceExternalChanges';
import { activeTabInGroup, useActiveTab, useEditorStore } from './store/useEditorStore';
import { useSettingsStore } from './store/useSettingsStore';
import { useThemeStore } from './store/useThemeStore';
import { useWorkbenchUiStore } from './store/useWorkbenchUiStore';
import { isGitDiffUri } from './git/diffTabs';
import { isMarkdownPreviewUri } from './markdown/previewTabs';
import { isTerminalUri } from './terminal/terminalTabs';
import { isBinaryImagePath, isPdfPath } from '@shared/image-types';

const activityBarWidth = 48;
const MonacoEditor = lazy(() =>
  loadAfterVscodeServices(() => import('./editor/MonacoEditor')).then((module) => ({ default: module.MonacoEditor })),
);
const GitDiffEditor = lazy(() =>
  loadAfterVscodeServices(() => import('./editor/GitDiffEditor')).then((module) => ({ default: module.GitDiffEditor })),
);
const TerminalView = lazy(() => import('./components/TerminalView').then((module) => ({ default: module.TerminalView })));
const MarkdownPreview = lazy(() => import('./components/MarkdownPreview').then((module) => ({ default: module.MarkdownPreview })));
const ImagePreview = lazy(() =>
  import('./components/preview/ImagePreview').then((module) => ({ default: module.ImagePreview })),
);

const PdfPreview = lazy(() => import('./components/preview/PdfPreview').then((module) => ({ default: module.PdfPreview })));

export function App() {
  useKeybindings();
  useWorkspaceExternalChanges();
  const [warmEditor, setWarmEditor] = useState(false);
  const groups = useEditorStore((state) => state.groups);
  const splitDirection = useEditorStore((state) => state.splitDirection);
  const sidebarVisible = useWorkbenchUiStore((state) => state.sidebarVisible);
  const activeGroupId = useEditorStore((state) => state.activeGroupId);
  const workspaceName = useEditorStore((state) => state.workspace?.name);
  const activeTab = useActiveTab();
  // There is no in-app title bar: the native window title carries the context.
  useEffect(() => {
    document.title = titleFromState();
  }, [activeTab?.title, activeTab?.dirty, workspaceName, activeGroupId]);
  const { sidebarWidth, pointerHandlers } = useSidebarResize({
    minWidth: 210,
    maxWidth: 560,
    storageKey: 'carlo.sidebarWidth',
    offset: activityBarWidth,
  });
  useEffect(() => {
    const unsubscribe = window.api.window.onCloseRequested(() => {
      void import('./editor/saveActions')
        .then(({ handleWindowCloseRequest }) => handleWindowCloseRequest())
        .catch(console.error);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    const idleCallback = window.requestIdleCallback(() => setWarmEditor(true), { timeout: 500 });
    return () => window.cancelIdleCallback(idleCallback);
  }, []);

  useEffect(() => {
    useThemeStore.getState().setTheme(useThemeStore.getState().themeId);
    void useSettingsStore.getState().loadSettings().catch(console.error);
    void ensureVscodeServices()
      .then(async () => {
        const [{ registerBuiltinCommands }, { registerEditorOpener }, { startProblemsSync }] = await Promise.all([
          import('./commands/builtinCommands'),
          import('./editor/editorOpener'),
          import('./problems/sync'),
        ]);
        registerBuiltinCommands();
        registerEditorOpener();
        startProblemsSync();
      })
      .catch(console.error);
  }, []);
  return (
    <main
      className="app-shell"
      style={{
        gridTemplateColumns: sidebarVisible
          ? `${activityBarWidth}px ${sidebarWidth}px 4px minmax(0, 1fr)`
          : `${activityBarWidth}px 0 0 minmax(0, 1fr)`,
      }}
    >
      <ActivityBar />
      {sidebarVisible ? <Sidebar /> : null}
      {sidebarVisible ? (
        <div
          className="sidebar-resizer"
          {...pointerHandlers}
        />
      ) : null}
      <div className="main-area">
        <div className={`workbench split-${splitDirection}`}>
          {groups.map((group) => {
            const tab = activeTabInGroup(group.id);
            const hasActiveTab = Boolean(tab);
            return (
              <section className="editor-group" key={group.id}>
                <TabBar groupId={group.id} />
                {tab && isGitDiffUri(tab.uri) ? (
                  <Suspense fallback={<div className="editor-stack" />}>
                    <GitDiffEditor groupId={group.id} />
                  </Suspense>
                ) : tab && isTerminalUri(tab.uri) ? (
                  <Suspense fallback={<div className="editor-stack" />}>
                    <TerminalView groupId={group.id} />
                  </Suspense>
                ) : tab && isMarkdownPreviewUri(tab.uri) ? (
                  <Suspense fallback={<div className="editor-stack" />}>
                    <MarkdownPreview groupId={group.id} />
                  </Suspense>
                ) : tab && tab.uri.startsWith('file:') && isBinaryImagePath(tab.path) ? (
                  <Suspense fallback={<div className="editor-stack" />}>
                    <ImagePreview groupId={group.id} />
                  </Suspense>
                ) : tab && tab.uri.startsWith('file:') && isPdfPath(tab.path) ? (
                  <Suspense fallback={<div className="editor-stack" />}>
                    <PdfPreview groupId={group.id} />
                  </Suspense>
                ) : hasActiveTab || warmEditor ? (
                  <Suspense
                    fallback={
                      <div className="editor-stack">
                        {!hasActiveTab ? <WelcomeScreen /> : null}
                      </div>
                    }
                  >
                    <MonacoEditor groupId={group.id}>
                      {!hasActiveTab ? <WelcomeScreen /> : null}
                      <InlinePreview groupId={group.id} tab={tab} />
                    </MonacoEditor>
                  </Suspense>
                ) : (
                  <div className="editor-stack">
                    <WelcomeScreen />
                  </div>
                )}
              </section>
            );
          })}
        </div>
        <BottomPanel />
      </div>
      <StatusBar />
      <SettingsPanel />
      <GitDialog />
    </main>
  );
}
