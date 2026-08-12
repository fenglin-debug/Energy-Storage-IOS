import type {
  AppSettings,
  AppSupportInfo,
  Article,
  CorpusImportEvent,
  CorpusImportPreview,
  DialogueSelfRating,
  HomeDashboard,
  LearningBackupInspection,
  OperationResult,
  PlaybackSnapshot,
  QuestionMode,
  Rating,
  ScenarioFilter,
  ScenarioSummary,
  ScenarioUnitView,
  Sentence,
  Vocabulary,
  VocabularyAssessment,
  VocabularyQueue,
  VocabularySessionView,
} from './Models';

export type Unsubscribe = () => void;

export interface VocabularyRepository {
  list(query: string, favoritesOnly: boolean): Promise<Vocabulary[]>;
  todayQueue(): Promise<VocabularyQueue>;
  startOrResumeSession(): Promise<string>;
  session(sessionId: string): Promise<VocabularySessionView>;
  revealAnswer(sessionId: string): Promise<void>;
  revealHint(sessionId: string): Promise<void>;
  /** 三选自评: 记录记忆并标记已选择(不推进) — 对齐 Android submit 两步流程 */
  submitAssessment(sessionId: string, assessment: VocabularyAssessment): Promise<void>;
  /** 推进到下一条 / 完成本次学习 — 对齐 Android advanceToNext */
  advanceToNext(sessionId: string): Promise<void>;
  submitRating(sessionId: string, rating: Rating): Promise<void>;
  setFavorite(wordId: string, favorite: boolean): Promise<void>;
  questionPrompt(mode: QuestionMode, word: Vocabulary): string;
}

export interface ScenarioRepository {
  list(filter: ScenarioFilter): Promise<ScenarioSummary[]>;
  startOrResume(scenarioId: string): Promise<string>;
  startOrResumeRandom(): Promise<string>;
  /** 结束随机练习会话(退出本次练习); 非 RANDOM/已完成时无操作 */
  endRandomSession(sessionId: string): Promise<void>;
  currentUnit(sessionId: string): Promise<ScenarioUnitView | null>;
  markCustomerAudioCompleted(sessionId: string, pairId: string): Promise<void>;
  revealCustomerText(sessionId: string, pairId: string): Promise<void>;
  revealKeywords(sessionId: string, pairId: string): Promise<void>;
  revealReferenceAnswer(sessionId: string, pairId: string): Promise<void>;
  /** 自评并推进; 返回是否完成(队列耗尽)。完成时记录 PAIR 记忆并统计 */
  rateAndAdvance(sessionId: string, pairId: string, rating: DialogueSelfRating): Promise<boolean>;
  /** 某次会话的自评统计 (完成页"流利 X · 基本 Y · 待加强 Z") */
  sessionRatingSummary(
    sessionId: string,
  ): Promise<Partial<Record<DialogueSelfRating, number>>>;
  /** 今日已完成情景对话任务数 */
  todayScenarioDone(): Promise<number>;
  /** 记录一次今日情景任务完成 */
  markScenarioDoneToday(): Promise<void>;
}

export interface ArticleRepository {
  list(): Promise<Article[]>;
  get(articleId: string): Promise<Article | null>;
  randomId(): Promise<string | null>;
  saveProgress(articleId: string, positionMs: number, completed: boolean): Promise<void>;
  /** 今日已完成文章任务数 */
  todayCompletedCount(): Promise<number>;
  /** 记录一篇今日文章任务完成(幂等) */
  markCompletedToday(articleId: string): Promise<void>;
  importPackage(file: File): Promise<OperationResult>;
  deleteImported(articleId: string): Promise<OperationResult>;
  ensureBundledActivated(onProgress?: (p: number, msg: string) => void): Promise<void>;
  activateDownloaded(
    bytes: Uint8Array,
    sha256: string,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult>;
}

export interface CorpusRepository {
  activeVersion(): Promise<string | null>;
  inspectPackage(file: File): Promise<CorpusImportPreview | OperationResult>;
  activatePreview(previewId: string): Promise<OperationResult>;
  discardPreview(previewId: string): Promise<void>;
  activateDownloaded(
    bytes: Uint8Array,
    sha256: string,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult>;
  restoreBundled(onProgress?: (p: number, msg: string) => void): Promise<OperationResult>;
  ensureBundledActivated(onProgress?: (p: number, msg: string) => void): Promise<void>;
  listImportEvents(): Promise<CorpusImportEvent[]>;
}

export interface SentenceRepository {
  list(query: string, favoritesOnly: boolean): Promise<Sentence[]>;
  get(sentenceId: string): Promise<Sentence | null>;
  setFavorite(sentenceId: string, favorite: boolean): Promise<void>;
}

export interface StudyTaskRepository {
  dashboard(): Promise<HomeDashboard>;
  addStudySeconds(seconds: number): Promise<void>;
}

export interface AudioPlaybackRepository {
  snapshot(): PlaybackSnapshot;
  play(assetId: string, speed: number): Promise<void>;
  pause(): Promise<void>;
  resume(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  stop(): Promise<void>;
  subscribe(listener: (snapshot: PlaybackSnapshot) => void): Unsubscribe;
}

export interface SettingsRepository {
  get(): Promise<AppSettings>;
  save(settings: AppSettings): Promise<void>;
}

export interface LearningBackupRepository {
  exportBackup(password?: string): Promise<{ ok: true; blob: Blob; fileName: string } | OperationResult>;
  exportDiagnostics(): Promise<{ ok: true; blob: Blob; fileName: string } | OperationResult>;
  inspectBackup(file: File, password?: string): Promise<LearningBackupInspection | OperationResult>;
  restoreBackup(previewId: string): Promise<OperationResult>;
  discardPreview(previewId: string): Promise<void>;
  getSupportInfo(): Promise<AppSupportInfo>;
}
