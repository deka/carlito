/**
 * Undo escapes the markdown serializer adds to syntax it does not know but
 * that is common in notes (Obsidian): `[[wiki links]]`, `![[embeds]]` and
 * `> [!note]` callout headers. Without this, editing such a line in the rich
 * editor would write `\[\[Page]]` and break the link.
 */
export function restoreNoteSyntax(markdown: string): string {
  return markdown
    .replace(/\\\[\\\[([^\]\n]*)\]\]/g, '[[$1]]')
    .replace(/^((?:[ \t]*>[ \t]?)+)\\\[!([\w-]+)\]/gm, '$1[!$2]');
}
