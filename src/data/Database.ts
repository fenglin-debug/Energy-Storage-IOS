import Dexie, { type Table } from 'dexie';
import { DATABASE_VERSION } from '@/domain/Models';

export interface MetaRow {
  key: string;
  value: string;
}

export interface VocabularyEntryRow {
  id: string;
  term: string;
  normalizedTerm: string;
  ipa: string;
  partOfSpeech: string;
  chineseGloss: string;
  englishDefinition: string | null;
  collocationsJson: string;
  exampleSentenceEn: string;
  exampleSentenceZh: string | null;
  commonMistakes: string;
  topic: string;
  scenarioTagsJson: string;
  cefrLevel: string;
  wordAudioAssetId: string;
  exampleAudioAssetId: string;
  contentSource: string;
  contentHash: string;
  active: number;
}

export interface PhraseRow {
  id: string;
  industry: string;
  scene: string;
  category: string;
  textEn: string;
  textZh: string;
  linkedTermIdsJson: string;
  sourceType: string;
  audioAssetId: string;
  contentHash: string;
  active: number;
}

export interface ScenarioRow {
  id: string;
  title: string;
  topic: string;
  salesStage: string;
  customerRole: string;
  difficulty: string;
  projectType: string;
  estimatedMinutes: number;
  description: string | null;
  contentHash: string;
  active: number;
}

export interface DialogueTurnRow {
  id: string;
  scenarioId: string;
  turnNo: number;
  speaker: string;
  textEn: string;
  textZh: string | null;
  hint: string | null;
  audioAssetId: string | null;
  contentHash: string;
}

export interface DialoguePairRow {
  id: string;
  scenarioId: string;
  pairIndex: number;
  customerTurnId: string;
  salesTurnId: string;
  referenceCoreEn: string;
  referenceChineseHint: string;
  formalAlternativesJson: string;
  scoringPointsJson: string;
  riskNote: string | null;
  contentHash: string;
}

export interface PairWordRow {
  pairId: string;
  wordId: string;
  sortOrder: number;
}

export interface PairPhraseRow {
  pairId: string;
  phraseId: string;
  sortOrder: number;
}

export interface AudioAssetRow {
  id: string;
  kind: string;
  relativePath: string;
  sha256: string;
  mimeType: string;
  codec: string;
  durationMs: number;
  sizeBytes: number;
}

export interface AudioFileIndexRow {
  assetId: string;
  /** OPFS relative path or blob key */
  localKey: string;
  source: 'CORPUS' | 'ARTICLE' | 'BUNDLED_ARTICLE';
}

export interface ArticleRow {
  id: string;
  title: string;
  titleZh: string;
  topic: string;
  paragraphsJson: string;
  audioAssetId: string;
  durationMs: number;
  source: string;
  contentScope: string;
  contentHash: string;
  createdAtEpochMs: number;
}

export interface WordMemoryRow {
  wordId: string;
  fsrsState: string;
  difficulty: number;
  stability: number;
  dueAtEpochMs: number;
  lastReviewAtEpochMs: number | null;
  reps: number;
  lapses: number;
  masteredUi: number;
  lastQuestionMode: string | null;
  isFavorite: number;
  learnedContentHash: string | null;
  legacyNormalizedTerm: string | null;
  updatedAtEpochMs: number;
}

export interface ItemMemoryRow {
  itemId: string;
  itemType: string;
  fsrsState: string;
  difficulty: number;
  stability: number;
  dueAtEpochMs: number;
  lastReviewAtEpochMs: number | null;
  reps: number;
  lapses: number;
  masteredUi: number;
  learnedContentHash: string | null;
  updatedAtEpochMs: number;
  isFavorite: number;
}

export interface ExampleRow {
  id: string;
  industry: string;
  scene: string;
  speaker: string;
  textEn: string;
  textZh: string;
  linkedTermIdsJson: string;
  dialogueGroupId: string | null;
  sourceType: string;
  audioAssetId: string;
  contentHash: string;
  active: number;
}

export interface CorpusImportEventRow {
  id: string;
  kind: 'CORPUS' | 'ARTICLE';
  action: string;
  packageKey: string | null;
  contentVersion: string | null;
  createdAtEpochMs: number;
  detail: string | null;
}

export interface ReviewLogRow {
  id: string;
  wordId: string;
  rating: string;
  questionMode: string;
  usedHint: number;
  revealedAnswer: number;
  reviewedAtEpochMs: number;
  responseTimeMs: number | null;
  scheduledDays: number;
  elapsedDays: number;
  stateBefore: string;
  stateAfter: string;
}

export interface VocabCheckpointRow {
  sessionId: string;
  status: string;
  corpusVersion: string;
  queueWordIdsJson: string;
  currentIndex: number;
  questionMode: string;
  answerRevealed: number;
  hintRevealed: number;
  assessmentSubmitted: number;
  selectedAssessment: string | null;
  startedAtEpochMs: number;
  updatedAtEpochMs: number;
}

export interface ReviewActionKeyRow {
  actionKey: string;
  sessionId: string;
  currentIndex: number;
  createdAtEpochMs: number;
}

export interface ScenarioSessionRow {
  id: string;
  scenarioId: string;
  scenarioContentHash: string;
  status: string;
  currentPairId: string | null;
  currentPairIndex: number;
  pairCount: number;
  practiceMode: string;
  queuePairIdsJson: string;
  startedAtEpochMs: number;
  completedAtEpochMs: number | null;
  updatedAtEpochMs: number;
}

export interface ScenarioProgressRow {
  sessionId: string;
  pairId: string;
  customerAudioCompleted: number;
  customerTextRevealed: number;
  keywordsRevealed: number;
  answerRevealed: number;
  selfRating: string | null;
  updatedAtEpochMs: number;
}

