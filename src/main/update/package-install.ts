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

/** Streams `asset` to `destination` and returns its SHA-256 (hex). */
export async function download(asset: ReleaseAsset, destination: string): Promise<string> {
  const response = await fetch(asset.url, { headers: { 'User-Agent': 'carlo-update-check' } });
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

/** Checks the package name, version and architecture recorded in the .deb itself. */
export async function verifyPackage(debPath: string, version: string): Promise<void> {
  const { stdout } = await execFileAsync('dpkg-deb', ['-f', debPath, 'Package', 'Version', 'Architecture']);
  const fields = Object.fromEntries(
    stdout
      .split('\n')
      .map((line) => line.split(/:\s*/, 2))
      .filter((parts) => parts.length === 2),
  );
  if (fields.Package !== PACKAGE_NAME || fields.Version !== version || fields.Architecture !== 'amd64') {
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
): Promise<string> {
  const sumsPath = join(dir, 'SHA256SUMS');
  await download(release.checksums, sumsPath);
  const expected = parseChecksums(await readFile(sumsPath, 'utf8')).get(release.deb.name);
  if (!expected) throw new Error(`SHA256SUMS has no entry for ${release.deb.name}.`);
  const debPath = join(dir, release.deb.name);
  const actual = await download(release.deb, debPath);
  if (actual !== expected) throw new Error(`Checksum mismatch for ${release.deb.name}.`);
  await verifyPackage(debPath, release.version);
  return debPath;
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
        if (error.code === 127) {
          return reject(
            new Error('Authorization failed, or no polkit authentication agent is running.'),
          );
        }
        const detail = stderr.trim().split('\n').slice(-6).join('\n');
        reject(new Error(detail || error.message));
      },
    );
    // Nothing should ever wait for input; make sure nothing can.
    child.stdin?.end();
  });
}
