import type { CodeAction, Command } from 'vscode';
import type { EditorTab } from '../store/useEditorStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { activeTab, isUriOpen, useEditorStore } from '../store/useEditorStore';
import { disposeModel, getModel, isModelDirty, markModelSaved, replaceModelUri } from './models';
import { invalidateGitBaseline } from './gitGutter';
import { isTerminalUri } from '../terminal/terminalTabs';
import { flushAllRichEdits, flushRichEdits } from '../markdown/pendingRichEdits';

async function organizeImports(tab: EditorTab): Promise<void> {
  const model = getModel(tab.uri);
  if (!model) return;

  const vscode = await import('vscode');
  const lastLine = model.getLineCount();
  const range = new vscode.Range(
    0,
    0,
    lastLine - 1,
    model.getLineMaxColumn(lastLine) - 1,
  );
  const actions = await vscode.commands.executeCommand<Array<CodeAction | Command>>(
    'vscode.executeCodeActionProvider',
    vscode.Uri.parse(tab.uri),
    range,
    vscode.CodeActionKind.SourceOrganizeImports.value,
    10,
  );
  const action =
    actions?.find((candidate) => candidate instanceof vscode.CodeAction && candidate.isPreferred) ??
    actions?.[0];
  if (!action) return;

  if (action instanceof vscode.CodeAction) {
    if (action.edit && !(await vscode.workspace.applyEdit(action.edit))) {
      throw new Error('The organize imports workspace edit could not be applied');
    }
    if (action.command) {
      await vscode.commands.executeCommand(
        action.command.command,
        ...(action.command.arguments ?? []),
      );
    }
    return;
  }

  await vscode.commands.executeCommand(action.command, ...(action.arguments ?? []));
}

async function runActiveTabSaveActions(tab: EditorTab): Promise<void> {
  const settings = useSettingsStore.getState().config.mainView;
  if (!settings.formatOnSave && !settings.organizeImportsOnSave) return;
  if (activeTab()?.id !== tab.id) return;

  const { getEditor } = await import('./editorRegistry');
  const editor = getEditor();
  const model = getModel(tab.uri);
  if (!editor || !model) return;
  if (editor.getModel() !== model) editor.setModel(model);

  const workspace = useEditorStore.getState().workspace;
  if (workspace) {
    const { ensureLanguageClient } = await import('../lsp/LanguageClientService');
    await ensureLanguageClient(tab.languageId, workspace.rootUri, tab.uri).catch((error) =>
      console.error('Language server save actions unavailable', error),
    );
  }

  if (settings.organizeImportsOnSave) {
    await organizeImports(tab).catch((error) =>
      console.error('Organize imports on save failed', error),
    );
  }
  if (settings.formatOnSave) await editor.getAction('editor.action.formatDocument')?.run();
}

export async function saveTab(tab: EditorTab): Promise<void> {
  // Terminal tabs have no content to save.
  if (isTerminalUri(tab.uri)) return;
  flushRichEdits(tab.uri);
  const model = getModel(tab.uri);
  // Tabs without a text model (image previews) have nothing to write: saving
  // an empty string would truncate the file on disk.
  if (!model && !tab.uri.startsWith('untitled:')) return;
  const content = model?.getValue() ?? '';
  if (tab.uri.startsWith('untitled:')) {
    const result = await window.api.file.saveAsDialog({ content, suggestedName: tab.title });
    if (!result) throw new Error('Save cancelled');
    const model = replaceModelUri(tab.uri, result.uri, content, result.languageId);
    markModelSaved(model);
    if (activeTab()?.id === tab.id) {
      const { getEditor } = await import('./editorRegistry');
      getEditor()?.setModel(model);
    }
    invalidateGitBaseline(result.path);
    useEditorStore.getState().markSaved(tab.uri, result);
    return;
  }

  await runActiveTabSaveActions(tab);
  const savedModel = getModel(tab.uri);
  // Snapshot the version with the content: edits made while writing stay unsaved.
  const savedVersion = savedModel?.getAlternativeVersionId();
  await window.api.file.save({ path: tab.path, content: savedModel?.getValue() ?? content });
  invalidateGitBaseline(tab.path);
  useEditorStore.getState().markSaved(tab.uri);
  if (savedModel && !savedModel.isDisposed()) {
    markModelSaved(savedModel, savedVersion);
    if (isModelDirty(savedModel)) useEditorStore.getState().setDirty(tab.uri, true);
  }
}

