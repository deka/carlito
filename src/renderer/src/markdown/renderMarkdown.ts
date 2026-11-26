import DOMPurify from 'dompurify';
import { Marked, type Tokens } from 'marked';
import {
  isSafeResolvedMarkdownImageUrl,
  markdownAnchorUrl,
  markdownExternalImageUrl,
  markdownLocalResourceUrl,
} from './markdownPathUtils';

interface RenderMarkdownOptions {
  resolveUrl?: (url: string) => string | undefined;
  resolveImageUrl?: (url: string) => string | undefined;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeUrl(value: string, options: RenderMarkdownOptions): string | undefined {
  const trimmed = value.trim();
  const directUrl = markdownAnchorUrl(trimmed);
  if (directUrl) return directUrl;

  const resolved = options.resolveUrl?.(trimmed);
  return resolved ? markdownLocalResourceUrl(resolved) : undefined;
}

function safeImageUrl(value: string, options: RenderMarkdownOptions): string | undefined {
  const trimmed = value.trim();
  const externalUrl = markdownExternalImageUrl(trimmed);
  if (externalUrl) return externalUrl;

  const resolved = options.resolveImageUrl?.(trimmed);
  return resolved && isSafeResolvedMarkdownImageUrl(resolved) ? resolved : undefined;
}

const htmlEntities: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" };

/** Prefix of heading ids, so they cannot clash with the app's own element ids. */
export const markdownHeadingIdPrefix = 'md-';

/** GitHub-style heading slug: `## Hello, World!` -> `hello-world`. */
export function markdownSlug(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\s_-]/gu, '')
    .replace(/\s/g, '-');
}

function createMarked(options: RenderMarkdownOptions): Marked {
  // Duplicate headings get `-1`, `-2`… like GitHub.
  const slugCounts = new Map<string, number>();
  const uniqueSlug = (text: string): string => {
    const base = markdownSlug(text);
    const count = slugCounts.get(base) ?? 0;
    slugCounts.set(base, count + 1);
    return count === 0 ? base : `${base}-${count}`;
  };
  return new Marked({
    gfm: true,
    breaks: false,
    renderer: {
      heading({ tokens, depth }: Tokens.Heading): string {
        const html = this.parser.parseInline(tokens);
        // Plain text, minus inline HTML tags, with marked's escaping undone.
        const text = this.parser
          .parseInline(tokens, this.parser.textRenderer)
          .replace(/<[^>]*>/g, '')
          .replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => htmlEntities[name] ?? '');
        const id = `${markdownHeadingIdPrefix}${uniqueSlug(text)}`;
        return `<h${depth} id="${escapeHtml(id)}">${html}</h${depth}>\n`;
      },
      link({ href, title, tokens }: Tokens.Link): string {
        const text = this.parser.parseInline(tokens);
        const url = safeUrl(href, options);
        if (!url) return text;
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<a href="${escapeHtml(url)}"${titleAttr} rel="noreferrer">${text}</a>`;
      },
      image({ href, title, text }: Tokens.Image): string {
        const url = safeImageUrl(href, options);
        if (!url) return escapeHtml(text);
        const titleAttr = title ? ` title="${escapeHtml(title)}"` : '';
        return `<img src="${escapeHtml(url)}" alt="${escapeHtml(text)}"${titleAttr}>`;
      },
    },
  });
}

// Links/images are already filtered by the renderer; also allow the local resource scheme.
const allowedUriRegexp = /^(?:(?:https?|mailto|carlo-file):|#)/i;

export function renderMarkdown(markdown: string, options: RenderMarkdownOptions = {}): string {
  const html = createMarked(options).parse(markdown, { async: false });
  return DOMPurify.sanitize(html, {
    ALLOWED_URI_REGEXP: allowedUriRegexp,
    FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe'],
  });
}

/** Image URLs referenced by the document (inline and reference-style). */
export function markdownImageUrls(markdown: string): string[] {
  const urls = new Set<string>();
  const marked = new Marked({ gfm: true });
  marked.walkTokens(marked.lexer(markdown), (token) => {
    if (token.type === 'image' && (token as Tokens.Image).href) {
      urls.add((token as Tokens.Image).href.trim());
    }
  });
  return [...urls];
}
