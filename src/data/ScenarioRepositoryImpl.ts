import {
  DialogueSelfRating,
  FsrsState,
  Rating,
  type ScenarioFilter,
  type ScenarioSummary,
  type ScenarioUnitView,
  type ScoringPointDetail,
} from '@/domain/Models';
import type { ScenarioRepository } from '@/domain/Repositories';
import { FsrsScheduler, type FsrsCard } from '@/domain/Fsrs';
import { db, getMeta, setMeta, type ScenarioSessionRow } from './Database';
import type { SettingsRepositoryImpl } from './SettingsRepositoryImpl';

interface SessionState {
  id: string;
  scenarioId: string;
  status: string;
  currentPairId: string | null;
  currentPairIndex: number;
  pairCount: number;
  practiceMode: string;
  queue: string[];
}

interface ScoringPointJson {
  id?: string;
  type?: string;
  descriptionZh?: string;
  keywordsEn?: string;
  required?: boolean;
  weight?: number;
}

const RANDOM_SCENARIO_ID = '__RANDOM__';

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export class ScenarioRepositoryImpl implements ScenarioRepository {
  private readonly scheduler = new FsrsScheduler();

  constructor(private readonly settings: SettingsRepositoryImpl) {}

  async list(filter: ScenarioFilter): Promise<ScenarioSummary[]> {
    let scenarios = await db.scenarios.where('active').equals(1).toArray();
    const now = Date.now();

    const sessions = await db.scenarioSessions.toArray();
    const inProgressByScenario = new Map<string, ScenarioSessionRow>();
    const ratingByScenario = new Map<string, Partial<Record<DialogueSelfRating, number>>>();
    for (const s of sessions) {
      if (s.scenarioId === RANDOM_SCENARIO_ID) continue;
      if (s.status === 'IN_PROGRESS' && !inProgressByScenario.has(s.scenarioId)) {
        inProgressByScenario.set(s.scenarioId, s);
      }
      if (s.status === 'COMPLETED') {
        const cur = ratingByScenario.get(s.scenarioId) ?? {};
        const progress = await db.scenarioProgress
          .where('sessionId')
          .equals(s.id)
          .toArray();
        for (const p of progress) {
          if (!p.selfRating) continue;
          const r = p.selfRating as DialogueSelfRating;
          cur[r] = (cur[r] ?? 0) + 1;
        }
        ratingByScenario.set(s.scenarioId, cur);
      }
    }

    const pairMem = await db.itemMemory.where('itemType').equals('PAIR').toArray();
    const dueByPair = new Set(
      pairMem.filter((m) => m.dueAtEpochMs <= now).map((m) => m.itemId),
    );
    const pairs = await db.dialoguePairs.toArray();
    const pairCountByScenario = new Map<string, number>();
    const dueByScenario = new Map<string, number>();
    for (const p of pairs) {
      pairCountByScenario.set(p.scenarioId, (pairCountByScenario.get(p.scenarioId) ?? 0) + 1);
      if (dueByPair.has(p.id)) {
        dueByScenario.set(p.scenarioId, (dueByScenario.get(p.scenarioId) ?? 0) + 1);
      }
    }

    let result = scenarios
      .map((s) => {
        const inProgress = inProgressByScenario.get(s.id);
        const status: ScenarioSummary['status'] = inProgress
          ? 'IN_PROGRESS'
          : (ratingByScenario.get(s.id) ? 'COMPLETED' : null);
        return {
          id: s.id,
          title: s.title,
          topic: s.topic,
          salesStage: s.salesStage,
          customerRole: s.customerRole,
          difficulty: s.difficulty,
          projectType: s.projectType,
          estimatedMinutes: s.estimatedMinutes,
          description: s.description,
          pairCount: pairCountByScenario.get(s.id) ?? 0,
          duePairCount: dueByScenario.get(s.id) ?? 0,
          status,
          ratingSummary: ratingByScenario.get(s.id) ?? {},
        };
      })
      .sort((a, b) => a.id.localeCompare(b.id));

    if (filter.onlyIncomplete) {
      result = result.filter((s) => s.status !== 'COMPLETED');
    }
    if (filter.difficulty) {
      result = result.filter((s) => s.difficulty === filter.difficulty);
    }
    return result;
  }

  async startOrResume(scenarioId: string): Promise<string> {
    const existing = await db.scenarioSessions
      .where('status')
      .equals('IN_PROGRESS')
      .filter((s) => s.scenarioId === scenarioId)
      .toArray();
    existing.sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs);
    if (existing[0]) return existing[0].id;

    const pairs = await db.dialoguePairs
      .where('scenarioId')
      .equals(scenarioId)
      .sortBy('pairIndex');
    if (pairs.length === 0) throw new Error('SCENARIO_EMPTY');
    return this.createSession(scenarioId, pairs.map((p) => p.id), 'SCENARIO');
  }

  async startOrResumeRandom(): Promise<string> {
    const existing = await db.scenarioSessions
      .where('status')
      .equals('IN_PROGRESS')
      .filter((s) => s.practiceMode === 'RANDOM')
      .toArray();
    existing.sort((a, b) => b.updatedAtEpochMs - a.updatedAtEpochMs);
    if (existing[0]) return existing[0].id;

    const active = await db.scenarios.where('active').equals(1).primaryKeys();
    const activeSet = new Set(active);
    let pairs = await db.dialoguePairs.toArray();
    pairs = pairs.filter((p) => activeSet.has(p.scenarioId));
    if (pairs.length === 0) throw new Error('SCENARIO_EMPTY');

    // 每日对话任务配额: 生成 dailyScenarioTaskCount 对(打乱, 薄弱优先)
    const count = (await this.settings.get()).dailyScenarioTaskCount;
    const mem = await db.itemMemory.where('itemType').equals('PAIR').toArray();
    const memByPair = new Map(mem.map((m) => [m.itemId, m]));
    const now = Date.now();
    const priority = pairs
      .filter((pair) => {
        const m = memByPair.get(pair.id);
        return !!m && (m.dueAtEpochMs <= now || m.lapses > 0 || m.fsrsState !== 'REVIEW');
      })
      .sort(() => Math.random() - 0.5);
    const priorityIds = new Set(priority.map((p) => p.id));
    const regular = pairs
      .filter((p) => !priorityIds.has(p.id))
      .sort(() => Math.random() - 0.5);
    const queue = [...priority, ...regular]
      .slice(0, Math.max(1, count))
      .map((p) => p.id);
    return this.createSession(RANDOM_SCENARIO_ID, queue, 'RANDOM');
  }

  async endRandomSession(sessionId: string): Promise<void> {
    const s = await db.scenarioSessions.get(sessionId);
    if (!s || s.practiceMode !== 'RANDOM' || s.status !== 'IN_PROGRESS') return;
    await db.scenarioSessions.update(sessionId, {
      status: 'COMPLETED',
      completedAtEpochMs: Date.now(),
      updatedAtEpochMs: Date.now(),
    });
  }

  async currentUnit(sessionId: string): Promise<ScenarioUnitView | null> {
    const session = await this.loadSession(sessionId);
    if (!session || session.status !== 'IN_PROGRESS') return null;
    const pairId = session.queue[session.currentPairIndex];
    if (!pairId) return null;

    const pair = await db.dialoguePairs.get(pairId);
    if (!pair) return null;
    const turn = await db.dialogueTurns.get(pair.customerTurnId);
    if (!turn) return null;
    const scenario =
      session.scenarioId === RANDOM_SCENARIO_ID
        ? await db.scenarios.get(pair.scenarioId)
        : await db.scenarios.get(session.scenarioId);
    const progress = await db.scenarioProgress.get([sessionId, pairId]);

    // 关键词卡: 仅关联词汇 (english ipa 中文) — 对齐 Android getPairWords
    const pairWords = await db.pairWords.where('pairId').equals(pairId).sortBy('sortOrder');
    const keywords: string[] = [];
    for (const pw of pairWords) {
      const v = await db.vocabulary.get(pw.wordId);
      if (v) keywords.push(`${v.term} ${v.ipa} ${v.chineseGloss}`);
    }

    let points: ScoringPointDetail[] = [];
    try {
      const raw = JSON.parse(pair.scoringPointsJson) as ScoringPointJson[];
      points = raw.map((p) => ({
        id: p.id ?? '',
        type: p.type ?? '',
        descriptionZh: p.descriptionZh ?? '',
        keywordsEn: p.keywordsEn ?? '',
        required: p.required ?? false,
        weight: p.weight ?? 0,
      }));
    } catch {
      /* ignore malformed scoring points */
    }

    return {
      sessionId: session.id,
      scenarioTitle: scenario?.title ?? '随机练习',
      pairId,
      pairIndex: session.currentPairIndex,
      pairCount: session.pairCount,
      customerTextEn: turn.textEn,
      customerTextZh: turn.textZh,
      customerAudioAssetId: turn.audioAssetId,
      keywords,
      referenceCoreEn: pair.referenceCoreEn,
      referenceChineseHint: pair.referenceChineseHint,
      formalAlternatives: this.parseJsonList(pair.formalAlternativesJson),
      scoringPointDetails: points,
      riskNote: pair.riskNote,
      customerAudioCompleted: progress?.customerAudioCompleted === 1,
      customerTextRevealed: progress?.customerTextRevealed === 1,
      keywordsRevealed: progress?.keywordsRevealed === 1,
      answerRevealed: progress?.answerRevealed === 1,
      selfRating: progress?.selfRating ?? null,
    };
  }

  async markCustomerAudioCompleted(sessionId: string, pairId: string): Promise<void> {
    await this.mutateProgress(sessionId, pairId, 'customerAudioCompleted');
  }
  async revealCustomerText(sessionId: string, pairId: string): Promise<void> {
    await this.mutateProgress(sessionId, pairId, 'customerTextRevealed');
  }
  async revealKeywords(sessionId: string, pairId: string): Promise<void> {
    await this.mutateProgress(sessionId, pairId, 'keywordsRevealed');
  }
  async revealReferenceAnswer(sessionId: string, pairId: string): Promise<void> {
    await this.mutateProgress(sessionId, pairId, 'answerRevealed');
  }

  async rateAndAdvance(
    sessionId: string,
    pairId: string,
    rating: DialogueSelfRating,
  ): Promise<boolean> {
    return db.transaction(
      'rw',
      [db.scenarioSessions, db.scenarioProgress, db.itemMemory, db.reviewLogs, db.dialoguePairs],
      async () => {
        const session = await this.loadSession(sessionId);
        if (!session || session.status !== 'IN_PROGRESS') throw new Error('SESSION_NOT_ACTIVE');
        if (session.queue[session.currentPairIndex] !== pairId) {
          throw new Error('STALE_SCENARIO_ACTION');
        }
        const progress = await db.scenarioProgress.get([sessionId, pairId]);
        if (!progress || progress.answerRevealed !== 1) throw new Error('ANSWER_NOT_REVEALED');
        if (progress.selfRating !== null) throw new Error('PAIR_ALREADY_RATED');

        const now = Date.now();
        const pair = await db.dialoguePairs.get(pairId);

        // D3: 自评映射 FSRS (CANNOT->AGAIN, BASIC->HARD, FLUENT->GOOD), itemType=PAIR
        const fsrsRating =
          rating === DialogueSelfRating.CANNOT_ANSWER
            ? Rating.AGAIN
            : rating === DialogueSelfRating.BASIC
              ? Rating.HARD
              : Rating.GOOD;
        const existingMemory = await db.itemMemory.get([pairId, 'PAIR']);
        const card: FsrsCard =
          existingMemory === undefined
            ? {
                state: FsrsState.NEW,
                step: null,
                stability: null,
                difficulty: null,
                dueAtEpochMs: now,
                lastReviewAtEpochMs: null,
              }
            : {
                state: (existingMemory.fsrsState as FsrsState) ?? FsrsState.NEW,
                step:
                  existingMemory.fsrsState === FsrsState.LEARNING ||
                  existingMemory.fsrsState === FsrsState.RELEARNING
                    ? 0
                    : null,
                stability: existingMemory.stability,
                difficulty: existingMemory.difficulty,
                dueAtEpochMs: existingMemory.dueAtEpochMs,
                lastReviewAtEpochMs: existingMemory.lastReviewAtEpochMs,
              };
        const reviewed = this.scheduler.review(card, fsrsRating, now);
        const stateBefore = existingMemory?.fsrsState ?? FsrsState.NEW;

        await db.itemMemory.put({
          itemId: pairId,
          itemType: 'PAIR',
          fsrsState: reviewed.state,
          difficulty: reviewed.difficulty ?? 0,
          stability: reviewed.stability ?? 0,
          dueAtEpochMs: reviewed.dueAtEpochMs,
          lastReviewAtEpochMs: now,
          reps: (existingMemory?.reps ?? 0) + 1,
          lapses: (existingMemory?.lapses ?? 0) + (fsrsRating === Rating.AGAIN ? 1 : 0),
          masteredUi: 0,
          learnedContentHash: pair?.contentHash ?? null,
          updatedAtEpochMs: now,
          isFavorite: 0,
        });
        await db.reviewLogs.put({
          id: `rv-pair-${now}-${Math.floor(Math.random() * 1e9)}`,
          wordId: pairId,
          rating: fsrsRating,
          questionMode: 'LISTENING',
          usedHint: progress.keywordsRevealed,
          revealedAnswer: 1,
          reviewedAtEpochMs: now,
          responseTimeMs: null,
          scheduledDays: Math.max(0, Math.floor((reviewed.dueAtEpochMs - now) / 86400000)),
          elapsedDays: 0,
          stateBefore,
          stateAfter: reviewed.state,
        });

        await db.scenarioProgress.update([sessionId, pairId], {
          selfRating: rating,
          updatedAtEpochMs: now,
        });

        // 推进: 队列耗尽即完成(含随机练习, 队列长度=每日任务数)
        const nextIndex = session.currentPairIndex + 1;
        const completed = nextIndex >= session.queue.length;

        await db.scenarioSessions.update(sessionId, {
          status: completed ? 'COMPLETED' : 'IN_PROGRESS',
          currentPairId: completed ? null : (session.queue[nextIndex] ?? null),
          currentPairIndex: nextIndex,
          completedAtEpochMs: completed ? now : null,
          updatedAtEpochMs: now,
        });
        return completed;
      },
    );
  }

  /** 今日已完成情景对话任务数(meta 计数) */
  async todayScenarioDone(): Promise<number> {
    const v = await getMeta(`day:${todayKey()}:scenario_done`);
    return v === null ? 0 : Number(v) || 0;
  }

  /** 记录一次今日情景任务完成(事务外, 幂等累计) */
  async markScenarioDoneToday(): Promise<void> {
    const key = `day:${todayKey()}:scenario_done`;
    const v = await getMeta(key);
    await setMeta(key, String((v === null ? 0 : Number(v) || 0) + 1));
  }

  async sessionRatingSummary(
    sessionId: string,
  ): Promise<Partial<Record<DialogueSelfRating, number>>> {
    const progress = await db.scenarioProgress.where('sessionId').equals(sessionId).toArray();
    const out: Partial<Record<DialogueSelfRating, number>> = {};
    for (const p of progress) {
      if (!p.selfRating) continue;
      const r = p.selfRating as DialogueSelfRating;
      out[r] = (out[r] ?? 0) + 1;
    }
    return out;
  }

  private async createSession(
    scenarioId: string,
    pairIds: string[],
    practiceMode: string,
  ): Promise<string> {
    const now = Date.now();
    const id = `scenario-${now}-${Math.floor(Math.random() * 1_000_000_000)}`;
    let contentHash = 'random';
    if (scenarioId !== RANDOM_SCENARIO_ID) {
      const s = await db.scenarios.get(scenarioId);
      if (!s || !s.active) throw new Error('SCENARIO_NOT_FOUND');
      contentHash = s.contentHash;
    }
    const row: ScenarioSessionRow = {
      id,
      scenarioId,
      scenarioContentHash: contentHash,
      status: 'IN_PROGRESS',
      currentPairId: pairIds[0] ?? null,
      currentPairIndex: 0,
      pairCount: pairIds.length,
      practiceMode,
      queuePairIdsJson: JSON.stringify(pairIds),
      startedAtEpochMs: now,
      completedAtEpochMs: null,
      updatedAtEpochMs: now,
    };
    await db.scenarioSessions.put(row);
    return id;
  }

  private async mutateProgress(
    sessionId: string,
    pairId: string,
    field:
      | 'customerAudioCompleted'
      | 'customerTextRevealed'
      | 'keywordsRevealed'
      | 'answerRevealed',
  ): Promise<void> {
    await db.transaction('rw', db.scenarioSessions, db.scenarioProgress, async () => {
      const session = await this.loadSession(sessionId);
      if (!session || session.queue[session.currentPairIndex] !== pairId) {
        throw new Error('STALE_SCENARIO_ACTION');
      }
      const now = Date.now();
      const existing = await db.scenarioProgress.get([sessionId, pairId]);
      if (!existing) {
        await db.scenarioProgress.put({
          sessionId,
          pairId,
          customerAudioCompleted: 0,
          customerTextRevealed: 0,
          keywordsRevealed: 0,
          answerRevealed: 0,
          selfRating: null,
          updatedAtEpochMs: now,
        });
      }
      await db.scenarioProgress.update([sessionId, pairId], {
        [field]: 1,
        updatedAtEpochMs: now,
      });
      await db.scenarioSessions.update(sessionId, { updatedAtEpochMs: now });
    });
  }

  private async loadSession(sessionId: string): Promise<SessionState | null> {
    const s = await db.scenarioSessions.get(sessionId);
    if (!s) return null;
    return {
      id: s.id,
      scenarioId: s.scenarioId,
      status: s.status,
      currentPairId: s.currentPairId,
      currentPairIndex: s.currentPairIndex,
      pairCount: s.pairCount,
      practiceMode: s.practiceMode,
      queue: JSON.parse(s.queuePairIdsJson) as string[],
    };
  }

  private parseJsonList(json: string): string[] {
    try {
      return JSON.parse(json) as string[];
    } catch {
      return [];
    }
  }
}
