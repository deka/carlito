import * as monaco from '@codingame/monaco-vscode-editor-api';
import type { LanguageId } from '@shared/language-registry';

const models = new Map<string, monaco.editor.ITextModel>();
const externalContentUpdates = new WeakSet<monaco.editor.ITextModel>();
/** Alternative version id of each model's last saved (or loaded from disk) content. */
const savedVersions = new WeakMap<monaco.editor.ITextModel, number>();

/** Records that the model matches the file on disk (at `versionId`, default: now). */
export function markModelSaved(
  model: monaco.editor.ITextModel,
  versionId = model.getAlternativeVersionId(),
): void {
  savedVersions.set(model, versionId);
}

/** True when the content differs from what was last saved; undoing back to it is clean again. */
export function isModelDirty(model: monaco.editor.ITextModel): boolean {
  return savedVersions.get(model) !== model.getAlternativeVersionId();
}

export function getOrCreateModel(
  uri: string,
  content: string,
  languageId: LanguageId,
): monaco.editor.ITextModel {
  const existing = models.get(uri);
  if (existing) return existing;
  const model = monaco.editor.createModel(content, languageId, monaco.Uri.parse(uri));
  markModelSaved(model);
  models.set(uri, model);
  return model;
}

export function getModel(uri: string): monaco.editor.ITextModel | undefined {
  return models.get(uri);
}

export function replaceModelContentFromDisk(
  model: monaco.editor.ITextModel,
  content: string,
): boolean {
  if (model.getValue() === content) return false;
  externalContentUpdates.add(model);
  try {
    model.setValue(content);
  } finally {
    externalContentUpdates.delete(model);
  }
  markModelSaved(model);
  return true;
}

export function isApplyingExternalContentUpdate(model: monaco.editor.ITextModel): boolean {
  return externalContentUpdates.has(model);
}

/**
 * Moves content to a model under a new URI. Unsaved changes stay unsaved (a
 * rename must not make a modified file look clean); callers that just wrote
 * the content (save as) mark the new model saved themselves.
 */
export function replaceModelUri(
  oldUri: string,
  newUri: string,
  content: string,
  languageId: LanguageId,
): monaco.editor.ITextModel {
  const previous = models.get(oldUri);
  const wasDirty = previous ? isModelDirty(previous) : false;
  disposeModel(oldUri);
  const model = getOrCreateModel(newUri, content, languageId);
  if (wasDirty) savedVersions.set(model, -1);
  return model;
}

export function disposeModel(uri: string): void {
  const model = models.get(uri);
  if (!model) return;
  model.dispose();
  models.delete(uri);
}
