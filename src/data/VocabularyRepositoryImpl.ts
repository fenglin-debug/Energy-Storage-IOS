import {
  FsrsState,
  QuestionMode,
  Rating,
  VocabularyAssessment,
  type SessionExample,
  type Vocabulary,
  type VocabularyQueue,
  type VocabularySessionView,
} from '@/domain/Models';
import type { VocabularyRepository } from '@/domain/Repositories';
import { FsrsScheduler, type FsrsCard } from '@/domain/Fsrs';
import { db, type VocabCheckpointRow, type WordMemoryRow } from './Database';
import type { SettingsRepositoryImpl } from './SettingsRepositoryImpl';
import { getMeta } from './Database';

interface MemoryRow {
  wordId: string;
  state: string;
  difficulty: number;
  stability: number;
  due: number;
  lastReview: number | null;
  reps: number;
  lapses: number;
  mastered: boolean;
  favorite: boolean;
}

export class VocabularyRepositoryImpl implements VocabularyRepository {
  private readonly scheduler = new FsrsScheduler();

  constructor(private readonly settings: SettingsRepositoryImpl) {}

  async list(query: string, favoritesOnly: boolean): Promise<Vocabulary[]> {
    const q = query.trim().toLowerCase();
    let rows = await db.vocabulary.where('active').equals(1).toArray();
    if (q) {
      rows = rows.filter(
        (v) =>
          v.term.toLowerCase().includes(q) ||
          v.chineseGloss.toLowerCase().includes(q) ||
          v.normalizedTerm.includes(q),
      );
    }
    const mem = await db.wordMemory.toArray();
    const fav = new Map(mem.map((m) => [m.wordId, m.isFavorite === 1]));
    let result = rows.map((v) => this.mapVocab(v, fav.get(v.id) ?? false));
    if (favoritesOnly) result = result.filter((v) => v.favorite);
    return result.sort((a, b) => a.id.localeCompare(b.id));
  }

  async todayQueue(): Promise<VocabularyQueue> {
    const target = (await this.settings.get()).dailyNewWordTarget;
    const now = Date.now();
    const words = await db.vocabulary.where('active').equals(1).toArray();
    const wordIds = new Set(words.map((w) => w.id));
    const memories = await db.wordMemory.toArray();
    const memById = new Map(memories.map((m) => [m.wordId, m]));

    let due = 0;
    let fresh = 0;
    for (const id of wordIds) {
      const m = memById.get(id);
      if (!m || (m.reps === 0 && m.masteredUi === 0)) fresh += 1;
      else if (m.masteredUi === 0 && m.reps > 0 && m.dueAtEpochMs <= now) due += 1;
    }

    const phrases = await db.phrases.where('active').equals(1).toArray();
    const itemMem = await db.itemMemory.where('itemType').equals('PHRASE').toArray();
    const phraseMem = new Map(itemMem.map((m) => [m.itemId, m]));
    let duePhrases = 0;
    let freshPhrases = 0;
    for (const p of phrases) {
      const m = phraseMem.get(p.id);
      if (!m) freshPhrases += 1;
      else if (m.masteredUi === 0 && m.reps > 0 && m.dueAtEpochMs <= now) duePhrases += 1;
    }

    const newCount = Math.min(target, fresh + freshPhrases);
    const reviewCount = due + duePhrases;
    return { newCount, reviewCount, totalCount: newCount + reviewCount };
  }

