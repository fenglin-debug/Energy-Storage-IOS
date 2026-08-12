/**
 * Copy locked Android bundled packages into ios-pwa/public/content.
 * Fails if SHA-256 does not match public/assets-lock.json.
 */
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lockPath = path.join(root, 'public', 'assets-lock.json');
const lock = JSON.parse(readFileSync(lockPath, 'utf8'));

function sha256File(filePath) {
  const hash = createHash('sha256');
  hash.update(readFileSync(filePath));
  return hash.digest('hex');
}

let ok = 0;
for (const asset of lock.assets) {
  const source = path.resolve(root, asset.source);
  const destination = path.resolve(root, asset.destination);
  if (!existsSync(source)) {
    console.error(`[prepare-assets] Missing source: ${source}`);
    process.exit(1);
  }
  const actual = sha256File(source);
  if (actual.toLowerCase() !== asset.sha256.toLowerCase()) {
    console.error(
      `[prepare-assets] SHA-256 mismatch for ${asset.source}\n  expected ${asset.sha256}\n  actual   ${actual}`,
    );
    process.exit(1);
  }
  mkdirSync(path.dirname(destination), { recursive: true });
  // Skip the copy when the destination already matches the locked SHA.
  // Avoids overwrite races on Windows (AV/file locks) and speeds up rebuilds.
  if (existsSync(destination)) {
    const existing = sha256File(destination);
    if (existing.toLowerCase() === asset.sha256.toLowerCase()) {
      console.log(
        `[prepare-assets] OK (up-to-date) ${path.relative(root, destination)} (${actual.slice(0, 12)}…)`,
      );
      ok += 1;
      continue;
    }
  }
  copyFileSync(source, destination);
  console.log(`[prepare-assets] OK ${path.relative(root, destination)} (${actual.slice(0, 12)}…)`);
  ok += 1;
}

// Stamp for debugging (best-effort; a lock may block the rewrite)
try {
  writeFileSync(
    path.join(root, 'public', 'content', '.prepared.json'),
    JSON.stringify({ preparedAt: new Date().toISOString(), count: ok }, null, 2),
  );
} catch {
  console.warn('[prepare-assets] WARN could not write .prepared.json (locked)');
}
console.log(`[prepare-assets] Prepared ${ok} asset(s).`);
