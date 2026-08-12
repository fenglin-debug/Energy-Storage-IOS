import { unzipSync, zipSync, strToU8 } from 'fflate';

export interface UnzipGuard {
  /** Max number of entries allowed (after the dir-skip filter). */
  maxEntries?: number;
  /** Max sum of uncompressed entry sizes, in bytes. */
  maxTotalBytes?: number;
}

const DEFAULT_MAX_ENTRIES = 20_000;
// 512 MB covers the corpus package (audio is already compressed, so the
// unzipped total stays well under this) while blocking zip bombs.
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

/**
 * Unzip a buffer into a Map<path, bytes>.
 *
 * Zip-bomb resistant: fflate's `filter` runs BEFORE each entry is
 * decompressed, so we can reject oversized/too-many entries without ever
 * allocating the decompressed bytes. A malicious package with a tiny
 * compressed size but a huge declared originalSize is refused here.
 */
export function unzipToMap(
  bytes: Uint8Array,
  guard: UnzipGuard = {},
): Map<string, Uint8Array> {
  const maxEntries = guard.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxTotalBytes = guard.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

  let entryCount = 0;
  let totalOriginal = 0;
  let rejected: 'TOO_MANY_ENTRIES' | 'TOO_LARGE' | null = null;

  const raw = unzipSync(bytes, {
    filter(file) {
      // Directories end with '/' and have originalSize 0; skip silently.
      if (file.name.endsWith('/')) return false;
      entryCount += 1;
      if (entryCount > maxEntries) {
        rejected = 'TOO_MANY_ENTRIES';
        return false;
      }
      totalOriginal += file.originalSize;
      if (totalOriginal > maxTotalBytes) {
        rejected = 'TOO_LARGE';
        return false;
      }
      return true;
    },
  });

  if (rejected) {
    throw new Error(rejected === 'TOO_MANY_ENTRIES' ? 'ZIP_TOO_MANY_ENTRIES' : 'ZIP_TOO_LARGE');
  }

  const out = new Map<string, Uint8Array>();
  for (const [name, data] of Object.entries(raw)) {
    if (name.endsWith('/')) continue;
    // Normalize zip paths to forward slashes without leading ./
    const key = name.replace(/^\.\//, '').replace(/\\/g, '/');
    out.set(key, data);
  }
  return out;
}

export function zipFromMap(entries: Map<string, Uint8Array>): Uint8Array {
  const obj: Record<string, Uint8Array> = {};
  for (const [name, data] of entries) obj[name] = data;
  return zipSync(obj, { level: 0 });
}

export function zipTextEntries(entries: Record<string, string>): Uint8Array {
  const obj: Record<string, Uint8Array> = {};
  for (const [name, text] of Object.entries(entries)) obj[name] = strToU8(text);
  return zipSync(obj, { level: 0 });
}
