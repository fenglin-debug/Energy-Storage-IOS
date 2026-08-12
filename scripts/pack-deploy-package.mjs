/**
 * Package the self-service deploy bundle: dist/ + nginx conf + scripts +
 * README-DEPLOY.md → deploy/bess-ios-pwa-deploy-package.zip
 *
 * Uses fflate (already a dependency) with forward-slash entry names so the
 * zip is portable to Linux (PowerShell Compress-Archive writes backslashes
 * which break python3 -m zipfile / unzip on the server).
 *
 * Layout inside the zip:
 *   deploy-package/
 *   ├── README-DEPLOY.md
 *   ├── dist/
 *   ├── nginx/bess-site.conf
 *   ├── install.sh / gen-htpasswd.sh / setup-ssl.sh / release.sh / rollback.sh / healthcheck.sh
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync, strToU8 } from 'fflate';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const deployDir = path.join(root, 'deploy');
const outZip = path.join(deployDir, 'bess-ios-pwa-deploy-package.zip');

if (!existsSync(dist) || !existsSync(path.join(dist, 'index.html'))) {
  console.error('[pack-deploy-package] dist/ missing. Run npm run build first.');
  process.exit(1);
}

/** Recursively collect files as { entryPath (fwd-slash), bytes }. */
function collectFiles(dir, prefix, out) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    const entry = `${prefix}/${name}`.replace(/^\/+/, '');
    if (st.isDirectory()) {
      collectFiles(full, entry, out);
    } else {
      out[entry] = readFileSync(full);
    }
  }
}

const files = {};
// dist/
collectFiles(dist, 'deploy-package/dist', files);
// nginx confs
files['deploy-package/nginx/bess-site.conf'] = readFileSync(
  path.join(deployDir, 'nginx', 'bess-site.conf'),
);
files['deploy-package/nginx/bess-security-headers.conf'] = readFileSync(
  path.join(deployDir, 'nginx', 'bess-security-headers.conf'),
);
// scripts + readme
for (const name of [
  'install.sh',
  'gen-htpasswd.sh',
  'setup-ssl.sh',
  'release.sh',
  'rollback.sh',
  'healthcheck.sh',
  'README-DEPLOY.md',
]) {
  const src = path.join(deployDir, name);
  if (!existsSync(src)) {
    console.error(`[pack-deploy-package] missing ${name}`);
    process.exit(1);
  }
  files[`deploy-package/${name}`] = readFileSync(src);
}

// Zip with store-level compression (fast; corpus audio is already compressed)
const zipped = zipSync(files, { level: 0 });
writeFileSync(outZip, zipped);
console.log(
  `[pack-deploy-package] OK ${outZip} (${(zipped.byteLength / (1024 * 1024)).toFixed(1)} MB, ${Object.keys(files).length} files)`,
);
console.log('[pack-deploy-package] 内容: dist/ + nginx/bess-site.conf + 6 脚本 + README-DEPLOY.md');
console.log('[pack-deploy-package] 用法: 解压后按 README-DEPLOY.md 在服务器执行');
