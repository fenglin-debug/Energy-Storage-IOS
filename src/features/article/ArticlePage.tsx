import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { appServices } from '@/data/AppServices';
import type { Article, PlaybackSnapshot } from '@/domain/Models';

function fmt(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}

function progressText(a: Article): string {
  if (a.durationMs <= 0) return '';
  const pct = Math.min(100, Math.round((a.lastPositionMs / a.durationMs) * 100));
  return `已听 ${pct}%`;
}

// =====================================================================
// 文章列表 ("文章 · 磨耳朵" + 导入菜单 + 随机练习 + 列表)
// =====================================================================
export function ArticleListPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showFormat, setShowFormat] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [importMsg, setImportMsg] = useState<string | null>(null);
  const [todayDone, setTodayDone] = useState(0);
  const [todayTarget, setTodayTarget] = useState(1);
  const fileRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();

  const refresh = useCallback(async () => {
    try {
      const [list, done, settings] = await Promise.all([
        appServices.article.list(),
        appServices.article.todayCompletedCount(),
        appServices.settings.get(),
      ]);
      setArticles(list);
      setTodayDone(done);
      setTodayTarget(settings.dailyArticleTaskCount);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function startRandom() {
    const id = await appServices.article.randomId();
    if (id) navigate(`/article/${id}`, { state: { random: true } });
  }

  async function importPack(file: File) {
    setImportMsg('正在导入文章包…');
    setMenuOpen(false);
    try {
      const r = await appServices.article.importPackage(file);
      setImportMsg(r.ok ? '文章包导入成功' : `导入失败：${r.errorCode}`);
      await refresh();
    } catch (e) {
      setImportMsg(`导入失败：${String(e)}`);
    }
  }

  async function removeArticle(a: Article) {
    if (!window.confirm(`删除这篇导入文章？`)) return;
    const r = await appServices.article.deleteImported(a.id);
    if (r.ok) await refresh();
    else setError(r.errorCode ?? '删除失败');
  }

  return (
    <div className="page stack">
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <strong>文章 · 磨耳朵</strong>
        <button
          type="button"
          className="secondary"
          aria-label="导入文章"
          onClick={() => setMenuOpen((v) => !v)}
        >
          ＋
        </button>
      </div>
      {menuOpen && (
        <div className="card stack">
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              fileRef.current?.click();
            }}
          >
            导入 .bessarticle 文章包
          </button>
          <button
            type="button"
            className="secondary"
            onClick={() => {
              setMenuOpen(false);
              setShowFormat(true);
            }}
          >
            查看格式说明
          </button>
        </div>
      )}
      <input
        ref={fileRef}
        type="file"
        accept=".bessarticle,application/zip"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void importPack(f);
          e.target.value = '';
        }}
      />
      {showFormat && (
        <div className="card stack">
          <strong>.bessarticle 文章包格式</strong>
          <div className="muted">
            由储能英语实战各端导出的文章包（zip）：包含 manifest 与逐句字幕的音频。导入后可在「文章 · 磨耳朵」中收听。
          </div>
          <button type="button" onClick={() => setShowFormat(false)}>
            知道了
          </button>
        </div>
      )}
      {importMsg && (
        <div className="card">
          <div className="muted">{importMsg}</div>
          <button type="button" onClick={() => setImportMsg(null)}>
            知道了
          </button>
        </div>
      )}

      <div className="card stack">
        <div className="muted">
          今日文章任务 {Math.min(todayDone, todayTarget)}/{todayTarget}
          {todayDone >= todayTarget ? ' · 今日任务已完成' : ''}
        </div>
        <strong>随机练习</strong>
        <div className="muted">随机播放储能文章，整袋播放完前不会重复。</div>
        <button type="button" onClick={() => void startRandom()}>
          随机播放
        </button>
      </div>

      {error && <div className="error-box">{error}</div>}
      {articles.length === 0 ? (
        <div className="stack">
          <div className="muted">文章库为空。点击右上角 ＋，导入 .bessarticle 文章包。</div>
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              fileRef.current?.click();
            }}
          >
            导入 .bessarticle 文章包
          </button>
        </div>
      ) : (
        <div className="stack">
          {articles.map((a) => (
            <div className="list-item stack" key={a.id} style={{ gap: 6 }}>
              <button
                type="button"
                className="grow"
                style={{ textAlign: 'left', background: 'none', border: 'none', padding: 0 }}
                onClick={() => navigate(`/article/${a.id}`, { state: { random: false } })}
              >
                <div style={{ fontWeight: 600 }}>{a.titleZh || a.title}</div>
                <div className="muted">
                  {a.titleZh ? a.title : ''} {fmt(a.durationMs)} · {a.topic}
                </div>
              </button>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div className="muted">{progressText(a)}</div>
                {a.source !== 'BUNDLED' && (
                  <div className="row" style={{ gap: 8 }}>
                    <span className="chip">导入文章</span>
                    <button
                      type="button"
                      className="secondary"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
                      onClick={() => void removeArticle(a)}
                    >
                      删除
                    </button>
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// =====================================================================
// 文章播放器 ("文章磨耳朵 / 随机磨耳朵", 底部固定播放条)
// =====================================================================
export function ArticlePlayerPage() {
  const { articleId = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const isRandom = (location.state as { random?: boolean } | null)?.random === true;

  const [article, setArticle] = useState<Article | null>(null);
  const [all, setAll] = useState<Article[]>([]);
  const [snap, setSnap] = useState<PlaybackSnapshot>(appServices.audio.snapshot());
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const [a, list] = await Promise.all([
        appServices.article.get(articleId),
        appServices.article.list(),
      ]);
      setArticle(a);
      setAll(list);
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, [articleId]);

  useEffect(() => {
    void load();
    return () => {
      void appServices.audio.stop();
    };
  }, [load]);

  useEffect(() => {
    const unsub = appServices.audio.subscribe(setSnap);
    return () => unsub();
  }, []);

  // 自动保存播放进度 (防抖)
  const lastSaveRef = useRef(0);
  useEffect(() => {
    if (!article) return;
    if (snap.positionMs === 0) return;
    const now = Date.now();
    if (now - lastSaveRef.current < 800) return;
    lastSaveRef.current = now;
    void appServices.article.saveProgress(article.id, snap.positionMs, false);
  }, [snap.positionMs, article]);

  // 播放结束 → 标记完成 + 今日任务计数
  useEffect(() => {
    if (!article) return;
    if (snap.state === 'COMPLETED') {
      void appServices.article.saveProgress(article.id, article.durationMs, true);
      void appServices.article.markCompletedToday(article.id);
    }
  }, [snap.state, article]);

  // 当前段落高亮 + 自动滚动
  const activeIdx = article
    ? article.paragraphs.findIndex(
        (p) =>
          p.startMs != null &&
          p.endMs != null &&
          snap.positionMs >= p.startMs &&
          snap.positionMs < p.endMs,
      )
    : -1;
  useEffect(() => {
    if (activeIdx < 0 || !scrollRef.current) return;
    const el = scrollRef.current.children[activeIdx] as HTMLElement | undefined;
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeIdx]);

  if (!article) {
    return (
      <div className="page">
        {error ? <div className="error-box">{error}</div> : <div className="muted">加载中…</div>}
      </div>
    );
  }

  const hasSubtitles = article.paragraphs.some((p) => p.textZh?.trim());
  const index = all.findIndex((a) => a.id === article.id);
  const canNext = isRandom || all.length > 1;

  async function toggleParagraph(i: number) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  }

  async function playArticle(a: Article) {
    const speed = (await appServices.settings.get()).playbackSpeed;
    await appServices.audio.play(a.audioAssetId, speed);
    if (a.lastPositionMs > 0) {
      await appServices.audio.seekTo(a.lastPositionMs);
    }
  }

  async function next() {
    if (isRandom) {
      const id = await appServices.article.randomId();
      if (id) navigate(`/article/${id}`, { state: { random: true } });
      return;
    }
    if (index >= 0 && index + 1 < all.length) {
      navigate(`/article/${all[index + 1]!.id}`, { state: { random: false } });
    }
  }

  return (
    <div className="app-shell no-nav" style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page stack" style={{ flex: 1, paddingBottom: 130 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <button className="secondary" type="button" onClick={() => navigate('/article')}>
            ← 返回
          </button>
          <span className="chip">{isRandom ? '随机磨耳朵' : '文章磨耳朵'}</span>
        </div>
        <div className="muted">英文全文 · 点击有翻译的句子查看中文</div>

        {!hasSubtitles && (
          <div className="card muted">
            此文章未附字幕，可进行纯听练习。播放、暂停、拖动进度和下一篇功能仍可正常使用。
          </div>
        )}

        {error && <div className="error-box">{error}</div>}

        <div className="stack" ref={scrollRef}>
          {article.paragraphs.map((p, i) => (
            <div
              key={i}
              className={`card${i === activeIdx ? ' paragraph-active' : ''}`}
              style={{ cursor: p.textZh ? 'pointer' : 'default' }}
              onClick={() => {
                if (p.textZh) void toggleParagraph(i);
              }}
            >
              <div>{p.textEn}</div>
              {expanded.has(i) && p.textZh && <div className="muted">{p.textZh}</div>}
            </div>
          ))}
        </div>
      </div>

      {/* 底部固定播放条 */}
      <div className="article-player-bar">
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {article.titleZh || article.title}
        </div>
        <input
          type="range"
          min={0}
          max={Math.max(1, article.durationMs)}
          value={Math.min(snap.positionMs, article.durationMs)}
          onChange={(e) => void appServices.audio.seekTo(Number(e.target.value))}
          aria-label="播放进度"
        />
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="muted">
            {fmt(snap.positionMs)} / {fmt(article.durationMs)}
          </span>
          <div className="row" style={{ gap: 10 }}>
            <button
              type="button"
              className="secondary"
              aria-label="播放或暂停"
              onClick={async () => {
                if (snap.state === 'PLAYING') await appServices.audio.pause();
                else if (snap.state === 'PAUSED' || snap.state === 'BUFFERING')
                  await appServices.audio.resume();
                else await playArticle(article);
              }}
            >
              {snap.state === 'PLAYING' ? '⏸' : '▶'}
            </button>
            <button
              type="button"
              className="secondary"
              aria-label="下一篇"
              disabled={!canNext}
              onClick={() => void next()}
            >
              下一篇
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