  async startOrResumeSession(): Promise<string> {
    const existing = await db.vocabCheckpoints
      .where('status')
      .equals('IN_PROGRESS')
      .reverse()
      .sortBy('updatedAtEpochMs');
    if (existing.length > 0) return existing[existing.length - 1]!.sessionId;

    const now = Date.now();
    const target = (await this.settings.get()).dailyNewWordTarget;
    const words = await db.vocabulary.where('active').equals(1).sortBy('id');
    const phrases = await db.phrases.where('active').equals(1).sortBy('id');
    const memories = await db.wordMemory.toArray();
    const memById = new Map(memories.map((m) => [m.wordId, m]));
    const itemMem = await db.itemMemory.where('itemType').equals('PHRASE').toArray();
    const phraseMem = new Map(itemMem.map((m) => [m.itemId, m]));

    const due: string[] = [];
    const freshWords: string[] = [];
    for (const w of words) {
      const m = memById.get(w.id);
      if (!m || (m.reps === 0 && m.masteredUi === 0)) freshWords.push(w.id);
      else if (m.masteredUi === 0 && m.reps > 0 && m.dueAtEpochMs <= now) due.push(w.id);
    }
    due.sort((a, b) => (memById.get(a)!.dueAtEpochMs - memById.get(b)!.dueAtEpochMs) || a.localeCompare(b));

    const duePhrases: string[] = [];
    const freshPhrases: string[] = [];
    for (const p of phrases) {
      const m = phraseMem.get(p.id);
      if (!m) freshPhrases.push(p.id);
      else if (m.masteredUi === 0 && m.reps > 0 && m.dueAtEpochMs <= now) duePhrases.push(p.id);
    }
    duePhrases.sort(
      (a, b) =>
        (phraseMem.get(a)!.dueAtEpochMs - phraseMem.get(b)!.dueAtEpochMs) || a.localeCompare(b),
    );

    const fresh = [...freshWords, ...freshPhrases].sort().slice(0, target);
    const dueSet = new Set([...due, ...duePhrases]);
    const queue = [...due, ...duePhrases, ...fresh.filter((id) => !dueSet.has(id))];
    if (queue.length === 0) throw new Error('NO_VOCABULARY_DUE');

    const firstMemory = await this.memory(queue[0]!);
    const sessionId = this.id('vocab');
    const corpusVersion = (await getMeta('active_corpus_content_version')) ?? 'none';
    const row: VocabCheckpointRow = {
      sessionId,
      status: 'IN_PROGRESS',
      corpusVersion,
      queueWordIdsJson: JSON.stringify(queue),
      currentIndex: 0,
      questionMode: this.modeFor(firstMemory),
      answerRevealed: 0,
      hintRevealed: 0,
      assessmentSubmitted: 0,
      selectedAssessment: null,
      startedAtEpochMs: now,
      updatedAtEpochMs: now,
    };
    await db.vocabCheckpoints.put(row);
    return sessionId;
  }

  async session(sessionId: string): Promise<VocabularySessionView> {
    const cp = await db.vocabCheckpoints.get(sessionId);
    if (!cp) throw new Error('SESSION_NOT_FOUND');
    const queue = JSON.parse(cp.queueWordIdsJson) as string[];
    const wordId = queue[cp.currentIndex];
    const word = wordId === undefined ? null : await this.word(wordId);
    return {
      sessionId: cp.sessionId,
      status: cp.status,
      currentIndex: cp.currentIndex,
      totalCount: queue.length,
      questionMode: cp.questionMode as QuestionMode,
      word,
      answerRevealed: cp.answerRevealed === 1,
      hintRevealed: cp.hintRevealed === 1,
      assessmentSubmitted: cp.assessmentSubmitted === 1,
      selectedAssessment: cp.selectedAssessment,
      examples: wordId === undefined ? [] : await this.examplesFor(wordId),
    };
  }

  /** 词卡下方的例句卡(0..n 条): 由 db.examples 按 linkedTermIdsJson 关联组装 */
  private async examplesFor(wordId: string): Promise<SessionExample[]> {
    const rows = await db.examples.where('active').equals(1).toArray();
    return rows
      .filter((r) => {
        try {
          return (JSON.parse(r.linkedTermIdsJson) as string[]).includes(wordId);
        } catch {
          return false;
        }
      })
      .map((r) => ({
        textEn: r.textEn,
        textZh: r.textZh,
        audioAssetId: r.audioAssetId,
      }));
  }

  async revealAnswer(sessionId: string): Promise<void> {
    const cp = await db.vocabCheckpoints.get(sessionId);
    if (!cp || cp.status !== 'IN_PROGRESS') return;
    await db.vocabCheckpoints.update(sessionId, {
      answerRevealed: 1,
      updatedAtEpochMs: Date.now(),
    });
  }

  async revealHint(sessionId: string): Promise<void> {
    const cp = await db.vocabCheckpoints.get(sessionId);
    if (!cp || cp.status !== 'IN_PROGRESS') return;
    await db.vocabCheckpoints.update(sessionId, {
      hintRevealed: 1,
      updatedAtEpochMs: Date.now(),
    });
  }

