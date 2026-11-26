import type { WorkspaceReplaceEdit, WorkspaceSearchOptions } from './file-types';

export interface ReplaceOptions extends WorkspaceSearchOptions {
  preserveCase?: boolean;
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compileRegExp(source: string, flags: string): RegExp {
  try {
    return new RegExp(source, `${flags}u`);
  } catch {
    // Some patterns valid for ripgrep (e.g. `\-`) are rejected by the unicode flag.
    return new RegExp(source, flags);
  }
}

/** JavaScript equivalent of the ripgrep query (used when ripgrep is unavailable). */
export function buildSearchRegExp(query: string, options: WorkspaceSearchOptions): RegExp {
  let source = options.isRegex ? query : escapeRegExp(query);
  if (options.isWordMatch) source = `(?<![\\p{L}\\p{N}_])(?:${source})(?![\\p{L}\\p{N}_])`;
  const flags = `g${options.isCaseSensitive ? '' : 'i'}`;
  return options.isWordMatch ? new RegExp(source, `${flags}u`) : compileRegExp(source, flags);
}

/** VS Code replace syntax: `\n`, `\t`, `\\` escapes and `$0` for the whole match. */
function jsReplacePattern(replace: string): string {
  return replace
    .replace(/\\(.)/g, (escape, char: string) => (char === 'n' ? '\n' : char === 't' ? '\t' : char === '\\' ? '\\' : escape))
    .replace(/\$0/g, '$$&');
}

function applyPreservedCase(matchText: string, replacement: string): string {
  if (!replacement) return replacement;
  if (matchText === matchText.toUpperCase() && matchText !== matchText.toLowerCase()) return replacement.toUpperCase();
  if (matchText === matchText.toLowerCase() && matchText !== matchText.toUpperCase()) return replacement.toLowerCase();
  const first = matchText[0] ?? '';
  if (first !== first.toLowerCase()) return replacement[0]!.toUpperCase() + replacement.slice(1);
  if (first !== first.toUpperCase()) return replacement[0]!.toLowerCase() + replacement.slice(1);
  return replacement;
}

/**
 * Replacement text for one match. In regex mode the query is re-applied to the matched text
 * with JavaScript semantics; returns null when it does not cover the whole match (syntax only
 * ripgrep understands, lookarounds outside the match…), so the caller can skip it.
 */
export function computeReplacement(
  matchText: string,
  query: string,
  replace: string,
  options: ReplaceOptions,
): string | null {
  let result = replace;
  if (options.isRegex) {
    let regExp: RegExp;
    try {
      regExp = compileRegExp(`^(?:${query})$`, options.isCaseSensitive ? '' : 'i');
    } catch {
      return null;
    }
    if (!regExp.test(matchText)) return null;
    result = matchText.replace(regExp, jsReplacePattern(replace));
  }
  return options.preserveCase ? applyPreservedCase(matchText, result) : result;
}

export interface ApplyEditsResult {
  content: string;
  applied: number;
  skipped: number;
}

/**
 * Applies line-based edits to a whole file. Edits whose expected text is no longer at the
 * given position (file changed since the search) or that overlap another edit are skipped.
 * Line endings and a UTF-8 BOM are preserved.
 */
export function applyLineEdits(content: string, edits: WorkspaceReplaceEdit[]): ApplyEditsResult {
  const bom = content.startsWith('﻿') ? '﻿' : '';
  const lines = content.slice(bom.length).split('\n');
  let applied = 0;
  let skipped = 0;
  const byLine = new Map<number, WorkspaceReplaceEdit[]>();
  for (const edit of edits) {
    const group = byLine.get(edit.lineNumber) ?? [];
    group.push(edit);
    byLine.set(edit.lineNumber, group);
  }
  for (const [lineNumber, lineEdits] of byLine) {
    const index = lineNumber - 1;
    if (index < 0 || index >= lines.length) {
      skipped += lineEdits.length;
      continue;
    }
    let text = lines[index]!;
    let previousStart = Number.POSITIVE_INFINITY;
    // Right to left so earlier offsets stay valid.
    for (const edit of [...lineEdits].sort((a, b) => b.start - a.start)) {
      if (edit.end > previousStart || edit.start > edit.end || text.slice(edit.start, edit.end) !== edit.expected) {
        skipped += 1;
        continue;
      }
      text = text.slice(0, edit.start) + edit.replacement + text.slice(edit.end);
      previousStart = edit.start;
      applied += 1;
    }
    lines[index] = text;
  }
  return { content: bom + lines.join('\n'), applied, skipped };
}
