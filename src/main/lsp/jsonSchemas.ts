import { net } from 'electron';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { getLanguageConfig } from '@shared/language-registry';
import type { JsonSchemaAssociation } from '@shared/lsp-types';

/**
 * Which JSON schema goes with which file name, for vscode-json-languageserver:
 * it validates and completes a file against a schema, but only knows the
 * schema when the file has a `$schema` key or the client tells it. VS Code
 * learns these associations from its extensions; Carlito uses the SchemaStore
 * catalog instead (the one Zed and Neovim setups use), plus the user's own
 * `jsonSchemas` from languages.json.
 *
 * The catalog is only fetched when a JSON server starts, and is cached on disk
 * so later starts (and offline ones) read it from there.
 */

const CATALOG_URL = 'https://www.schemastore.org/api/json/catalog.json';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

/** Files SchemaStore leaves out but that take the same schema as a listed one. */
const EXTRA_ASSOCIATIONS: JsonSchemaAssociation[] = [
  {
    fileMatch: ['**/.claude/settings.local.json'],
    url: 'https://www.schemastore.org/claude-code-settings.json',
  },
];

/** The catalog also lists YAML/TOML files; the JSON server never sees those. */
const NON_JSON_PATTERN = /\.(ya?ml|toml)$/i;

function cachePath(): string {
  const cacheHome = process.env.XDG_CACHE_HOME || join(process.env.HOME ?? process.cwd(), '.cache');
  return join(cacheHome, 'carlito', 'schemastore-catalog.json');
}

function parseCatalog(text: string): JsonSchemaAssociation[] {
  const catalog = JSON.parse(text) as { schemas?: unknown };
  if (!Array.isArray(catalog.schemas)) throw new Error('SchemaStore catalog has no schemas list');
  return catalog.schemas.flatMap((entry: unknown) => {
    if (!entry || typeof entry !== 'object') return [];
    const { fileMatch, url } = entry as { fileMatch?: unknown; url?: unknown };
    if (typeof url !== 'string' || !Array.isArray(fileMatch)) return [];
    const patterns = fileMatch.filter(
      (pattern): pattern is string => typeof pattern === 'string' && !NON_JSON_PATTERN.test(pattern),
    );
    return patterns.length > 0 ? [{ fileMatch: patterns, url }] : [];
  });
}

async function readCache(): Promise<{ text: string; fresh: boolean } | undefined> {
  try {
    const path = cachePath();
    const [text, info] = await Promise.all([readFile(path, 'utf8'), stat(path)]);
    return { text, fresh: Date.now() - info.mtimeMs < MAX_AGE_MS };
  } catch {
    return undefined;
  }
}

async function downloadCatalog(): Promise<string> {
  const response = await net.fetch(CATALOG_URL, { signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`SchemaStore catalog: HTTP ${response.status}`);
  const text = await response.text();
  parseCatalog(text); // do not cache something unusable
  const path = cachePath();
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, text, 'utf8');
  return text;
}

async function loadCatalog(): Promise<JsonSchemaAssociation[]> {
  const cached = await readCache();
  if (cached?.fresh) {
    try {
      return parseCatalog(cached.text);
    } catch {
      // corrupt cache: download it again below
    }
  }
  try {
    return parseCatalog(await downloadCatalog());
  } catch (error) {
    console.error('Failed to download the SchemaStore catalog', error);
    if (!cached) return [];
    try {
      return parseCatalog(cached.text);
    } catch {
      return [];
    }
  }
}

/** Shared by every window; a failed load is retried at the next JSON server start. */
let catalog: Promise<JsonSchemaAssociation[]> | undefined;

export async function jsonSchemaAssociations(): Promise<JsonSchemaAssociation[]> {
  if (!catalog) {
    const loading = loadCatalog();
    catalog = loading;
    void loading.then((schemas) => {
      if (schemas.length === 0 && catalog === loading) catalog = undefined;
    });
  }
  return [...(await catalog), ...EXTRA_ASSOCIATIONS, ...getLanguageConfig().jsonSchemas];
}
