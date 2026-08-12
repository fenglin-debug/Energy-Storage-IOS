export interface PackFile {
  path: string;
  sha256: string;
  sizeBytes: number;
}

export interface PackCounts {
  vocabulary: number;
  phrases: number;
  examples: number;
  scenarios: number;
  dialogueTurns: number;
  dialoguePairs: number;
  audioAssets: number;
}

export interface PackManifest {
  schemaVersion: number;
  packageId: string;
  contentVersion: string;
  createdAt: string;
  minimumAppVersionCode: number;
  counts: PackCounts;
  dataFiles: PackFile[];
}

export interface PackVocabulary {
  id: string;
  term: string;
  normalizedTerm: string;
  ipa: string;
  partOfSpeech: string;
  chineseGloss: string;
  englishDefinition?: string | null;
  collocations: string[];
  exampleSentenceEn: string;
  exampleSentenceZh?: string | null;
  commonMistakes: string;
  topic: string;
  scenarioTags: string[];
  aliases: string[];
  cefrLevel: string;
  wordAudioAssetId: string;
  exampleAudioAssetId: string;
  contentSource: string;
  contentHash: string;
}

export interface PackPhrase {
  id: string;
  industry: string;
  scene: string;
  category: string;
  textEn: string;
  textZh: string;
  linkedTermIds: string[];
  sourceType: string;
  audioAssetId: string;
  contentHash: string;
}

export interface PackExample {
  id: string;
  industry: string;
  scene: string;
  speaker: string;
  textEn: string;
  textZh: string;
  linkedTermIds: string[];
  dialogueGroupId?: string | null;
  sourceType: string;
  audioAssetId: string;
  contentHash: string;
}

export interface PackScenario {
  id: string;
  title: string;
  topic: string;
  salesStage: string;
  customerRole: string;
  difficulty: string;
  projectType: string;
  estimatedMinutes: number;
  description?: string | null;
  contentHash: string;
}

export interface PackDialogueTurn {
  id: string;
  scenarioId: string;
  turnNo: number;
  speaker: string;
  textEn: string;
  textZh?: string | null;
  hint?: string | null;
  audioAssetId?: string | null;
  contentHash: string;
}

export interface PackScoringPoint {
  id: string;
  type: string;
  descriptionZh: string;
  keywordsEn: string;
  required: boolean;
  weight: number;
}

export interface PackDialoguePair {
  id: string;
  scenarioId: string;
  pairIndex: number;
  customerTurnId: string;
  salesTurnId: string;
  referenceCoreEn: string;
  referenceChineseHint: string;
  formalAlternatives: string[];
  scoringPoints: PackScoringPoint[];
  riskNote?: string | null;
  contentHash: string;
}

export interface PackPairWord {
  pairId: string;
  wordId: string;
  sortOrder: number;
}

export interface PackPairPhrase {
  pairId: string;
  phraseId: string;
  sortOrder: number;
}

export interface PackAudioAsset {
  id: string;
  kind: string;
  relativePath: string;
  sha256: string;
  mimeType: string;
  codec: string;
  durationMs: number;
  sizeBytes: number;
}

export interface AudioManifest {
  assets: PackAudioAsset[];
}

export interface ArticleParagraphPackage {
  textEn: string;
  textZh: string;
  startMs?: number | null;
  endMs?: number | null;
}

export interface ArticlePackageEntry {
  id: string;
  title: string;
  titleZh: string;
  topic: string;
  paragraphs: ArticleParagraphPackage[];
  audioFile: string;
  durationMs: number;
  contentHash: string;
  contentScope: string;
}

export interface ArticlePackageManifest {
  schemaVersion: number;
  packageId: string;
  contentVersion: string;
  createdAt: string;
  articles: ArticlePackageEntry[];
}

export interface ValidatedCorpus {
  manifest: PackManifest;
  vocabulary: PackVocabulary[];
  phrases: PackPhrase[];
  examples: PackExample[];
  scenarios: PackScenario[];
  turns: PackDialogueTurn[];
  pairs: PackDialoguePair[];
  pairWords: PackPairWord[];
  pairPhrases: PackPairPhrase[];
  audioAssets: PackAudioAsset[];
  /** path -> bytes for every non-directory entry */
  files: Map<string, Uint8Array>;
}

export interface ValidatedArticlePackage {
  manifest: ArticlePackageManifest;
  files: Map<string, Uint8Array>;
}
