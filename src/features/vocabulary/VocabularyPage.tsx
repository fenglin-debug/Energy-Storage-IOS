import { useCallback, useEffect, useRef, useState } from 'react';
import { appServices } from '@/data/AppServices';
import {
  VocabularyAssessment,
  type VocabularyQueue,
  type VocabularySessionView,
} from '@/domain/Models';

const emptySession: VocabularySessionView = {
  sessionId: '',
  status: 'IDLE',
  currentIndex: 0,
  totalCount: 0,
  questionMode: 'INTRODUCE' as VocabularySessionView['questionMode'],
  word: null,
  answerRevealed: false,
  hintRevealed: false,
  assessmentSubmitted: false,
  selectedAssessment: null,
  examples: [],
};

function assessmentLabel(a: string): string {
  if (a === VocabularyAssessment.UNFAMILIAR) return '陌生';
  if (a === VocabularyAssessment.FUZZY) return '模糊';
  return '掌握';
}

export function VocabularyPage() {
  const [queue, setQueue] = useState<VocabularyQueue>({
    newCount: 0,
    reviewCount: 0,
    totalCount: 0,
  });
  const [session, setSession] = useState<VocabularySessionView>(emptySession);
  const [studying, setStudying] = useState(false);
  const [finished, setFinished] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastWordIdRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setQueue(await appServices.vocabulary.todayQueue());
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // 词卡切换时按设置自动播放词汇音频 (对齐 Android autoPlayVocabularyAudio)
  useEffect(() => {
    if (!studying || !session.word) return;
    if (lastWordIdRef.current === session.word.id) return;
    lastWordIdRef.current = session.word.id;
    void (async () => {
      const s = await appServices.settings.get();
      if (s.autoPlayVocabularyAudio && session.word?.wordAudioAssetId) {
        await appServices.audio.play(session.word.wordAudioAssetId, s.playbackSpeed);
      }
    })();
  }, [session.word, studying]);

  async function start() {
    try {
      setBusy(true);
      setFinished(false);
      const id = await appServices.vocabulary.startOrResumeSession();
      setSession(await appServices.vocabulary.session(id));
      setStudying(true);
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    } finally {
      setBusy(false);
    }
  }

  async function reloadSession() {
    const view = await appServices.vocabulary.session(session.sessionId);
    if (view.status === 'COMPLETED') {
      setStudying(false);
      setFinished(true);
      await refresh();
    } else {
      setSession(view);
    }
  }

  async function submit(assessment: VocabularyAssessment) {
    try {
      await appServices.vocabulary.submitAssessment(session.sessionId, assessment);
      await reloadSession();
    } catch (e) {
      setError(String(e).replace(/^Error:\s*/, ''));
    }
  }

  async function next() {
    await appServices.vocabulary.advanceToNext(session.sessionId);
    await reloadSession();
  }

  async function speak(assetId: string | undefined | null) {
    if (!assetId) return;
    const s = await appServices.settings.get();
    await appServices.audio.play(assetId, s.playbackSpeed);
  }

  // ---- 练习进行中 ----
  if (studying && session.status === 'IN_PROGRESS') {
    const w = session.word;
    const isLast = session.currentIndex + 1 >= session.totalCount;
    return (
      <div className="page stack">
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button
            className="secondary"
            type="button"
            onClick={() => {
              setStudying(false);
              void refresh();
            }}
          >
            返回
          </button>
          <span className="muted">
            第 {session.currentIndex + 1} 条 · 剩余 {Math.max(0, session.totalCount - session.currentIndex)}
          </span>
        </div>

        {w && (
          <div className="card stack">
            <strong style={{ fontSize: '1.6rem' }}>{w.term}</strong>
            {w.ipa && <div className="muted">{w.ipa}</div>}
            <div style={{ fontSize: '1.15rem' }}>{w.chineseGloss}</div>
            <div className="row">
              <button className="secondary" type="button" onClick={() => void speak(w.wordAudioAssetId)}>
                朗读
              </button>
            </div>
          </div>
        )}

        {w &&
          session.examples.map((ex, i) => (
            <div className="card stack" key={i}>
              <div>{ex.textEn}</div>
              {ex.textZh && <div className="muted">{ex.textZh}</div>}
              <div className="row">
                <button
                  className="secondary"
                  type="button"
                  onClick={() => void speak(ex.audioAssetId)}
                >
                  朗读例句
                </button>
              </div>
            </div>
          ))}

        {session.assessmentSubmitted ? (
          <div className="row">
            <span className="muted">已选择：{assessmentLabel(session.selectedAssessment ?? '')}</span>
            <button type="button" style={{ flex: 1 }} onClick={() => void next()}>
              {isLast ? '完成本次学习' : '下一条'}
            </button>
          </div>
        ) : (
          <div className="grid-3">
            <button
              type="button"
              className="secondary"
              onClick={() => void submit(VocabularyAssessment.UNFAMILIAR)}
            >
              陌生
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void submit(VocabularyAssessment.FUZZY)}
            >
              模糊
            </button>
            <button
              type="button"
              className="secondary"
              onClick={() => void submit(VocabularyAssessment.MASTERED)}
            >
              掌握
            </button>
          </div>
        )}
        {error && <div className="error-box">{error}</div>}
      </div>
    );
  }

  // ---- 完成页 ----
  if (finished) {
    return (
      <div className="page stack" style={{ justifyContent: 'center', minHeight: '70vh' }}>
        <h2 style={{ margin: 0 }}>本次学习完成</h2>
        <button type="button" onClick={() => setFinished(false)}>
          返回
        </button>
      </div>
    );
  }

  // ---- 今日词汇首页式 ----
  return (
    <div className="page stack">
      <h2 style={{ margin: 0 }}>今日词汇</h2>
      <div className="muted">
        新内容 {queue.newCount} 条 · 到期 {queue.reviewCount} 条
      </div>
      {busy ? (
        <div className="muted">正在准备…</div>
      ) : queue.totalCount > 0 ? (
        <button type="button" onClick={() => void start()}>
          开始背单词
        </button>
      ) : (
        <div className="muted">今天的自动学习任务已完成</div>
      )}
      {error && <div className="error-box">{error}</div>}
    </div>
  );
}
