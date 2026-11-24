/** Image formats Carlo can display (and embed in markdown) instead of opening as text. */
export const imageMimeTypes: Readonly<Record<string, string>> = {
  '.apng': 'image/apng',
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
};

function extensionOf(path: string): string {
  const name = path.slice(Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')) + 1);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot).toLowerCase() : '';
}

export function imageMimeTypeForPath(path: string): string | undefined {
  return imageMimeTypes[extensionOf(path)];
}

/**
 * Raster images open in an image preview instead of a text editor. SVG is
 * excluded: it is text that users expect to edit.
 */
export function isBinaryImagePath(path: string): boolean {
  const mimeType = imageMimeTypeForPath(path);
  return mimeType !== undefined && mimeType !== 'image/svg+xml';
}

export function isPdfPath(path: string): boolean {
  return extensionOf(path) === '.pdf';
}

/** Files shown in a read-only preview tab: never decoded as text nor given a Monaco model. */
export function isBinaryPreviewPath(path: string): boolean {
  return isBinaryImagePath(path) || isPdfPath(path);
}
