import { sha256Hex, utf8String } from './Crypto';
import type {
  ArticlePackageManifest,
  AudioManifest,
  PackDialoguePair,
  PackDialogueTurn,
  PackExample,
  PackFile,
  PackManifest,
  PackPhrase,
  PackScenario,
  PackVocabulary,
  ValidatedArticlePackage,
  ValidatedCorpus,
} from './PackageModels';
import { unzipToMap } from './Zip';

const CORPUS_REQUIRED = [
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

const APP_VERSION_CODE = 2;

function requireEntries(names: Set<string>, required: string[]): void {
  for (const name of required) {
    if (!names.has(name)) throw new Error(`MISSING_ENTRY:${name}`);
  }
}

function parseJson<T>(files: Map<string, Uint8Array>, path: string): T {
  const bytes = files.get(path);
  if (!bytes) throw new Error(`MISSING_ENTRY:${path}`);
  return JSON.parse(utf8String(bytes)) as T;
}

function unique(ids: string[]): void {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) throw new Error(`DUPLICATE_ID:${id}`);
    seen.add(id);
  }
}

async function verifyChecksums(files: Map<string, Uint8Array>): Promise<Map<string, string>> {
  const text = utf8String(files.get('checksums.sha256')!);
  const checksums = new Map<string, string>();
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    const match = /^([0-9a-fA-F]{64})\s+(.+)$/.exec(line);
    if (!match || checksums.has(match[2]!)) throw new Error('INVALID_CHECKSUM_FILE');
    checksums.set(match[2]!, match[1]!.toLowerCase());
  }
  for (const [name, data] of files) {
    if (name === 'checksums.sha256') continue;
    const expected = checksums.get(name);
    if (expected === undefined) throw new Error(`CHECKSUM_NOT_LISTED:${name}`);
    const actual = (await sha256Hex(data)).toLowerCase();
    if (actual !== expected) throw new Error(`CHECKSUM_MISMATCH:${name}`);
  }
  for (const name of checksums.keys()) {
    if (!files.has(name)) throw new Error(`CHECKSUM_ENTRY_MISSING:${name}`);
  }
  return checksums;
}

