import { pathToFileURL } from 'node:url';

/** Prefix pairs to swap, in the host → container direction. */
interface PrefixPair {
  from: string;
  to: string;
}

/** Fields holding document content, which must never be rewritten. */
const contentKeys = new Set(['text']);

function swapPrefix(value: string, pairs: readonly PrefixPair[]): string {
  for (const { from, to } of pairs) {
    if (!value.startsWith(from)) continue;
    const next = value.charAt(from.length);
    // Only whole path segments: /work/app must not match /work/application.
    if (next === '' || next === '/' || next === '?' || next === '#') return to + value.slice(from.length);
  }
  return value;
}

function rewrite(value: unknown, pairs: readonly PrefixPair[]): unknown {
  if (typeof value === 'string') return swapPrefix(value, pairs);
  if (Array.isArray(value)) return value.map((item) => rewrite(item, pairs));
  if (!value || typeof value !== 'object') return value;
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    result[contentKeys.has(key) ? key : swapPrefix(key, pairs)] = contentKeys.has(key)
      ? item
      : rewrite(item, pairs);
  }
  return result;
}

/**
 * Servers exit when the `processId` of `initialize` is not alive, and a host pid
 * does not exist in the container's pid namespace.
 */
function withoutHostProcessId<T>(message: T): T {
  const request = message as { method?: unknown; params?: { processId?: unknown } };
  if (request?.method !== 'initialize' || !request.params) return message;
  return { ...request, params: { ...request.params, processId: null } } as T;
}

function fileUri(path: string): string {
  return pathToFileURL(path).href.replace(/\/$/, '');
}

/**
 * Rewrites the workspace folder in LSP messages between its host path, where Monaco
 * opens files, and its path inside a dev container, where the language server runs.
 * Object keys are rewritten too (WorkspaceEdit.changes is keyed by URI).
 */
export class PathMapping {
  private readonly toContainerPairs: PrefixPair[];
  private readonly toHostPairs: PrefixPair[];

  constructor(hostRoot: string, containerRoot: string) {
    // URIs before plain paths: a file URI never starts with a bare path.
    this.toContainerPairs = [
      { from: fileUri(hostRoot), to: `file://${encodeURI(containerRoot)}` },
      { from: hostRoot, to: containerRoot },
    ];
    this.toHostPairs = this.toContainerPairs.map(({ from, to }) => ({ from: to, to: from }));
  }

  toContainer<T>(message: T): T {
    const mapped = rewrite(message, this.toContainerPairs) as T;
    return withoutHostProcessId(mapped);
  }

  toHost<T>(message: T): T {
    return rewrite(message, this.toHostPairs) as T;
  }
}
