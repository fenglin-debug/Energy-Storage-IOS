/**
 * Post-build cleanup: remove anything from dist that is not required for
 * production — dev-only bundled.* corpus copies, the lock file (embeds local
 * Android paths), and stray files. Moved into `<root>/.trash/dist-content/`
 * (rename, not delete) to stay compatible with environments where the OS
 * trash layer blocks recursive deletion. The source copies under
 * public/content/ are kept for dev/preview fallback.
 */
import { existsSync, mkdirSync, readdirSync, renameSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const contentDir = path.join(dist, 'content');
const trashDir = path.join(root, '.trash', 'dist-content');

if (!existsSync(contentDir)) {
  console.log('[clean-dist-content] dist/content missing, nothing to do');
  process.exit(0);
}

const VERSIONED = /^(corpus|article)-[0-9a-f]{12}\.(besspack|bessarticle)$/;
const KEEP = new Set(['catalog.json']);

let moved = 0;
mkdirSync(trashDir, { recursive: true });

for (const name of readdirSync(contentDir)) {
  if (KEEP.has(name) || VERSIONED.test(name)) continue;
  const src = path.join(contentDir, name);
  let dest = path.join(trashDir, name);
  if (existsSync(dest)) dest = `${dest}.${Date.now()}`;
  try {
    renameSync(src, dest);
    moved += 1;
    console.log(`[clean-dist-content] moved dist/content/${name} → .trash/dist-content/`);
  } catch (e) {
    console.warn(`[clean-dist-content] WARN could not move ${name}: ${String(e).slice(0, 60)}`);
  }
}

// The lock file embeds local Android source paths — never ship it.
const lockInDist = path.join(dist, 'assets-lock.json');
if (existsSync(lockInDist)) {
  try {
    renameSync(lockInDist, path.join(trashDir, 'assets-lock.json'));
    moved += 1;
    console.log('[clean-dist-content] moved dist/assets-lock.json → .trash/dist-content/');
  } catch (e) {
    console.warn(`[clean-dist-content] WARN could not move assets-lock.json: ${String(e).slice(0, 60)}`);
  }
}
console.log(`[clean-dist-content] done (${moved} file(s))`);
