/**
 * Zip dist/ into deploy/bess-ios-pwa-dist.zip for COS console upload.
 */
import { createWriteStream, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const outDir = path.join(root, 'deploy');
const outZip = path.join(outDir, 'bess-ios-pwa-dist.zip');

if (!existsSync(dist) || !existsSync(path.join(dist, 'index.html'))) {
  console.error('[pack-deploy] dist/ missing. Run npm run build first.');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });
if (existsSync(outZip)) {
  const { unlinkSync } = await import('node:fs');
  unlinkSync(outZip);
}

// Prefer PowerShell Compress-Archive on Windows for zero extra deps.
const ps = `
$ErrorActionPreference = 'Stop'
if (Test-Path '${outZip.replace(/'/g, "''")}') { Remove-Item -Force '${outZip.replace(/'/g, "''")}' }
Compress-Archive -Path '${dist.replace(/'/g, "''")}\\*' -DestinationPath '${outZip.replace(/'/g, "''")}' -Force
`;
const r = spawnSync('powershell', ['-NoProfile', '-Command', ps], { encoding: 'utf8' });
if (r.status !== 0) {
  console.error(r.stdout || '');
  console.error(r.stderr || '');
  console.error('[pack-deploy] Compress-Archive failed');
  process.exit(1);
}

const size = statSync(outZip).size;
console.log(`[pack-deploy] OK ${outZip} (${(size / (1024 * 1024)).toFixed(1)} MB)`);
console.log('[pack-deploy] Upload contents to COS bucket root (see docs/DEPLOY_TENCENT_COS.md)');