  /**
   * 三选自评 (对齐 Android 两步流程第一步: submit)。
   * 记录记忆并标记已选择, 不推进; 由 advanceToNext 推进。
   */
  async submitAssessment(sessionId: string, assessment: VocabularyAssessment): Promise<void> {
    const rating =
      assessment === VocabularyAssessment.UNFAMILIAR
        ? Rating.AGAIN
        : assessment === VocabularyAssessment.FUZZY
          ? Rating.HARD
          : Rating.EASY;
    await this.recordAssessment(sessionId, rating, assessment);
  }

  async submitRating(sessionId: string, rating: Rating): Promise<void> {
    // 兼容保留: 直接记录并推进 (旧四档评分流程, UI 不再使用)
    await this.recordAssessment(sessionId, rating, null);
    await this.advanceToNext(sessionId);
  }

  async setFavorite(wordId: string, favorite: boolean): Promise<void> {
    if (this.isPhrase(wordId)) throw new Error('PHRASES_CANNOT_BE_FAVORITED');
    const now = Date.now();
    const contentHash = await this.contentHash(wordId);
    const existing = await db.wordMemory.get(wordId);
    if (existing) {
      await db.wordMemory.update(wordId, { isFavorite: favorite ? 1 : 0, updatedAtEpochMs: now });
    } else {
      await db.wordMemory.put({
        wordId,
        fsrsState: FsrsState.NEW,
        difficulty: 0,
        stability: 0,
        dueAtEpochMs: Number.MAX_SAFE_INTEGER,
        lastReviewAtEpochMs: null,
        reps: 0,
        lapses: 0,
        masteredUi: 0,
        lastQuestionMode: null,
        isFavorite: favorite ? 1 : 0,
        learnedContentHash: contentHash,
        legacyNormalizedTerm: null,
        updatedAtEpochMs: now,
      });
    }
  }

  questionPrompt(mode: QuestionMode, word: Vocabulary): string {
    if (mode === QuestionMode.ZH2EN) return word.chineseGloss;
    if (mode === QuestionMode.LISTENING) return '听音频，说出词义与用法';
    if (mode === QuestionMode.TRANSFER) return `请用 ${word.term} 回答一个储能销售场景问题`;
    if (mode === QuestionMode.EN2ZH) return word.term;
    return `${word.term}  ${word.ipa}`;
  }