export interface StudyTaskRow {
  dateEpochDay: number;
  newWordTarget: number;
  newWordDone: number;
  reviewTarget: number;
  reviewDone: number;
  recommendedScenarioId: string | null;
  studySeconds: number;
  completed: number;
  updatedAtEpochMs: number;
}

export interface ArticleProgressRow {
  articleId: string;
  lastPositionMs: number;
  listenCount: number;
  completedAtEpochMs: number | null;
  updatedAtEpochMs: number;
}

export interface SettingsRow {
  id: number;
  json: string;
}

export interface AudioBlobRow {
  key: string;
  mimeType: string;
  blob: Blob;
}

export class BessDatabase extends Dexie {
  meta!: Table<MetaRow, string>;
  vocabulary!: Table<VocabularyEntryRow, string>;
  phrases!: Table<PhraseRow, string>;
  examples!: Table<ExampleRow, string>;
  scenarios!: Table<ScenarioRow, string>;
  dialogueTurns!: Table<DialogueTurnRow, string>;
  dialoguePairs!: Table<DialoguePairRow, string>;
  pairWords!: Table<PairWordRow, [string, string]>;
  pairPhrases!: Table<PairPhraseRow, [string, string]>;
  audioAssets!: Table<AudioAssetRow, string>;
  audioFileIndex!: Table<AudioFileIndexRow, string>;
  articles!: Table<ArticleRow, string>;
  wordMemory!: Table<WordMemoryRow, string>;
  itemMemory!: Table<ItemMemoryRow, [string, string]>;
  reviewLogs!: Table<ReviewLogRow, string>;
  vocabCheckpoints!: Table<VocabCheckpointRow, string>;
  reviewActionKeys!: Table<ReviewActionKeyRow, string>;
  scenarioSessions!: Table<ScenarioSessionRow, string>;
  scenarioProgress!: Table<ScenarioProgressRow, [string, string]>;
  studyTasks!: Table<StudyTaskRow, number>;
  articleProgress!: Table<ArticleProgressRow, string>;
  settings!: Table<SettingsRow, number>;
  audioBlobs!: Table<AudioBlobRow, string>;
  corpusImportEvents!: Table<CorpusImportEventRow, string>;

  constructor() {
    super('BessSalesTrainer');
    this.version(1).stores({
      meta: 'key',
      vocabulary: 'id, normalizedTerm, topic, cefrLevel, active',
      phrases: 'id, scene, category, active',
      scenarios: 'id, topic, salesStage, difficulty, active',
      dialogueTurns: 'id, scenarioId, [scenarioId+turnNo]',
      dialoguePairs: 'id, scenarioId, [scenarioId+pairIndex]',
      pairWords: '[pairId+wordId], pairId, wordId',
      pairPhrases: '[pairId+phraseId], pairId, phraseId',
      audioAssets: 'id',
      audioFileIndex: 'assetId, source',
      articles: 'id, topic, source',
      wordMemory: 'wordId, dueAtEpochMs, isFavorite',
      itemMemory: '[itemId+itemType], dueAtEpochMs, itemType',
      reviewLogs: 'id, wordId, reviewedAtEpochMs',
      vocabCheckpoints: 'sessionId, status, updatedAtEpochMs',
      reviewActionKeys: 'actionKey, sessionId',
      scenarioSessions: 'id, scenarioId, status, updatedAtEpochMs',
      scenarioProgress: '[sessionId+pairId], sessionId',
      studyTasks: 'dateEpochDay',
      articleProgress: 'articleId',
      settings: 'id',
      audioBlobs: 'key',
    });
    this.version(DATABASE_VERSION)
      .stores({
        meta: 'key',
        vocabulary: 'id, normalizedTerm, topic, cefrLevel, active',
        phrases: 'id, scene, category, active',
        examples: 'id, industry, scene, speaker, dialogueGroupId, active',
        scenarios: 'id, topic, salesStage, difficulty, active',
        dialogueTurns: 'id, scenarioId, [scenarioId+turnNo]',
        dialoguePairs: 'id, scenarioId, [scenarioId+pairIndex]',
        pairWords: '[pairId+wordId], pairId, wordId',
        pairPhrases: '[pairId+phraseId], pairId, phraseId',
        audioAssets: 'id',
        audioFileIndex: 'assetId, source',
        articles: 'id, topic, source',
        wordMemory: 'wordId, dueAtEpochMs, isFavorite',
        itemMemory: '[itemId+itemType], dueAtEpochMs, itemType, isFavorite',
        reviewLogs: 'id, wordId, reviewedAtEpochMs',
        vocabCheckpoints: 'sessionId, status, updatedAtEpochMs',
        reviewActionKeys: 'actionKey, sessionId',
        scenarioSessions: 'id, scenarioId, status, updatedAtEpochMs',
        scenarioProgress: '[sessionId+pairId], sessionId',
        studyTasks: 'dateEpochDay',
        articleProgress: 'articleId',
        settings: 'id',
        audioBlobs: 'key',
        corpusImportEvents: 'id, kind, createdAtEpochMs',
      })
      .upgrade(async (tx) => {
        // v1 -> v2: add isFavorite to existing itemMemory rows (default 0)
        await tx
          .table('itemMemory')
          .toCollection()
          .modify((row: { isFavorite?: number }) => {
            if (row.isFavorite === undefined) row.isFavorite = 0;
          });
      });
  }
}

export const db = new BessDatabase();

export async function getMeta(key: string): Promise<string | null> {
  const row = await db.meta.get(key);
  return row?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await db.meta.put({ key, value });
}
