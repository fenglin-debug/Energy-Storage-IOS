/**
 * First-launch load of locked bundled packages from /content/.
 * This is the only intentional fetch of static app content (not remote APIs).
 */

export interface CatalogEntry {
  fileName: string;
  sha256: string;
  sizeBytes: number;
  contentVersion: string;
}

export interface ContentCatalog {
  schemaVersion: number;
  updatedAt?: string;
  corpus?: CatalogEntry;
  article?: CatalogEntry;
}

export async function loadBundledBytes(fileName: string): Promise<Uint8Array> {
  const url = `/content/${fileName}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`BUNDLED_LOAD_FAILED:${fileName}:${response.status}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * Fetch the content catalog (SHA-versioned corpus/article file list).
 * Throws when the server has no catalog (e.g. dev/preview fallback).
 */
export async function loadCatalog(): Promise<ContentCatalog> {
  const response = await fetch('/content/catalog.json');
  if (!response.ok) {
    throw new Error(`CATALOG_LOAD_FAILED:${response.status}`);
  }
  return (await response.json()) as ContentCatalog;
}

export async function requestPersistentStorage(): Promise<boolean> {
  try {
    if (navigator.storage?.persist) {
      return await navigator.storage.persist();
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function storageEstimateText(): Promise<string | null> {
  try {
    if (!navigator.storage?.estimate) return null;
    const est = await navigator.storage.estimate();
    const used = est.usage ?? 0;
    const quota = est.quota ?? 0;
    const fmt = (n: number) => `${(n / (1024 * 1024)).toFixed(1)} MB`;
    return `${fmt(used)} / ${fmt(quota)}`;
  } catch {
    return null;
  }
}
