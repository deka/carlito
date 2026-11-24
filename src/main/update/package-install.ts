// Electron-free on purpose: download/verify/install of the Carlo .deb, runnable from plain Node.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { promisify } from 'node:util';
import { parseChecksums } from './versions';

const execFileAsync = promisify(execFile);

export const PACKAGE_NAME = 'carlo';
export const PKEXEC = '/usr/bin/pkexec';
export const APT_GET = '/usr/bin/apt-get';

export interface ReleaseAsset {
  name: string;
  url: string;
}

/** The app passes Electron's `net.fetch`; plain Node falls back to the global `fetch`. */
export type FetchImpl = (url: string, init?: RequestInit) => Promise<Response>;

/** Time allowed to connect and receive the response headers (the body may take longer). */
const HEADERS_TIMEOUT_MS = 30_000;

/**
 * Fetches `url`, aborting if the headers take too long, and retries once on a network-level
 * failure (DNS, connect, TLS, reset). HTTP error statuses are returned, never retried.
 */
async function fetchAsset(fetchImpl: FetchImpl, url: string): Promise<Response> {
  for (let attempt = 1; ; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Timed out waiting for the server.')),
      HEADERS_TIMEOUT_MS,
    );
    try {
      return await fetchImpl(url, {
        headers: { 'User-Agent': 'carlo-update-check' },
        signal: controller.signal,
      });
    } catch (error) {
      if (attempt >= 2) throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Streams `asset` to `destination` and returns its SHA-256 (hex). */
export async function download(
  asset: ReleaseAsset,
  destination: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  let response: Response;
  try {
    response = await fetchAsset(fetchImpl, asset.url);
  } catch (error) {
    throw new Error(`Download of ${asset.name} failed: ${describeError(error)}`, { cause: error });
  }
  if (!response.ok || !response.body) {
    throw new Error(`Download of ${asset.name} failed: ${response.status} ${response.statusText}`);
  }
  const hash = createHash('sha256');
  await pipeline(
    Readable.fromWeb(response.body as WebReadableStream<Uint8Array>),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk);
        yield chunk;
      }
    },
    createWriteStream(destination, { mode: 0o644 }),
  );
  return hash.digest('hex');
}

/** An error message including its cause: Node's `fetch` hides the real reason in `cause`. */
export function describeError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const cause = error.cause;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const detail = [code, cause.message].filter(Boolean).join(' ');
    if (detail && !error.message.includes(detail)) return `${error.message} (${detail})`;
  }
  return error.message;
}

/** Checks the package name, version and architecture recorded in the .deb itself. */
export async function verifyPackage(debPath: string, version: string): Promise<void> {
  const { stdout } = await execFileAsync('dpkg-deb', [
    '-f',
    debPath,
    'Package',
    'Version',
    'Architecture',
  ]);
  const fields = Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.split(/:\s*/, 2))
      .filter((parts) => parts.length === 2),
  );
  if (
    fields.Package !== PACKAGE_NAME ||
    fields.Version !== version ||
    fields.Architecture !== 'amd64'
  ) {
    throw new Error(
      `Unexpected package metadata: ${fields.Package} ${fields.Version} ${fields.Architecture}.`,
    );
  }
}

/**
 * Downloads `SHA256SUMS` and the .deb into `dir`, checks the checksum and the package
 * metadata, and returns the path of the verified .deb. Throws on any mismatch.
 */
export async function downloadVerifiedDeb(
  release: { version: string; deb: ReleaseAsset; checksums: ReleaseAsset },
  dir: string,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  const sumsPath = join(dir, 'SHA256SUMS');
  await download(release.checksums, sumsPath, fetchImpl);
  const expected = parseChecksums(await readFile(sumsPath, 'utf8')).get(release.deb.name);
  if (!expected) throw new Error(`SHA256SUMS has no entry for ${release.deb.name}.`);
  const debPath = join(dir, release.deb.name);
  const actual = await download(release.deb, debPath, fetchImpl);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${release.deb.name}.`);
  await verifyPackage(debPath, release.version);
  return debPath;
}

/** pkexec could not obtain authorization: the package itself is fine and can be installed by hand. */
export class AuthorizationError extends Error {
  override name = 'AuthorizationError';
}

/** The command a user can paste in a terminal to install `debPath` themselves. */
export function manualInstallCommand(debPath: string): string {
  return `sudo apt install '${debPath.replaceAll("'", "'\\''")}'`;
}

export type InstallOutcome = 'installed' | 'cancelled';

/** Runs apt-get as root through polkit: the password dialog belongs to the system, never to Carlo. */
export function aptInstall(debPath: string): Promise<InstallOutcome> {
  return new Promise((resolve, reject) => {
    const child = execFile(
      PKEXEC,
      [APT_GET, 'install', '-y', debPath],
      { maxBuffer: 16 * 1024 * 1024 },
      (error, _stdout, stderr) => {
        if (!error) return resolve('installed');
        // pkexec exits 126 when the authentication dialog is dismissed: stay silent.
        if (error.code === 126) return resolve('cancelled');
        const detail = stderr.trim().split('\n').slice(-6).join('\n');
        if (error.code === 127) {
          // pkexec's own reason (e.g. "Not authorized") is on stderr; keep it, it is the only clue.
          const reason = 'Authorization failed, or no polkit authentication agent is running.';
          return reject(new AuthorizationError(detail ? `${reason}\n${detail}` : reason));
        }
        reject(new Error(detail || error.message));
      },
    );
    // Nothing should ever wait for input; make sure nothing can.
    child.stdin?.end();
  });
}
