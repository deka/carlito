import { execFile } from 'node:child_process';
import { readdir, readFile, lstat, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import type {
  WorkspaceReplaceEdit,
  WorkspaceReplaceFileResult,
  WorkspaceSearchMatch,
  WorkspaceSearchRequest,
  WorkspaceSearchResult,
} from '@shared/file-types';
import { applyLineEdits, buildSearchRegExp } from '@shared/search-replace';
import { ignoredNames, isIgnoredPath } from './ignored-paths';

const execFileAsync = promisify(execFile);

interface RgJsonMatch {
  type: 'match' | string;
  data?: {
    path?: { text?: string };
    lines?: { text?: string };
    line_number?: number;
    submatches?: { start: number; end: number }[];
  };
}

function matchResult(
  path: string,
  lineNumber: number,
  preview: string,
  matchStart: number,
  matchEnd: number,
): WorkspaceSearchMatch {
  return { path, uri: pathToFileURL(path).toString(), lineNumber, column: matchStart + 1, preview, matchStart, matchEnd };
}

function parseRipgrepJson(output: string, maxResults: number): WorkspaceSearchResult {
  const matches: WorkspaceSearchMatch[] = [];
  const detectionLimit = maxResults + 1;
  for (const line of output.split('\n')) {
    if (!line.trim()) continue;
    let event: RgJsonMatch;
    try {
      event = JSON.parse(line) as RgJsonMatch;
    } catch {
      continue;
    }
    if (event.type !== 'match' || !event.data) continue;
    const path = event.data.path?.text;
    const lineText = event.data.lines?.text;
    const lineNumber = event.data.line_number;
    if (!path || lineText === undefined || !lineNumber) continue;
    const preview = lineText.replace(/\r?\n$/, '');
    // ripgrep reports byte offsets; editors and replacements need UTF-16 string indices.
    const bytes = Buffer.from(lineText, 'utf8');
    const toIndex = (byteOffset: number): number => bytes.subarray(0, byteOffset).toString('utf8').length;
    for (const submatch of event.data.submatches ?? []) {
      const start = toIndex(submatch.start);
      const end = Math.min(toIndex(submatch.end), preview.length);
      if (end <= start) continue;
      matches.push(matchResult(path, lineNumber, preview, start, end));
      if (matches.length >= detectionLimit) {
        return { matches: matches.slice(0, maxResults), truncated: true };
      }
    }
  }
  return { matches, truncated: false };
}

/**
 * VS Code style include/exclude list: comma separated, `./` optional; a plain name or path
 * (no glob characters) also matches everything below it.
 */
export function parseGlobList(value: string | undefined): string[] {
  const globs: string[] = [];
  for (const raw of (value ?? '').split(',')) {
    const pattern = raw.trim().replace(/^\.\//, '').replace(/\/+$/, '');
    if (!pattern) continue;
    globs.push(pattern);
    if (!/[*?[{]/.test(pattern)) globs.push(pattern.includes('/') ? `${pattern}/**` : `**/${pattern}/**`);
  }
  return globs;
}

function ripgrepArgs(request: WorkspaceSearchRequest & { rootPath: string }): string[] {
  const useIgnoreFiles = request.useIgnoreFiles !== false;
  const excludedNames = useIgnoreFiles ? [...ignoredNames] : ['.git'];
  const args = [
    '--json',
    '--hidden',
    request.isCaseSensitive ? '--case-sensitive' : '--ignore-case',
    '--color',
    'never',
    '--glob',
    `!{${excludedNames.join(',')}}`,
  ];
  if (!request.isRegex) args.push('--fixed-strings');
  if (request.isWordMatch) args.push('--word-regexp');
  if (!useIgnoreFiles) args.push('--no-ignore');
  for (const glob of parseGlobList(request.includes)) args.push('--glob', glob);
  for (const glob of parseGlobList(request.excludes)) args.push('--glob', `!${glob}`);
  args.push('--', request.query, request.rootPath);
  return args;
}

async function searchWithRipgrep(
  request: WorkspaceSearchRequest & { rootPath: string; maxResults: number },
): Promise<WorkspaceSearchResult> {
  try {
    const { stdout } = await execFileAsync('rg', ripgrepArgs(request), {
      cwd: request.rootPath,
      maxBuffer: 64 * 1024 * 1024,
    });
    return parseRipgrepJson(stdout, request.maxResults);
  } catch (error) {
    const maybeError = error as Omit<NodeJS.ErrnoException, 'code'> & { stdout?: string; stderr?: string; code?: unknown };
    if (maybeError.code === 'ENOENT') throw error;
    const result = parseRipgrepJson(maybeError.stdout ?? '', request.maxResults);
    if (maybeError.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return { ...result, truncated: true };
    // Exit code 1: no match. Exit code 2: an error (invalid regex…), possibly alongside partial
    // results when some files were unreadable; only report it when nothing was found.
    if (maybeError.code === 2 && result.matches.length === 0) {
      const message = maybeError.stderr?.trim() || 'Search failed';
      return { ...result, error: message.split('\n').slice(0, 8).join('\n') };
    }
    if (maybeError.code === 1 || maybeError.code === 2) return result;
    throw error;
  }
}

function globToRegExp(glob: string): RegExp {
  let source = '';
  let braceDepth = 0;
  for (let index = 0; index < glob.length; index += 1) {
    const char = glob[index]!;
    if (char === '*' && glob[index + 1] === '*') {
      const atStart = index === 0 || glob[index - 1] === '/';
      index += 1;
      if (atStart && glob[index + 1] === '/') {
        index += 1;
        source += '(?:.*/)?';
      } else {
        source += '.*';
      }
    } else if (char === '*') source += '[^/]*';
    else if (char === '?') source += '[^/]';
    else if (char === '{') {
      braceDepth += 1;
      source += '(?:';
    } else if (char === '}' && braceDepth > 0) {
      braceDepth -= 1;
      source += ')';
    } else if (char === ',' && braceDepth > 0) source += '|';
    else source += char.replace(/[.+^$()|[\]{}\\]/g, '\\$&');
  }
  return new RegExp(`^${source}$`);
}

/** Mirrors ripgrep globs: a pattern without `/` matches the file name at any depth. */
function globMatcher(globs: string[]): (relativePath: string) => boolean {
  const matchers = globs.map((glob) => ({ regExp: globToRegExp(glob), basename: !glob.includes('/') }));
  return (relativePath) =>
    matchers.some(({ regExp, basename }) =>
      regExp.test(basename ? relativePath.slice(relativePath.lastIndexOf('/') + 1) : relativePath),
    );
}

async function searchFallback(
  rootPath: string,
  request: WorkspaceSearchRequest & { maxResults: number },
): Promise<WorkspaceSearchResult> {
  let regExp: RegExp;
  try {
    regExp = buildSearchRegExp(request.query, request);
  } catch (error) {
    return { matches: [], truncated: false, error: error instanceof Error ? error.message : String(error) };
  }
  const { maxResults } = request;
  const matches: WorkspaceSearchMatch[] = [];
  const detectionLimit = maxResults + 1;
  const excludedNames = request.useIgnoreFiles !== false ? ignoredNames : new Set(['.git']);
  const includeGlobs = parseGlobList(request.includes);
  const isIncluded = includeGlobs.length ? globMatcher(includeGlobs) : () => true;
  const isExcluded = globMatcher(parseGlobList(request.excludes));

  async function walk(path: string): Promise<void> {
    if (matches.length >= detectionLimit || isIgnoredPath(relative(rootPath, path), excludedNames)) return;
    const relativePath = relative(rootPath, path).split(sep).join('/');
    if (relativePath && isExcluded(relativePath)) return;
    const stats = await lstat(path).catch(() => undefined);
    if (!stats || stats.isSymbolicLink()) return;
    if (stats.isDirectory()) {
      const entries = await readdir(path).catch(() => []);
      for (const entry of entries) await walk(join(path, entry));
      return;
    }
    if (!stats.isFile() || stats.size > 1024 * 1024 || !isIncluded(relativePath)) return;
    const content = await readFile(path, 'utf8').catch(() => undefined);
    if (content === undefined || content.includes('\0')) return;
    const lines = content.replace(/^﻿/, '').split('\n');
    for (let index = 0; index < lines.length && matches.length < detectionLimit; index += 1) {
      const preview = lines[index]!.replace(/\r$/, '');
      regExp.lastIndex = 0;
      for (const match of preview.matchAll(regExp)) {
        if (!match[0]) continue;
        matches.push(matchResult(path, index + 1, preview, match.index, match.index + match[0].length));
        if (matches.length >= detectionLimit) break;
      }
    }
  }

  await walk(rootPath);
  return { matches: matches.slice(0, maxResults), truncated: matches.length > maxResults };
}

export async function searchWorkspace(
  rootPath: string,
  request: WorkspaceSearchRequest,
): Promise<WorkspaceSearchResult> {
  // Spaces are significant (searching "foo " must not match "foobar"): never trim the query.
  const { query } = request;
  const maxResults = Math.min(Math.max(request.maxResults ?? 2000, 1), 10000);
  if (!query) return { matches: [], truncated: false };
  let result: WorkspaceSearchResult;
  try {
    result = await searchWithRipgrep({ ...request, rootPath, query, maxResults });
  } catch (error) {
    const maybeError = error as NodeJS.ErrnoException;
    if (maybeError.code !== 'ENOENT') console.error('workspace search failed, falling back', error);
    result = await searchFallback(rootPath, { ...request, maxResults });
  }
  // ripgrep searches files in parallel: order files by path (stable sort keeps line order).
  result.matches.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  return result;
}

/** Applies replacements to a file on disk, refusing files that do not round-trip as UTF-8. */
export async function replaceInFile(path: string, edits: WorkspaceReplaceEdit[]): Promise<WorkspaceReplaceFileResult> {
  try {
    const bytes = await readFile(path);
    const content = bytes.toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes)) {
      return { path, applied: 0, skipped: edits.length, error: 'File is not valid UTF-8' };
    }
    const result = applyLineEdits(content, edits);
    if (result.applied > 0) await writeFile(path, result.content, 'utf8');
    return { path, applied: result.applied, skipped: result.skipped };
  } catch (error) {
    return { path, applied: 0, skipped: edits.length, error: error instanceof Error ? error.message : String(error) };
  }
}