  private async recordAssessment(
    sessionId: string,
    rating: Rating,
    assessment: VocabularyAssessment | null,
  ): Promise<void> {
    await db.transaction(
      'rw',
      [
        db.vocabCheckpoints,
        db.reviewActionKeys,
        db.reviewLogs,
        db.wordMemory,
        db.itemMemory,
        db.studyTasks,
        db.vocabulary,
        db.phrases,
        db.settings, // incrementDaily 在事务内读取设置, 必须纳入事务表
      ],
      async () => {
        const cp = await db.vocabCheckpoints.get(sessionId);
        if (!cp || cp.status !== 'IN_PROGRESS') throw new Error('SESSION_NOT_ACTIVE');
        const queue = JSON.parse(cp.queueWordIdsJson) as string[];
        const wordId = queue[cp.currentIndex];
        if (wordId === undefined) throw new Error('STALE_SESSION');

        const key = `${sessionId}:${cp.currentIndex}`;
        if (await db.reviewActionKeys.get(key)) return;

        const now = Date.now();
        const old = await this.memory(wordId);
        const stateBefore =
          old === null || old.state === 'NEW' ? FsrsState.NEW : (old.state as FsrsState);
        const card: FsrsCard =
          old === null || old.state === 'NEW'
            ? {
                state: FsrsState.NEW,
                step: null,
                stability: null,
                difficulty: null,
                dueAtEpochMs: now,
                lastReviewAtEpochMs: null,
              }
            : {
                state: old.state as FsrsState,
                step:
                  old.state === FsrsState.LEARNING || old.state === FsrsState.RELEARNING ? 0 : null,
                stability: old.stability,
                difficulty: old.difficulty,
                dueAtEpochMs: old.due,
                lastReviewAtEpochMs: old.lastReview,
              };
        const reviewed = this.scheduler.review(card, rating, now);
        const mastered = assessment === VocabularyAssessment.MASTERED;
        const due = mastered ? Number.MAX_SAFE_INTEGER : reviewed.dueAtEpochMs;
        const reps = (old?.reps ?? 0) + 1;
        const lapses = (old?.lapses ?? 0) + (rating === Rating.AGAIN ? 1 : 0);
        const hash = await this.contentHash(wordId);

        await db.reviewActionKeys.put({
          actionKey: key,
          sessionId,
          currentIndex: cp.currentIndex,
          createdAtEpochMs: now,
        });
        await db.reviewLogs.put({
          id: this.id('review'),
          wordId,
          rating,
          questionMode: 'SELF_ASSESSMENT',
          usedHint: cp.hintRevealed,
          revealedAnswer: 1,
          reviewedAtEpochMs: now,
          responseTimeMs: null,
          scheduledDays: Math.max(0, Math.floor((due - now) / 86400000)),
          elapsedDays:
            old?.lastReview == null
              ? 0
              : Math.max(0, Math.floor((now - old.lastReview) / 86400000)),
          stateBefore,
          stateAfter: reviewed.state,
        });

        if (this.isPhrase(wordId)) {
          await db.itemMemory.put({
            itemId: wordId,
            itemType: 'PHRASE',
            fsrsState: reviewed.state,
            difficulty: reviewed.difficulty ?? 0,
            stability: reviewed.stability ?? 0,
            dueAtEpochMs: due,
            lastReviewAtEpochMs: now,
            reps,
            lapses,
            masteredUi: mastered ? 1 : old?.mastered ? 1 : 0,
            learnedContentHash: hash,
            updatedAtEpochMs: now,
            isFavorite: 0,
          });
        } else {
          await db.wordMemory.put({
            wordId,
            fsrsState: reviewed.state,
            difficulty: reviewed.difficulty ?? 0,
            stability: reviewed.stability ?? 0,
            dueAtEpochMs: due,
            lastReviewAtEpochMs: now,
            reps,
            lapses,
            masteredUi: mastered ? 1 : old?.mastered ? 1 : 0,
            lastQuestionMode: cp.questionMode,
            isFavorite: old?.favorite ? 1 : 0,
            learnedContentHash: hash,
            legacyNormalizedTerm: null,
            updatedAtEpochMs: now,
          });
        }

        // 第一步: 只标记已选择, 不推进 (对齐 Android submit)
        await db.vocabCheckpoints.update(sessionId, {
          assessmentSubmitted: 1,
          selectedAssessment: assessment,
          updatedAtEpochMs: now,
        });
        await this.incrementDaily(old === null, now);
      },
    );
  }

  /** 第二步: 推进到下一条 / 完成本次学习 (对齐 Android advanceToNext) */
  async advanceToNext(sessionId: string): Promise<void> {
    await db.transaction('rw', [db.vocabCheckpoints, db.wordMemory, db.itemMemory], async () => {
      const cp = await db.vocabCheckpoints.get(sessionId);
      if (!cp || cp.status !== 'IN_PROGRESS') return;
      if (cp.assessmentSubmitted !== 1) throw new Error('ASSESSMENT_NOT_SUBMITTED');
      const queue = JSON.parse(cp.queueWordIdsJson) as string[];
      const nextIndex = cp.currentIndex + 1;
      const completed = nextIndex >= queue.length;
      const now = Date.now();
      const nextMemory = completed ? null : await this.memory(queue[nextIndex]!);
      await db.vocabCheckpoints.update(sessionId, {
        status: completed ? 'COMPLETED' : 'IN_PROGRESS',
        currentIndex: nextIndex,
        questionMode: completed ? cp.questionMode : this.modeFor(nextMemory),
        answerRevealed: 0,
        hintRevealed: 0,
        assessmentSubmitted: 0,
        selectedAssessment: null,
        updatedAtEpochMs: now,
      });
    });
  }

  private async incrementDaily(isNew: boolean, now: number): Promise<void> {
    const date = new Date(now);
    const epochDay = Math.floor(
      Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86400000,
    );
    const target = (await this.settings.get()).dailyNewWordTarget;
    const existing = await db.studyTasks.get(epochDay);
    if (!existing) {
      await db.studyTasks.put({
        dateEpochDay: epochDay,
        newWordTarget: target,
        newWordDone: isNew ? 1 : 0,
        reviewTarget: 0,
        reviewDone: isNew ? 0 : 1,
        recommendedScenarioId: null,
        studySeconds: 0,
        completed: 0,
        updatedAtEpochMs: now,
      });
    } else {
      await db.studyTasks.update(epochDay, {
        newWordDone: existing.newWordDone + (isNew ? 1 : 0),
        reviewDone: existing.reviewDone + (isNew ? 0 : 1),
        updatedAtEpochMs: now,
      });
    }
  }

