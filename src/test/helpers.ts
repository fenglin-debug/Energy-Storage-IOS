import { createHash } from 'node:crypto';
import { db } from '@/data/Database';
import { zipFromMap, zipTextEntries } from '@/data/Zip';

/** Reset the Dexie database between tests. */
export async function resetDb(): Promise<void> {
  await db.delete();
  await db.open();
}

export function sha256Hex(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

const CORPUS_DATA_FILES = [
  'data/vocabulary.json',
  'data/phrases.json',
  'data/examples.json',
  'data/scenarios.json',
  'data/dialogue_turns.json',
  'data/dialogue_pairs.json',
  'data/dialogue_pair_words.json',
  'data/dialogue_pair_phrases.json',
  'data/audio_manifest.json',
] as const;

const DATA_CONTENT: Record<string, string> = {
  'data/vocabulary.json': '[]',
  'data/phrases.json': '[]',
  'data/examples.json': '[]',
  'data/scenarios.json': '[]',
  'data/dialogue_turns.json': '[]',
  'data/dialogue_pairs.json': '[]',
  'data/dialogue_pair_words.json': '[]',
  'data/dialogue_pair_phrases.json': '[]',
  'data/audio_manifest.json': '{"assets":[]}',
};

/**
 * Build a minimal but valid .besspack (schema 3, zero entries) for
 * repository-level import tests.
 */
export function buildTestCorpusPack(contentVersion = 'test.corpus.1'): Uint8Array {
  const encoder = new TextEncoder();
  const dataFiles = CORPUS_DATA_FILES.map((p) => {
    const bytes = encoder.encode(DATA_CONTENT[p]!);
    return {
      path: p,
      sha256: sha256Hex(bytes),
      sizeBytes: bytes.byteLength,
    };
  });

  const manifest = JSON.stringify({
    schemaVersion: 3,
    packageId: 'bess-sales-english-core',
    contentVersion,
    createdAt: '2026-08-04T00:00:00Z',
    minimumAppVersionCode: 1,
    counts: {
      vocabulary: 0,
      phrases: 0,
      examples: 0,
      scenarios: 0,
      dialogueTurns: 0,
      dialoguePairs: 0,
      audioAssets: 0,
    },
    dataFiles,
  });
  const manifestSha = sha256Hex(encoder.encode(manifest));

  // checksums.sha256 lines: "<64hex>  <path>" sorted by path.
  const checksumEntries = [
    ['manifest.json', manifestSha],
    ...CORPUS_DATA_FILES.map((p) => [p, dataFiles.find((d) => d.path === p)!.sha256] as const),
  ].sort((a, b) => (a[0] < b[0] ? -1 : 1));
  const checksumText = checksumEntries
    .map(([p, sha]) => `${sha}  ${p}`)
    .join('\n');

  const entries: Record<string, string> = {
    ...DATA_CONTENT,
    'manifest.json': manifest,
    'checksums.sha256': checksumText,
  };
  return zipTextEntries(entries);
}

/** Build a minimal but valid .bessarticle (schema 2, one article). */
export function buildTestArticlePack(contentVersion = 'test.article.1'): Uint8Array {
  const encoder = new TextEncoder();
  const manifest = JSON.stringify({
    schemaVersion: 2,
    packageId: 'bess-article',
    contentVersion,
    createdAt: '2026-08-04T00:00:00Z',
    articles: [
      {
        id: 'ART-9001',
        title: 'Test Article',
        titleZh: '测试文章',
        topic: 'BESS',
        paragraphs: [
          { textEn: 'Hello world.', textZh: '你好世界。', startMs: 0, endMs: 500 },
        ],
        audioFile: 'audio/ART-9001.m4a',
        durationMs: 5000,
        contentHash: 'x',
        contentScope: 'BESS',
      },
    ],
  });
  const manifestBytes = encoder.encode(manifest);
  const audioBytes = encoder.encode('fake audio bytes');
  const checksumText = [
    `manifest.json  ${sha256Hex(manifestBytes)}`,
    `audio/ART-9001.m4a  ${sha256Hex(audioBytes)}`,
  ].join('\n');
  const entries = new Map<string, Uint8Array>([
    ['manifest.json', manifestBytes],
    ['checksums.sha256', encoder.encode(checksumText)],
    ['audio/ART-9001.m4a', audioBytes],
  ]);
  return zipFromMap(entries);
}
