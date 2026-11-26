import { escapeRegExp } from '@shared/search-replace';
import { getEditor } from '../../editor/editorRegistry';
import { restartLanguageClient } from '../../lsp/LanguageClientService';
import { navigateProblem } from '../../problems/navigation';
import { openAdjacentSearchResult } from '../../search/navigation';
import { useEditorStore, activeTab } from '../../store/useEditorStore';
import { useBottomPanelStore } from '../../store/useBottomPanelStore';
import { useGitDialogStore } from '../../store/useGitDialogStore';
import { useSearchStore } from '../../store/useSearchStore';
import { useWorkbenchUiStore } from '../../store/useWorkbenchUiStore';
import { openTerminal } from '../../terminal/terminalTabs';
import { registerCommand } from '../registry';

/** Like VS Code: a single-line selection in the focused editor seeds the search query. */
function seedSearchFromSelection(): void {
  const editor = getEditor();
  const model = editor?.getModel();
  const selection = editor?.getSelection();
  if (!editor?.hasTextFocus() || !model || !selection || selection.isEmpty()) return;
  if (selection.startLineNumber !== selection.endLineNumber) return;
  const text = model.getValueInRange(selection);
  const search = useSearchStore.getState();
  search.setQuery(search.isRegex ? escapeRegExp(text) : text);
}

function openSearchView(focus: 'query' | 'replace'): void {
  seedSearchFromSelection();
  const search = useSearchStore.getState();
  if (focus === 'replace') search.setShowReplace(true);
  useWorkbenchUiStore.getState().showSidebarView('search');
  search.requestFocus(focus);
}

export function registerWorkbenchCommands(): void {
  registerCommand({
    id: 'workspace.openFolder',
    title: 'Open Folder',
    keybinding: 'Ctrl+K',
    run: async () => {
      const folder = await window.api.workspace.openFolderDialog();
      if (folder) useEditorStore.getState().setWorkspace(folder);
    },
  });
  registerCommand({
    id: 'workbench.action.terminal.new',
    title: 'Terminal: New Terminal',
    keybinding: 'Ctrl+Shift+T',
    run: openTerminal,
  });
  registerCommand({
    id: 'workbench.action.findInFiles',
    title: 'Search: Find in Files',
    keybinding: 'Ctrl+Shift+F',
    run: () => openSearchView('query'),
  });
  registerCommand({
    id: 'workbench.action.replaceInFiles',
    title: 'Search: Replace in Files',
    keybinding: 'Ctrl+Shift+H',
    run: () => openSearchView('replace'),
  });
  registerCommand({
    id: 'search.action.focusNextSearchResult',
    title: 'Search: Focus Next Search Result',
    keybinding: 'F4',
    run: () => openAdjacentSearchResult(1),
  });
  registerCommand({
    id: 'search.action.focusPreviousSearchResult',
    title: 'Search: Focus Previous Search Result',
    keybinding: 'Shift+F4',
    run: () => openAdjacentSearchResult(-1),
  });
  registerCommand({
    id: 'workbench.explorer.toggle',
    title: 'View: Toggle Explorer',
    keybinding: 'Ctrl+Shift+E',
    run: () => useWorkbenchUiStore.getState().toggleSidebarView('explorer'),
  });
  registerCommand({
    id: 'workbench.panel.problems.toggle',
    title: 'View: Toggle Problems',
    keybinding: 'Ctrl+Shift+M',
    run: () => useBottomPanelStore.getState().togglePanel('problems'),
  });
  registerCommand({
    id: 'workbench.panel.git.toggle',
    title: 'Git: Show Source Control',
    keybinding: 'Ctrl+Shift+G',
    run: () => useGitDialogStore.getState().toggleGitDialog(),
  });
  registerCommand({
    id: 'editor.action.marker.next',
    title: 'Go to Next Problem',
    keybinding: 'F8',
    run: () => navigateProblem('next'),
  });
  registerCommand({
    id: 'editor.action.marker.prev',
    title: 'Go to Previous Problem',
    keybinding: 'Shift+F8',
    run: () => navigateProblem('previous'),
  });
  registerCommand({
    id: 'workbench.action.splitEditorRight',
    title: 'Split Editor Right',
    keybinding: 'Ctrl+Alt+Right',
    run: () => useEditorStore.getState().splitActive('vertical'),
  });
  registerCommand({
    id: 'workbench.action.splitEditorDown',
    title: 'Split Editor Down',
    keybinding: 'Ctrl+Alt+Down',
    run: () => useEditorStore.getState().splitActive('horizontal'),
  });
  registerCommand({
    id: 'lsp.restart',
    title: 'Restart Language Server',
    run: async () => {
      const tab = activeTab();
      const workspace = useEditorStore.getState().workspace;
      if (tab && workspace) await restartLanguageClient(tab.languageId, workspace.rootUri, tab.uri);
    },
  });
}