export async function validateCorpusPackage(bytes: Uint8Array): Promise<ValidatedCorpus> {
  const files = unzipToMap(bytes);
  const names = new Set(files.keys());
  requireEntries(names, ['manifest.json', 'checksums.sha256', ...CORPUS_REQUIRED]);
  const checksums = await verifyChecksums(files);
  const manifest = parseJson<PackManifest>(files, 'manifest.json');
  if (manifest.schemaVersion < 2 || manifest.schemaVersion > 3) {
    throw new Error('UNSUPPORTED_CORPUS_SCHEMA');
  }
  if (manifest.minimumAppVersionCode > APP_VERSION_CODE) {
    throw new Error('APP_VERSION_TOO_OLD');
  }
  const listed = new Map<string, PackFile>();
  for (const item of manifest.dataFiles) listed.set(item.path, item);
  for (const [path, hash] of checksums) {
    if (path === 'manifest.json') continue;
    const item = listed.get(path);
    const data = files.get(path)!;
    if (!item || item.sha256.toLowerCase() !== hash) {
      throw new Error(`MANIFEST_HASH_MISMATCH:${path}`);
    }
    if (item.sizeBytes !== data.byteLength) {
      throw new Error(`MANIFEST_SIZE_MISMATCH:${path}`);
    }
  }

  const vocabulary = parseJson<PackVocabulary[]>(files, CORPUS_REQUIRED[0]);
  const phrases = parseJson<PackPhrase[]>(files, CORPUS_REQUIRED[1]);
  const examples = parseJson<PackExample[]>(files, CORPUS_REQUIRED[2]);
  const scenarios = parseJson<PackScenario[]>(files, CORPUS_REQUIRED[3]);
  const turns = parseJson<PackDialogueTurn[]>(files, CORPUS_REQUIRED[4]);
  const pairs = parseJson<PackDialoguePair[]>(files, CORPUS_REQUIRED[5]);
  const pairWords = parseJson(files, CORPUS_REQUIRED[6]) as ValidatedCorpus['pairWords'];
  const pairPhrases = parseJson(files, CORPUS_REQUIRED[7]) as ValidatedCorpus['pairPhrases'];
  const audioAssets = parseJson<AudioManifest>(files, CORPUS_REQUIRED[8]).assets;

  const c = manifest.counts;
  if (
    c.vocabulary !== vocabulary.length ||
    c.phrases !== phrases.length ||
    c.examples !== examples.length ||
    c.scenarios !== scenarios.length ||
    c.dialogueTurns !== turns.length ||
    c.dialoguePairs !== pairs.length ||
    c.audioAssets !== audioAssets.length
  ) {
    throw new Error('MANIFEST_COUNTS_MISMATCH');
  }

  unique(vocabulary.map((v) => v.id));
  unique(vocabulary.map((v) => v.normalizedTerm));
  unique(phrases.map((p) => p.id));
  unique(examples.map((e) => e.id));
  unique(scenarios.map((s) => s.id));
  unique(turns.map((t) => t.id));
  unique(pairs.map((p) => p.id));
  unique(audioAssets.map((a) => a.id));

  if (vocabulary.some((v) => v.id.startsWith('WIND-') || v.contentSource === 'WIND')) {
    throw new Error('WIND_CONTENT_FORBIDDEN');
  }

  const scenarioIds = new Set(scenarios.map((s) => s.id));
  const assetIds = new Set(audioAssets.map((a) => a.id));
  for (const asset of audioAssets) {
    if (!names.has(asset.relativePath)) throw new Error(`AUDIO_MISSING:${asset.relativePath}`);
  }
  for (const turn of turns) {
    if (!scenarioIds.has(turn.scenarioId)) throw new Error('ORPHAN_TURN');
    if (!turn.audioAssetId || !assetIds.has(turn.audioAssetId)) throw new Error('TURN_AUDIO_MISSING');
  }
  for (const pair of pairs) {
    if (!scenarioIds.has(pair.scenarioId)) throw new Error('ORPHAN_PAIR');
  }

  return {
    manifest,
    vocabulary,
    phrases,
    examples,
    scenarios,
    turns,
    pairs,
    pairWords,
    pairPhrases,
    audioAssets,
    files,
  };
}

export async function validateArticlePackage(bytes: Uint8Array): Promise<ValidatedArticlePackage> {
  const files = unzipToMap(bytes);
  const names = new Set(files.keys());
  requireEntries(names, ['manifest.json', 'checksums.sha256']);
  await verifyChecksums(files);
  const manifest = parseJson<ArticlePackageManifest>(files, 'manifest.json');
  if (
    manifest.schemaVersion < 1 ||
    manifest.schemaVersion > 2 ||
    manifest.packageId !== 'bess-article'
  ) {
    throw new Error('UNSUPPORTED_ARTICLE_SCHEMA');
  }
  unique(manifest.articles.map((a) => a.id));
  for (const article of manifest.articles) {
    if (!article.title.trim() || !article.topic.trim() || article.paragraphs.length === 0) {
      throw new Error('INVALID_ARTICLE');
    }
    if (article.durationMs <= 0 || article.durationMs > 30 * 60 * 1000) {
      throw new Error('INVALID_ARTICLE_DURATION');
    }
    if (article.contentScope !== 'BESS' && article.contentScope !== 'UNSPECIFIED') {
      throw new Error('INVALID_CONTENT_SCOPE');
    }
    if (article.audioFile !== `audio/${article.id}.m4a` || !names.has(article.audioFile)) {
      throw new Error('ARTICLE_AUDIO_MISSING');
    }
    for (const p of article.paragraphs) {
      if (!p.textEn.trim() || !p.textZh.trim()) throw new Error('INVALID_ARTICLE_PARAGRAPH');
      if (manifest.schemaVersion >= 2) {
        if (
          p.startMs == null ||
          p.endMs == null ||
          p.startMs < 0 ||
          p.endMs <= p.startMs ||
          p.endMs > article.durationMs
        ) {
          throw new Error('INVALID_ARTICLE_CUES');
        }
      }
    }
  }
  return { manifest, files };
}