export async function saveActiveTab(): Promise<void> {
  const tab = activeTab();
  if (!tab) return;
  await saveTab(tab);
}

export async function saveAllTabs(): Promise<void> {
  flushAllRichEdits();
  const dirtyTabs = useEditorStore.getState().tabs.filter((tab) => tab.dirty);
  for (const tab of dirtyTabs) {
    await saveTab(tab);
  }
}

/**
 * Safety net before the unsaved-changes prompt: content identical to the file
 * on disk has nothing to lose. Any doubt (read error, untitled) keeps the prompt.
 */
async function matchesFileOnDisk(tab: EditorTab): Promise<boolean> {
  if (tab.uri.startsWith('untitled:')) return false;
  const model = getModel(tab.uri);
  if (!model) return false;
  try {
    const versionId = model.getAlternativeVersionId();
    const file = await window.api.file.read(tab.path);
    if (model.isDisposed() || model.getAlternativeVersionId() !== versionId) return false;
    if (file.content !== model.getValue()) return false;
    markModelSaved(model, versionId);
    useEditorStore.getState().setDirty(tab.uri, false);
    return true;
  } catch {
    return false;
  }
}

export async function promptToSaveTab(
  staleTab: EditorTab,
): Promise<'saved' | 'discarded' | 'cancelled'> {
  // Pending rich markdown edits may mark the tab dirty; re-read it afterwards.
  flushRichEdits(staleTab.uri);
  const tab = useEditorStore.getState().tabs.find((candidate) => candidate.id === staleTab.id) ?? staleTab;
  if (!tab.dirty) return 'discarded';
  if (await matchesFileOnDisk(tab)) return 'discarded';
  const choice = await window.api.dialog.unsavedChanges(tab.title);
  if (choice === 'cancel') return 'cancelled';
  if (choice === 'discard') return 'discarded';
  try {
    await saveTab(tab);
    return 'saved';
  } catch (error) {
    if (error instanceof Error && error.message === 'Save cancelled') return 'cancelled';
    console.error(error);
    window.alert(error instanceof Error ? error.message : `Failed to save ${tab.title}.`);
    return 'cancelled';
  }
}

export async function closeTabWithPrompt(
  tab: EditorTab,
  groupId = useEditorStore.getState().activeGroupId,
): Promise<boolean> {
  const state = useEditorStore.getState();
  const groupContainsTab = state.groups
    .find((group) => group.id === groupId)
    ?.tabIds.includes(tab.id);
  if (!groupContainsTab) return false;

  const isOpenInAnotherGroup = state.groups.some(
    (group) => group.id !== groupId && group.tabIds.includes(tab.id),
  );
  if (!isOpenInAnotherGroup) {
    const result = await promptToSaveTab(tab);
    if (result === 'cancelled') return false;
  }

  const closed = useEditorStore.getState().closeTabInGroup(tab.id, groupId);
  if (closed && !isUriOpen(closed.uri)) disposeModel(closed.uri);
  return true;
}

export async function handleWindowCloseRequest(): Promise<void> {
  flushAllRichEdits();
  for (const tab of useEditorStore.getState().tabs.filter((candidate) => candidate.dirty)) {
    const result = await promptToSaveTab(tab);
    if (result === 'cancelled') {
      await window.api.window.closeCancel();
      return;
    }
  }
  await window.api.window.closeProceed();
}
