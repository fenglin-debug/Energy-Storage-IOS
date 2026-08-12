export enum Rating {
  AGAIN = 'AGAIN',
  HARD = 'HARD',
  GOOD = 'GOOD',
  EASY = 'EASY',
}

export enum FsrsState {
  NEW = 'NEW',
  LEARNING = 'LEARNING',
  REVIEW = 'REVIEW',
  RELEARNING = 'RELEARNING',
}

export enum QuestionMode {
  INTRODUCE = 'INTRODUCE',
  EN2ZH = 'EN2ZH',
  ZH2EN = 'ZH2EN',
  LISTENING = 'LISTENING',
  TRANSFER = 'TRANSFER',
}

export enum VocabularyAssessment {
  UNFAMILIAR = 'UNFAMILIAR',
  FUZZY = 'FUZZY',
  MASTERED = 'MASTERED',
}

export enum DialogueSelfRating {
  CANNOT_ANSWER = 'CANNOT_ANSWER',
  BASIC = 'BASIC',
  FLUENT = 'FLUENT',
}

export interface Vocabulary {
  id: string;
  term: string;
  normalizedTerm: string;
  ipa: string;
  partOfSpeech: string;
  chineseGloss: string;
  englishDefinition: string | null;
  collocations: string[];
  exampleSentenceEn: string;
  exampleSentenceZh: string | null;
  commonMistakes: string;
  topic: string;
  scenarioTags: string[];
  cefrLevel: string;
  wordAudioAssetId: string;
  exampleAudioAssetId: string;
  contentHash: string;
  favorite: boolean;
}

export interface VocabularyQueue {
  newCount: number;
  reviewCount: number;
  totalCount: number;
}

/** 一条例句(词卡下方的例句卡; 由 db.examples 按词关联组装) */
export interface SessionExample {
  textEn: string;
  textZh: string | null;
  audioAssetId: string;
}

export interface VocabularySessionView {
  sessionId: string;
  status: string;
  currentIndex: number;
  totalCount: number;
  questionMode: QuestionMode;
  word: Vocabulary | null;
  answerRevealed: boolean;
  hintRevealed: boolean;
  assessmentSubmitted: boolean;
  selectedAssessment: string | null;
  examples: SessionExample[];
}

export interface ScenarioFilter {
  onlyIncomplete: boolean;
  difficulty: string | null;
}

export type ScenarioStatus = 'IN_PROGRESS' | 'COMPLETED';

export interface ScenarioSummary {
  id: string;
  title: string;
  topic: string;
  salesStage: string;
  customerRole: string;
  difficulty: string;
  projectType: string;
  estimatedMinutes: number;
  description: string | null;
  pairCount: number;
  /** 该场景内到期复习的对数 (itemMemory PAIR due) */
  duePairCount: number;
  /** 进行中的会话优先; 其次已完成; 否则 null(未开始) */
  status: ScenarioStatus | null;
  /** 历次练习自评计数 (DialogueSelfRating -> count), 用于完成页统计 */
  ratingSummary: Partial<Record<DialogueSelfRating, number>>;
}

export interface ScoringPointDetail {
  id: string;
  type: string;
  descriptionZh: string;
  keywordsEn: string;
  required: boolean;
  weight: number;
}

export interface ScenarioUnitView {
  sessionId: string;
  scenarioTitle: string;
  pairId: string;
  pairIndex: number;
  pairCount: number;
  customerTextEn: string;
  customerTextZh: string | null;
  customerAudioAssetId: string | null;
  /** 关键词卡: "english ipa 中文" 列表 (由关联词汇组装) */
  keywords: string[];
  referenceCoreEn: string;
  referenceChineseHint: string;
  formalAlternatives: string[];
  scoringPointDetails: ScoringPointDetail[];
  riskNote: string | null;
  customerAudioCompleted: boolean;
  customerTextRevealed: boolean;
  keywordsRevealed: boolean;
  answerRevealed: boolean;
  selfRating: string | null;
}

export interface ArticleParagraph {
  textEn: string;
  textZh: string;
  startMs: number | null;
  endMs: number | null;
}

export interface Article {
  id: string;
  title: string;
  titleZh: string;
  topic: string;
  paragraphs: ArticleParagraph[];
  audioAssetId: string;
  durationMs: number;
  source: string;
  contentScope: string;
  contentHash: string;
  lastPositionMs: number;
  completed: boolean;
}

export interface AppSettings {
  playbackSpeed: number;
  dailyNewWordTarget: number;
  /** 每日情景对话任务数(随机练习每次生成的对数) */
  dailyScenarioTaskCount: number;
  /** 每日文章任务数 */
  dailyArticleTaskCount: number;
  autoPlayCustomerAudio: boolean;
  autoPlayVocabularyAudio: boolean;
  dailyReminderEnabled: boolean;
  dailyReminderHour: number;
  dailyReminderMinute: number;
  lastBackupAtEpochMs: number | null;
}