  private modeFor(memory: MemoryRow | null): QuestionMode {
    if (memory === null || memory.state === FsrsState.NEW) return QuestionMode.INTRODUCE;
    if (memory.state === FsrsState.LEARNING || memory.state === FsrsState.RELEARNING) {
      return memory.reps % 2 === 0 ? QuestionMode.EN2ZH : QuestionMode.ZH2EN;
    }
    return memory.reps % 3 === 0
      ? QuestionMode.LISTENING
      : memory.reps % 3 === 1
        ? QuestionMode.TRANSFER
        : QuestionMode.EN2ZH;
  }

  private async word(id: string): Promise<Vocabulary | null> {
    if (this.isPhrase(id)) {
      const p = await db.phrases.get(id);
      if (!p || !p.active) return null;
      return {
        id: p.id,
        term: p.textEn,
        normalizedTerm: p.textEn.toLowerCase(),
        ipa: '',
        partOfSpeech: 'phrase',
        chineseGloss: p.textZh,
        englishDefinition: null,
        collocations: [],
        exampleSentenceEn: p.textEn,
        exampleSentenceZh: p.textZh,
        commonMistakes: '',
        topic: p.scene,
        scenarioTags: [],
        cefrLevel: 'B1',
        wordAudioAssetId: p.audioAssetId,
        exampleAudioAssetId: p.audioAssetId,
        contentHash: p.contentHash,
        favorite: false,
      };
    }
    const v = await db.vocabulary.get(id);
    if (!v || !v.active) return null;
    const m = await db.wordMemory.get(id);
    return this.mapVocab(v, m?.isFavorite === 1);
  }

  private mapVocab(
    v: {
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
      contentHash: string;
    },
    favorite: boolean,
  ): Vocabulary {
    return {
      id: v.id,
      term: v.term,
      normalizedTerm: v.normalizedTerm,
      ipa: v.ipa,
      partOfSpeech: v.partOfSpeech,
      chineseGloss: v.chineseGloss,
      englishDefinition: v.englishDefinition,
      collocations: JSON.parse(v.collocationsJson) as string[],
      exampleSentenceEn: v.exampleSentenceEn,
      exampleSentenceZh: v.exampleSentenceZh,
      commonMistakes: v.commonMistakes,
      topic: v.topic,
      scenarioTags: JSON.parse(v.scenarioTagsJson) as string[],
      cefrLevel: v.cefrLevel,
      wordAudioAssetId: v.wordAudioAssetId,
      exampleAudioAssetId: v.exampleAudioAssetId,
      contentHash: v.contentHash,
      favorite,
    };
  }

  private async memory(id: string): Promise<MemoryRow | null> {
    if (this.isPhrase(id)) {
      const m = await db.itemMemory.get([id, 'PHRASE']);
      if (!m) return null;
      return {
        wordId: id,
        state: m.fsrsState,
        difficulty: m.difficulty,
        stability: m.stability,
        due: m.dueAtEpochMs,
        lastReview: m.lastReviewAtEpochMs,
        reps: m.reps,
        lapses: m.lapses,
        mastered: m.masteredUi === 1,
        favorite: false,
      };
    }
    const m: WordMemoryRow | undefined = await db.wordMemory.get(id);
    if (!m) return null;
    return {
      wordId: m.wordId,
      state: m.fsrsState,
      difficulty: m.difficulty,
      stability: m.stability,
      due: m.dueAtEpochMs,
      lastReview: m.lastReviewAtEpochMs,
      reps: m.reps,
      lapses: m.lapses,
      mastered: m.masteredUi === 1,
      favorite: m.isFavorite === 1,
    };
  }

  private async contentHash(wordId: string): Promise<string | null> {
    if (this.isPhrase(wordId)) {
      const p = await db.phrases.get(wordId);
      return p?.contentHash ?? null;
    }
    const v = await db.vocabulary.get(wordId);
    return v?.contentHash ?? null;
  }

  private id(prefix: string): string {
    return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
  }

  private isPhrase(id: string): boolean {
    return id.startsWith('PHR-');
  }
}
