/**
 * Pre-build cleanup: move stale top-level build outputs (sw.js, sw.mjs,
 * workbox-*.js, etc.) out of dist/ into <root>/.trash/dist-stale/.
 *
 * Why: vite-plugin-pwa builds the service worker into a temp sw.mjs and
 * then renames it to sw.js at the end of the build. If a previous dist/sw.js
 * is still present (we keep emptyOutDir:false for sandbox-trash compatibility),
 * the rename hits EPERM on Windows and the whole build fails. Moving the
 * stale SW files aside before `vite build` removes the collision.
 *
 * Uses rename (not delete) to stay compatible with environments where the OS
 * trash layer blocks recursive deletion — same pattern as clean-dist-content.mjs.
 */
import { existsSync, mkdirSync, renameSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const trashDir = path.join(root, '.trash', 'dist-stale');

if (!existsSync(dist)) {
  process.exit(0);
}

// Top-level stale files that collide with PWA/Vite output names. Hashed
// assets under dist/assets/ are content-addressed and harmless to keep.
const STALE = new Set([
  'sw.js',
  'sw.mjs',
  'sw.js.map',
  'sw.mjs.map',
  'workbox-*.js',
  'workbox-*.js.map',
  'registerSW.js',
]);

function matchesStale(name) {
  if (STALE.has(name)) return true;
  if (name.startsWith('workbox-') && (name.endsWith('.js') || name.endsWith('.js.map'))) return true;
  return false;
}

mkdirSync(trashDir, { recursive: true });
let moved = 0;
for (const name of readdirSync(dist)) {
  if (!matchesStale(name)) continue;
  const src = path.join(dist, name);
  let dest = path.join(trashDir, name);
  if (existsSync(dest)) dest = `${dest}.${Date.now()}`;
  try {
    renameSync(src, dest);
    moved += 1;
    console.log(`[clean-stale-build] moved dist/${name} → .trash/dist-stale/`);
  } catch (e) {
    console.warn(`[clean-stale-build] WARN could not move ${name}: ${String(e).slice(0, 60)}`);
  }
}
if (moved > 0) console.log(`[clean-stale-build] done (${moved} file(s))`);