export const DEFAULT_SETTINGS: AppSettings = {
  playbackSpeed: 1.0,
  dailyNewWordTarget: 15,
  dailyScenarioTaskCount: 3,
  dailyArticleTaskCount: 1,
  autoPlayCustomerAudio: true,
  autoPlayVocabularyAudio: true,
  dailyReminderEnabled: false,
  dailyReminderHour: 20,
  dailyReminderMinute: 0,
  lastBackupAtEpochMs: null,
};

export type AudioPlaybackState =
  | 'IDLE'
  | 'BUFFERING'
  | 'PLAYING'
  | 'PAUSED'
  | 'COMPLETED'
  | 'FAILED';

export interface Sentence {
  id: string;
  industry: string;
  scene: string;
  speaker: string;
  textEn: string;
  textZh: string;
  linkedTermIds: string[];
  dialogueGroupId: string | null;
  audioAssetId: string;
  contentHash: string;
  favorite: boolean;
}

export interface CorpusPreviewCounts {
  vocabulary: number;
  phrases: number;
  examples: number;
  scenarios: number;
  dialogueTurns: number;
  dialoguePairs: number;
  audioAssets: number;
}

export interface CorpusImportPreview {
  previewId: string;
  packageKey: string;
  contentVersion: string;
  schemaVersion: number;
  counts: CorpusPreviewCounts;
  totalSizeBytes: number;
  audioCount: number;
  activeContentVersion: string | null;
  replacesActive: boolean;
  activeSessionImpact: {
    vocabularySessions: number;
    scenarioSessions: number;
  };
}

export type CorpusImportEventAction =
  | 'ACTIVATED'
  | 'ROLLED_BACK'
  | 'FAILED'
  | 'RESTORED';

export interface CorpusImportEvent {
  id: string;
  kind: 'CORPUS' | 'ARTICLE';
  action: CorpusImportEventAction;
  packageKey: string | null;
  contentVersion: string | null;
  createdAtEpochMs: number;
  detail: string | null;
}

export interface TodayStudyTask {
  dateEpochDay: number;
  newWordTarget: number;
  newWordDone: number;
  reviewTarget: number;
  reviewDone: number;
  recommendedScenarioId: string | null;
  studySeconds: number;
  completed: boolean;
}

export interface ResumeTarget {
  kind: 'vocabulary' | 'scenario' | 'article';
  id: string;
  title: string;
  subtitle: string;
  updatedAtEpochMs: number;
}

export interface HomeDashboard {
  today: TodayStudyTask | null;
  streakDays: number;
  weekActivity: boolean[];
  totalStudySeconds: number;
  dueCount: number;
  resume: ResumeTarget[];
  recommendedScenarioId: string | null;
  corpusContentVersion: string | null;
}

export interface PlaybackSnapshot {
  assetId: string | null;
  state: AudioPlaybackState;
  positionMs: number;
  durationMs: number;
  speed: number;
  errorCode: string | null;
}

export interface OperationResult {
  ok: boolean;
  errorCode: string | null;
  message: string;
}

export interface LearningBackupCounts {
  wordMemoryStates: number;
  reviewLogs: number;
  vocabularyCheckpoints: number;
  reviewActionKeys: number;
  scenarioSessions: number;
  scenarioTurnProgress: number;
  studyTasks: number;
  itemMemoryStates: number;
  articleProgress: number;
}

export interface LearningBackupInspection {
  previewId: string;
  createdAtEpochMs: number;
  appVersionName: string;
  appVersionCode: number;
  databaseVersion: number;
  corpusPackageKey: string | null;
  corpusContentVersion: string | null;
  corpusMatches: boolean;
  encrypted: boolean;
  counts: LearningBackupCounts;
}

export interface AppSupportInfo {
  appVersionName: string;
  appVersionCode: number;
  databaseVersion: number;
  corpusPackageKey: string | null;
  corpusContentVersion: string | null;
  recordCounts: LearningBackupCounts;
  lastBackupAtEpochMs: number | null;
  lastErrorCode: string | null;
  storageEstimate: string | null;
  storagePersisted: boolean;
  swVersion: string | null;
}

// 显示版本；内部构建标识见 package.json。DATABASE_VERSION 不随应用版本
// 变动——只有真正需要改库结构时才递增，以保护用户已存在的学习进度。
export const APP_VERSION_NAME = '0.3.1';
export const APP_VERSION_CODE = 3;
export const DATABASE_VERSION = 2;

export type StartupPhase =
  | 'idle'
  | 'opening-db'
  | 'checking-storage'
  | 'downloading-corpus'
  | 'loading-corpus'
  | 'loading-articles'
  | 'needs-install'
  | 'ready'
  | 'error';

export interface StartupState {
  phase: StartupPhase;
  progress: number;
  message: string;
  error: string | null;
}
