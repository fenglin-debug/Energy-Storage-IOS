/**
 * Generates SHA-versioned corpus files + content/catalog.json from the
 * Android-locked bundled packages (public/content/bundled.*).
 *
 * Outputs:
 *   public/content/corpus-<sha12>.besspack
 *   public/content/article-<sha12>.bessarticle
 *   public/content/catalog.json
 *
 * The SHA-versioned file names guarantee that CDNs/browsers never serve a
 * stale corpus after an upgrade, and let the first-launch downloader verify
 * integrity before activation.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { unzipSync, strFromU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const contentDir = path.join(root, 'public', 'content');

function readManifestVersion(fileName) {
  const bytes = readFileSync(path.join(contentDir, fileName));
  const zip = unzipSync(bytes);
  const manifestBytes = zip['manifest.json'];
  if (!manifestBytes) throw new Error(`[build-catalog] ${fileName}: manifest.json missing`);
  const manifest = JSON.parse(strFromU8(manifestBytes));
  if (!manifest.contentVersion) {
    throw new Error(`[build-catalog] ${fileName}: contentVersion missing`);
  }
  return manifest.contentVersion;
}

const catalog = { schemaVersion: 1, updatedAt: new Date().toISOString() };

for (const [src, kind, ext] of [
  ['bundled.besspack', 'corpus', 'besspack'],
  ['bundled.bessarticle', 'article', 'bessarticle'],
]) {
  const srcPath = path.join(contentDir, src);
  if (!existsSync(srcPath)) {
    throw new Error(`[build-catalog] missing ${srcPath} (run prepare-assets first)`);
  }
  const bytes = readFileSync(srcPath);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const sha12 = sha256.slice(0, 12);
  const fileName = `${kind}-${sha12}.${ext}`;
  const destPath = path.join(contentDir, fileName);
  // Versioned file names are content-addressed: skip when the file is
  // already in place (also avoids Windows file-lock races on rebuild).
  if (!existsSync(destPath)) {
    copyFileSync(srcPath, destPath);
  }
  catalog[kind] = {
    fileName,
    sha256,
    sizeBytes: bytes.byteLength,
    contentVersion: readManifestVersion(src),
  };
  console.log(`[build-catalog] ${fileName} (${bytes.byteLength} bytes, sha ${sha12}…)`);
}

// catalog.json MUST be in sync with the versioned package files. If the write
// fails (Windows file lock, EPERM, sandbox trash layer, …) we do NOT silently
// keep a stale catalog — instead we verify the on-disk copy still matches the
// freshly computed SHAs. Only when it is actually stale do we fail the build,
// so users never ship a catalog pointing at old content.
const catalogPath = path.join(contentDir, 'catalog.json');
const catalogJson = JSON.stringify(catalog, null, 2);
try {
  writeFileSync(catalogPath, catalogJson);
  console.log('[build-catalog] catalog.json written');
} catch (e) {
  let existing = null;
  try {
    existing = JSON.parse(readFileSync(catalogPath, 'utf8'));
  } catch {
    existing = null;
  }
  const stale =
    !existing ||
    existing.corpus?.sha256 !== catalog.corpus.sha256 ||
    existing.article?.sha256 !== catalog.article.sha256;
  if (stale) {
    throw new Error(
      `[build-catalog] could not write catalog.json and on-disk copy is stale: ${String(e).slice(0, 120)}`,
    );
  }
  console.log('[build-catalog] catalog.json write blocked, on-disk copy is up-to-date — OK');
}
