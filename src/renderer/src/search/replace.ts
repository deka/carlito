import type { WorkspaceReplaceEdit, WorkspaceSearchMatch } from '@shared/file-types';
import { computeReplacement, type ReplaceOptions } from '@shared/search-replace';
import { flushRichEdits } from '../markdown/pendingRichEdits';
import { useEditorStore } from '../store/useEditorStore';
import { groupByPath } from '../utils/groupByPath';

export interface ReplaceRequest {
  query: string;
  replaceText: string;
  options: ReplaceOptions;
}

export interface ReplaceOutcome {
  /** Matches known to be replaced, with the text that replaced them (fully applied files only). */
  replaced: { match: WorkspaceSearchMatch; replacement: string }[];
  /** Occurrences actually replaced, including files where some matches were skipped. */
  applied: number;
  /** Number of matches left untouched (file changed, regex not supported in JavaScript…). */
  skipped: number;
  fileCount: number;
  errors: string[];
}

export function replacementFor(match: WorkspaceSearchMatch, request: ReplaceRequest): string | null {
  const matchText = match.preview.slice(match.matchStart, match.matchEnd);
  return computeReplacement(matchText, request.query, request.replaceText, request.options);
}

interface PlannedEdit {
  match: WorkspaceSearchMatch;
  edit: WorkspaceReplaceEdit;
}

function planEdits(matches: WorkspaceSearchMatch[], request: ReplaceRequest): { planned: PlannedEdit[]; unsupported: number } {
  const planned: PlannedEdit[] = [];
  let unsupported = 0;
  for (const match of matches) {
    const replacement = replacementFor(match, request);
    if (replacement === null) {
      unsupported += 1;
      continue;
    }
    planned.push({
      match,
      edit: {
        lineNumber: match.lineNumber,
        start: match.matchStart,
        end: match.matchEnd,
        expected: match.preview.slice(match.matchStart, match.matchEnd),
        replacement,
      },
    });
  }
  return { planned, unsupported };
}

/** Edits an open text model (undoable); saves it when it had no unsaved changes before. */
async function replaceInOpenModel(path: string, uri: string, planned: PlannedEdit[], outcome: ReplaceOutcome): Promise<boolean> {
  const { getModel, isModelDirty, markModelSaved } = await import('../editor/models');
  const model = getModel(uri);
  if (!model || model.isDisposed()) return false;
  // The rich markdown editor writes into the model on a delay: apply its pending keystrokes first.
  flushRichEdits(uri);
  const wasDirty = isModelDirty(model);
  const applied: PlannedEdit[] = [];
  const lineCount = model.getLineCount();
  for (const item of planned) {
    const { lineNumber, start, end, expected } = item.edit;
    if (lineNumber > lineCount || model.getLineContent(lineNumber).slice(start, end) !== expected) {
      outcome.skipped += 1;
      continue;
    }
    applied.push(item);
  }
  if (applied.length === 0) return true;
  model.pushStackElement();
  model.pushEditOperations(
    [],
    applied.map(({ edit }) => ({
      range: {
        startLineNumber: edit.lineNumber,
        startColumn: edit.start + 1,
        endLineNumber: edit.lineNumber,
        endColumn: edit.end + 1,
      },
      text: edit.replacement,
    })),
    () => null,
  );
  model.pushStackElement();
  for (const { match, edit } of applied) outcome.replaced.push({ match, replacement: edit.replacement });
  outcome.applied += applied.length;
  if (!wasDirty) {
    const savedVersion = model.getAlternativeVersionId();
    await window.api.file.save({ path, content: model.getValue() });
    markModelSaved(model, savedVersion);
    useEditorStore.getState().markSaved(uri);
    const { invalidateGitBaseline } = await import('../editor/gitGutter');
    invalidateGitBaseline(path);
  }
  return true;
}

/**
 * Replaces the given search matches. Open files are edited in their editor model (and saved if
 * they were clean); other files are rewritten by the main process, which re-checks every match.
 */
export async function replaceMatches(matches: WorkspaceSearchMatch[], request: ReplaceRequest): Promise<ReplaceOutcome> {
  const outcome: ReplaceOutcome = { replaced: [], applied: 0, skipped: 0, fileCount: 0, errors: [] };
  // Match open files by path: tab URIs are built in the renderer and may be encoded differently.
  const openUriByPath = new Map(
    useEditorStore
      .getState()
      .tabs.filter((tab) => tab.uri.startsWith('file:'))
      .map((tab) => [tab.path, tab.uri]),
  );
  const diskFiles: { path: string; planned: PlannedEdit[] }[] = [];

  for (const [path, fileMatches] of groupByPath(matches)) {
    const { planned, unsupported } = planEdits(fileMatches, request);
    outcome.skipped += unsupported;
    if (planned.length === 0) continue;
    const openUri = openUriByPath.get(path);
    const before = outcome.applied;
    try {
      if (openUri && (await replaceInOpenModel(path, openUri, planned, outcome))) {
        if (outcome.applied > before) outcome.fileCount += 1;
        continue;
      }
    } catch (error) {
      outcome.errors.push(`${path}: ${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    diskFiles.push({ path, planned });
  }

  if (diskFiles.length > 0) {
    const { files } = await window.api.workspace.replace({
      files: diskFiles.map(({ path, planned }) => ({ path, edits: planned.map(({ edit }) => edit) })),
    });
    files.forEach((result, index) => {
      const planned = diskFiles[index]!.planned;
      if (result.error) outcome.errors.push(`${result.path}: ${result.error}`);
      outcome.skipped += result.skipped;
      outcome.applied += result.applied;
      if (result.applied > 0) outcome.fileCount += 1;
      // Only a fully applied file tells which matches changed; partial files get re-searched.
      if (result.skipped === 0 && !result.error) {
        for (const { match, edit } of planned) outcome.replaced.push({ match, replacement: edit.replacement });
      }
    });
  }
  return outcome;
}

/**
 * Drops replaced matches from the result list and shifts the other matches of the same lines
 * (preview text and offsets), as VS Code does, instead of searching again.
 */
export function resultsAfterReplace(
  results: WorkspaceSearchMatch[],
  replaced: ReplaceOutcome['replaced'],
): WorkspaceSearchMatch[] {
  const lineKey = (match: WorkspaceSearchMatch): string => `${match.path}:${match.lineNumber}`;
  const replacedByLine = new Map<string, ReplaceOutcome['replaced']>();
  const replacedSet = new Set<WorkspaceSearchMatch>();
  for (const item of replaced) {
    replacedSet.add(item.match);
    const group = replacedByLine.get(lineKey(item.match)) ?? [];
    group.push(item);
    replacedByLine.set(lineKey(item.match), group);
  }
  const next: WorkspaceSearchMatch[] = [];
  for (const result of results) {
    if (replacedSet.has(result)) continue;
    const lineReplacements = replacedByLine.get(lineKey(result));
    if (!lineReplacements) {
      next.push(result);
      continue;
    }
    let { preview, matchStart, matchEnd } = result;
    for (const { match, replacement } of [...lineReplacements].sort((a, b) => b.match.matchStart - a.match.matchStart)) {
      preview = preview.slice(0, match.matchStart) + replacement + preview.slice(match.matchEnd);
      if (matchStart >= match.matchEnd) {
        const delta = replacement.length - (match.matchEnd - match.matchStart);
        matchStart += delta;
        matchEnd += delta;
      }
    }
    next.push({ ...result, preview, matchStart, matchEnd, column: matchStart + 1 });
  }
  return next;
}
