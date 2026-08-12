/**
 * Static contract scan: reject networking clients, recording, and ASR hooks in app source.
 */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcRoot = path.join(root, 'src');

const FORBIDDEN = [
  { re: /\bfetch\s*\(/g, label: 'fetch(' },
  { re: /\bXMLHttpRequest\b/g, label: 'XMLHttpRequest' },
  { re: /\baxios\b/g, label: 'axios' },
  { re: /\bWebSocket\b/g, label: 'WebSocket' },
  { re: /\bgetUserMedia\b/g, label: 'getUserMedia' },
  { re: /\bMediaRecorder\b/g, label: 'MediaRecorder' },
  { re: /\bwebkitSpeechRecognition\b/g, label: 'webkitSpeechRecognition' },
  { re: /\bSpeechRecognition\b/g, label: 'SpeechRecognition' },
  { re: /\bDeepSeek\b/g, label: 'DeepSeek' },
  { re: /\bAiCoach\b/g, label: 'AiCoach' },
  { re: /\bRECORD_AUDIO\b/g, label: 'RECORD_AUDIO' },
];

// Allowlisted paths (content load of bundled/versioned packages is
// intentional first-launch I/O; the downloader streams the corpus catalog;
// sw.ts performs network-first navigation fetches by design).
const ALLOW_FETCH_FILES = new Set([
  path.normalize('src/data/BundledLoader.ts'),
  path.normalize('src/data/CorpusRepositoryImpl.ts'),
  path.normalize('src/data/ArticleRepositoryImpl.ts'),
  path.normalize('src/data/CorpusDownloader.ts'),
  path.normalize('src/sw.ts'),
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|js|jsx|mjs)$/.test(name) && !name.endsWith('.test.ts')) out.push(full);
  }
  return out;
}

const files = walk(srcRoot);
const hits = [];

for (const file of files) {
  const rel = path.relative(root, file).split(path.sep).join('/');
  const text = readFileSync(file, 'utf8');
  for (const rule of FORBIDDEN) {
    if (rule.label === 'fetch(' && ALLOW_FETCH_FILES.has(path.normalize(rel))) continue;
    const matches = text.match(rule.re);
    if (matches) hits.push(`${rel}: ${rule.label} x${matches.length}`);
  }
}

if (hits.length) {
  console.error('[verify-contracts] FAILED\n' + hits.join('\n'));
  process.exit(1);
}
console.log(`[verify-contracts] OK — scanned ${files.length} source files.`);

// ---- Content contract: catalog must reference the exact Android-locked
//      bundled package SHAs (same bytes shipped to iOS PWA). ----
const lockPath = path.join(root, 'public', 'assets-lock.json');
const catalogPath = path.join(root, 'public', 'content', 'catalog.json');
if (existsSync(lockPath) && existsSync(catalogPath)) {
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
  const expected = {};
  for (const a of lock.assets ?? []) {
    const dest = String(a.destination ?? '').replace(/\\/g, '/');
    if (dest.endsWith('/bundled.besspack')) expected.corpus = String(a.sha256);
    else if (dest.endsWith('/bundled.bessarticle')) expected.article = String(a.sha256);
  }
  const problems = [];
  for (const [kind, sha] of Object.entries(expected)) {
    const entry = catalog[kind];
    if (!entry) problems.push(`catalog missing ${kind}`);
    else if (String(entry.sha256).toLowerCase() !== String(sha).toLowerCase()) {
      problems.push(`${kind} SHA mismatch (catalog ${String(entry.sha256).slice(0, 12)} vs lock ${String(sha).slice(0, 12)})`);
    }
  }
  if (catalog.corpus && catalog.corpus.fileName !== `corpus-${String(catalog.corpus.sha256).slice(0, 12)}.besspack`) {
    problems.push('corpus fileName does not match its SHA-12 prefix');
  }
  if (catalog.article && catalog.article.fileName !== `article-${String(catalog.article.sha256).slice(0, 12)}.bessarticle`) {
    problems.push('article fileName does not match its SHA-12 prefix');
  }
  if (problems.length) {
    console.error('[verify-contracts] CONTENT CONTRACT FAILED\n' + problems.join('\n'));
    process.exit(1);
  }
  console.log('[verify-contracts] content contract OK (corpus + article locked to Android SHAs)');
} else {
  console.log('[verify-contracts] content contract skipped (catalog not built yet)');
}
