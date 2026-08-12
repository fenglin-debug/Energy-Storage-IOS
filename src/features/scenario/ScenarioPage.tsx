import { useCallback, useEffect, useState } from 'react';
import { appServices } from '@/data/AppServices';
import { db } from '@/data/Database';
import {
  DialogueSelfRating,
  type ScenarioFilter,
  type ScenarioSummary,
  type ScenarioUnitView,
} from '@/domain/Models';

const emptyFilter: ScenarioFilter = { onlyIncomplete: false, difficulty: null };

export function ScenarioPage() {
  const [filter, setFilter] = useState<ScenarioFilter>(emptyFilter);
  const [list, setList] = useState<ScenarioSummary[]>([]);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [unit, setUnit] = useState<ScenarioUnitView | null>(null);
  const [completedStats, setCompletedStats] = useState<Partial<Record<DialogueSelfRating, number>> | null>(null);
  const [todayDone, setTodayDone] = useState(0);
  const [todayTarget, setTodayTarget] = useState(3);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshList = useCallback(async () => {
    try {
      const [scenarios, done, settings] = await Promise.all([
        appServices.scenario.list(filter),
        appServices.scenario.todayScenarioDone(),
        appServices.settings.get(),
      ]);
      setList(scenarios);
      setTodayDone(done);
      setTodayTarget(settings.dailyScenarioTaskCount);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [filter]);

  useEffect(() => {
    void refreshList();
  }, [refreshList]);

  async function openSession(id: string) {
    setCompletedStats(null);
    setSessionId(id);
    const u = await appServices.scenario.currentUnit(id);
    setUnit(u);
    if (u?.customerAudioAssetId) {
      const settings = await appServices.settings.get();
      if (settings.autoPlayCustomerAudio) {
        await appServices.audio.play(u.customerAudioAssetId, settings.playbackSpeed);
        await appServices.scenario.markCustomerAudioCompleted(id, u.pairId);
        setUnit(await appServices.scenario.currentUnit(id));
      }
    }
  }

  async function startScenario(scenarioId: string) {
    try {
      setBusy(true);
      await openSession(await appServices.scenario.startOrResume(scenarioId));
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  }

  async function startRandom() {
    try {
      setBusy(true);
      await openSession(await appServices.scenario.startOrResumeRandom());
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!sessionId) return;
    const u = await appServices.scenario.currentUnit(sessionId);
    setUnit(u);
    if (!u) {
      setSessionId(null);
      await refreshList();
    }
  }

  /** 退出本次练习: RANDOM 结束会话; 普通场景仅返回列表(保留进度可继续) */
  async function exitPractice() {
    if (!sessionId) return;
    const row = await db.scenarioSessions.get(sessionId);
    if (row?.practiceMode === 'RANDOM') {
      await appServices.scenario.endRandomSession(sessionId);
    }
    await appServices.audio.stop();
    setSessionId(null);
    setUnit(null);
    await refreshList();
  }

  async function rate(rating: DialogueSelfRating) {
    if (!sessionId || !unit) return;
    const done = await appServices.scenario.rateAndAdvance(sessionId, unit.pairId, rating);
    if (done) {
      const stats = await appServices.scenario.sessionRatingSummary(sessionId);
      await appServices.scenario.markScenarioDoneToday();
      setCompletedStats(stats);
      setUnit(null);
      setSessionId(null);
      await refreshList();
    } else {
      await openSession(sessionId);
    }
  }

  // ---- 完成页 (普通场景全部练习完成) ----
  if (completedStats) {
    return (
      <div className="page stack" style={{ justifyContent: 'center', minHeight: '70vh' }}>
        <h2 style={{ margin: 0 }}>情景练习完成</h2>
        <div className="muted">
          流利 {completedStats[DialogueSelfRating.FLUENT] ?? 0} · 基本{' '}
          {completedStats[DialogueSelfRating.BASIC] ?? 0} · 待加强{' '}
          {completedStats[DialogueSelfRating.CANNOT_ANSWER] ?? 0}
        </div>
        <button type="button" onClick={() => setCompletedStats(null)}>
          返回列表
        </button>
      </div>
    );
  }

  // ---- 练习进行中 ----
  if (sessionId && unit) {
    return (
      <div className="page stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">
            第 {unit.pairIndex + 1} / {unit.pairCount} 轮
          </span>
          <button className="secondary" type="button" onClick={() => void exitPractice()}>
            退出本次练习
          </button>
        </div>

        <div className="card stack">
          <strong>客户</strong>
          {unit.customerAudioCompleted ? (
            <div className="muted">（已听音频）</div>
          ) : (
            <div className="muted" style={{ letterSpacing: 2 }}>
              ▓▓▓▓▓▓▓▓▓▓（先听音频）
            </div>
          )}
          <div className="row">
            <button
              type="button"
              onClick={async () => {
                if (!unit.customerAudioAssetId) return;
                const speed = (await appServices.settings.get()).playbackSpeed;
                await appServices.audio.play(unit.customerAudioAssetId, speed);
                await appServices.scenario.markCustomerAudioCompleted(sessionId, unit.pairId);
                await reload();
              }}
            >
              ▶ 播放客户音频
            </button>
            <button
              className="secondary"
              type="button"
              disabled={!unit.customerAudioCompleted}
              onClick={async () => {
                await appServices.scenario.revealCustomerText(sessionId, unit.pairId);
                await reload();
              }}
            >
              显示原文
            </button>
          </div>
          {unit.customerTextRevealed && (
            <div className="card stack">
              <div>{unit.customerTextEn}</div>
              {unit.customerTextZh && <div className="muted">{unit.customerTextZh}</div>}
            </div>
          )}
        </div>

        {!unit.keywordsRevealed ? (
          <button
            className="secondary"
            type="button"
            onClick={async () => {
              await appServices.scenario.revealKeywords(sessionId, unit.pairId);
              await reload();
            }}
          >
            查看关键词
          </button>
        ) : (
          <div className="card stack">
            <strong>关键词</strong>
            {unit.keywords.length === 0 ? (
              <div className="muted">（无）</div>
            ) : (
              unit.keywords.map((k, i) => <div key={i}>{k}</div>)
            )}
          </div>
        )}

        {!unit.answerRevealed ? (
          <button
            type="button"
            onClick={async () => {
              await appServices.scenario.revealReferenceAnswer(sessionId, unit.pairId);
              await reload();
            }}
          >
            查看参考回答
          </button>
        ) : (
          <div className="card stack">
            <strong>参考回答</strong>
            <div>{unit.referenceCoreEn}</div>
            {unit.referenceChineseHint && <div className="muted">{unit.referenceChineseHint}</div>}
          </div>
        )}

        {unit.answerRevealed && (
          <div className="stack">
            <div className="muted">自评并进入下一轮</div>
            <div className="grid-3">
              <button
                type="button"
                className="secondary"
                onClick={() => void rate(DialogueSelfRating.CANNOT_ANSWER)}
              >
                答不出
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void rate(DialogueSelfRating.BASIC)}
              >
                基本完成
              </button>
              <button
                type="button"
                className="secondary"
                onClick={() => void rate(DialogueSelfRating.FLUENT)}
              >
                流利
              </button>
            </div>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    );
  }

  // ---- 情景列表 ----
  return (
    <div className="page stack">
      <div className="card stack">
        <div className="muted">
          今日对话任务 {Math.min(todayDone, todayTarget)}/{todayTarget}
          {todayDone >= todayTarget ? ' · 今日任务已完成' : ''}
        </div>
        <strong>随机练习</strong>
        <div className="muted">从全部储能对话中持续抽取，薄弱内容会按间隔再次出现。</div>
        <button type="button" disabled={busy} onClick={() => void startRandom()}>
          开始随机练习
        </button>
      </div>

      <div className="row" style={{ flexWrap: 'wrap', gap: 8 }}>
        <button
          type="button"
          className={filter.onlyIncomplete ? undefined : 'secondary'}
          onClick={() => setFilter((f) => ({ ...f, onlyIncomplete: !f.onlyIncomplete }))}
        >
          未完成
        </button>
        <button
          type="button"
          className={filter.difficulty === 'B1-B2' ? undefined : 'secondary'}
          onClick={() =>
            setFilter((f) => ({ ...f, difficulty: f.difficulty === 'B1-B2' ? null : 'B1-B2' }))
          }
        >
          B1-B2
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      <div className="stack">
        {list.map((s) => (
          <div className="list-item stack" key={s.id} style={{ gap: 6 }}>
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <strong>{s.title}</strong>
              <div className="row" style={{ gap: 6 }}>
                {s.duePairCount > 0 && (
                  <span className="chip" style={{ color: 'var(--danger)' }}>
                    复习 {s.duePairCount}
                  </span>
                )}
                {s.status === 'IN_PROGRESS' && (
                  <span className="chip" style={{ color: 'var(--brand-soft)' }}>
                    进行中
                  </span>
                )}
                {s.status === 'COMPLETED' && (
                  <span className="chip" style={{ color: 'var(--brand)' }}>
                    已完成
                  </span>
                )}
              </div>
            </div>
            <div className="muted">
              {s.topic} · {s.salesStage} · {s.customerRole}
            </div>
            <div className="muted">
              {s.difficulty} · 约 {s.estimatedMinutes} 分钟
            </div>
            <button
              type="button"
              className={s.status === 'IN_PROGRESS' ? undefined : 'secondary'}
              disabled={busy}
              onClick={() => void startScenario(s.id)}
            >
              {s.status === 'IN_PROGRESS' ? '继续' : s.status === 'COMPLETED' ? '再练一次' : '开始'}
            </button>
          </div>
        ))}
        {list.length === 0 && <div className="muted">没有符合条件的情景。</div>}
      </div>
    </div>
  );
}
