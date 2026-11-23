/**
 * Line-level three-way merge used by the rich markdown editor.
 *
 * The rich editor re-serializes the whole document after every edit, and the
 * serializer normalizes syntax it did not write (list markers, emphasis
 * markers, escapes, table padding...). To keep git diffs limited to what the
 * user actually changed, edits are merged back onto the original source:
 *
 * - `source`   — the current markdown text of the file,
 * - `baseline` — the serializer output for `source` before the edit,
 * - `edited`   — the serializer output after the edit.
 *
 * Regions where `baseline` and `edited` agree keep the original `source`
 * text verbatim; regions the user changed take the `edited` text.
 */

/** `[label]: url` — not footnotes (`[^1]: ...`), which the serializer keeps. */
const linkDefinitionPattern = /^ {0,3}\[(?!\^)[^\]]+\]:\s*\S/;

/** Beyond this edit distance, line matching gives up and treats the middle as one block. */
const maxEditDistance = 2000;

/** For each line of `a`, the index of its matched line in `b`, or -1 (Myers LCS). */
export function matchLines(a: readonly string[], b: readonly string[]): Int32Array {
  const matches = new Int32Array(a.length).fill(-1);

  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    matches[start] = start;
    start++;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
    matches[endA] = endB;
  }

  const n = endA - start;
  const m = endB - start;
  if (n === 0 || m === 0) return matches;

  // Intern lines so the inner loop compares integers.
  const ids = new Map<string, number>();
  const intern = (line: string): number => {
    let id = ids.get(line);
    if (id === undefined) {
      id = ids.size;
      ids.set(line, id);
    }
    return id;
  };
  const ai = Int32Array.from({ length: n }, (_, i) => intern(a[start + i]));
  const bi = Int32Array.from({ length: m }, (_, j) => intern(b[start + j]));

  const max = Math.min(n + m, maxEditDistance);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  let found = -1;

  for (let d = 0; d <= max && found < 0; d++) {
    trace.push(v.slice(offset - d - 1, offset + d + 2));
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;
      let y = x - k;
      while (x < n && y < m && ai[x] === bi[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        found = d;
        break;
      }
    }
  }
  // Too different: leave the middle unmatched.
  if (found < 0) return matches;

  // Backtrack through the saved frontiers to recover the diagonal (matched) runs.
  let x = n;
  let y = m;
  for (let d = found; d > 0; d--) {
    const frontier = trace[d];
    const get = (k: number): number => frontier[k + d + 1];
    const k = x - y;
    const prevK = k === -d || (k !== d && get(k - 1) < get(k + 1)) ? k + 1 : k - 1;
    const prevX = get(prevK);
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
      matches[start + x] = start + y;
    }
    x = prevX;
    y = prevY;
  }
  while (x > 0 && y > 0) {
    x--;
    y--;
    matches[start + x] = start + y;
  }
  return matches;
}

function sameLines(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

/** Merge the `baseline` → `edited` change onto `source`; see the module comment. */
export function mergeSerializedEdit(source: string, baseline: string, edited: string): string {
  const eol = source.includes('\r\n') ? '\r\n' : '\n';
  const sourceLines = source.split(/\r?\n/);
  const baseLines = baseline.split('\n');
  const editedLines = edited.split('\n');

  const toEdited = matchLines(baseLines, editedLines);
  const toSource = matchLines(baseLines, sourceLines);

  // Anchors: baseline lines present unchanged in both the source and the edit.
  // Both matchings are monotonic, so anchors are ordered in all three texts.
  const anchors: Array<[number, number, number]> = [[-1, -1, -1]];
  for (let i = 0; i < baseLines.length; i++) {
    if (toEdited[i] >= 0 && toSource[i] >= 0) anchors.push([i, toSource[i], toEdited[i]]);
  }
  anchors.push([baseLines.length, sourceLines.length, editedLines.length]);

  const out: string[] = [];
  for (let index = 1; index < anchors.length; index++) {
    const [b0, s0, e0] = anchors[index - 1];
    const [b1, s1, e1] = anchors[index];
    const baseSegment = baseLines.slice(b0 + 1, b1);
    const editedSegment = editedLines.slice(e0 + 1, e1);
    const sourceSegment = sourceLines.slice(s0 + 1, s1);
    if (sameLines(baseSegment, editedSegment)) out.push(...sourceSegment);
    else if (baseSegment.length === 0) {
      // Pure insertion: the source lines here are unknown to the serializer
      // (e.g. link reference definitions); keep them after the new content.
      out.push(...editedSegment, ...sourceSegment);
    } else {
      out.push(...editedSegment);
      // The serializer inlines reference links and drops their definitions:
      // never let an edit nearby delete them.
      for (const line of sourceSegment) {
        if (linkDefinitionPattern.test(line) && !editedSegment.includes(line)) out.push(line);
      }
    }
    if (index < anchors.length - 1) out.push(sourceLines[s1]);
  }
  return out.join(eol);
}

/** Smallest single replacement turning `before` into `after` (common prefix/suffix trimmed). */
export function minimalReplacement(
  before: string,
  after: string,
): { start: number; end: number; text: string } | undefined {
  if (before === after) return undefined;
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before.charCodeAt(start) === after.charCodeAt(start)) start++;
  let endBefore = before.length;
  let endAfter = after.length;
  while (
    endBefore > start &&
    endAfter > start &&
    before.charCodeAt(endBefore - 1) === after.charCodeAt(endAfter - 1)
  ) {
    endBefore--;
    endAfter--;
  }
  return { start, end: endBefore, text: after.slice(start, endAfter) };
}
