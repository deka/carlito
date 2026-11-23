/**
 * Leading YAML (`---`) or TOML (`+++`) frontmatter is kept out of the rich
 * editor — the markdown parser would read it as a rule + setext heading — and
 * re-attached verbatim when edits are written back.
 */
const frontmatterPattern = /^(?:---|\+\+\+)[ \t]*\r?\n[\s\S]*?\r?\n(?:---|\+\+\+|\.\.\.)[ \t]*(?:\r?\n|$)/;

export function splitFrontmatter(markdown: string): { frontmatter: string; body: string } {
  const match = frontmatterPattern.exec(markdown);
  if (!match) return { frontmatter: '', body: markdown };
  const opening = match[0].slice(0, 3);
  const closing = match[0].trimEnd().slice(-3);
  // `---` ... `+++` is not a frontmatter block.
  if (opening === '+++' ? closing !== '+++' : closing === '+++') {
    return { frontmatter: '', body: markdown };
  }
  return { frontmatter: match[0], body: markdown.slice(match[0].length) };
}
