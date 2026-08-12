import { useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { runStartup } from '@/data/AppServices';
import type { StartupState } from '@/domain/Models';
import { ArticleListPage, ArticlePlayerPage } from '@/features/article/ArticlePage';
import { ScenarioPage } from '@/features/scenario/ScenarioPage';
import { SettingsPage } from '@/features/settings/SettingsPage';
import { VocabularyPage } from '@/features/vocabulary/VocabularyPage';
import { isIosSafari } from '@/pwa/install';
import {
  IconArticle,
  IconScenario,
  IconSettings,
  IconVocabulary,
} from '@/ui/icons';

function titleFor(path: string): string {
  if (path.startsWith('/vocabulary')) return '词汇';
  if (path.startsWith('/scenario')) return '情景';
  if (path.startsWith('/article')) return '文章';
  if (path.startsWith('/settings')) return '设置';
  return '储能英语实战';
}

/** 首启安装引导: 语料未激活且未安装到主屏幕时显示(不下载语料) */
function InstallGuide() {
  return (
    <div className="page stack" style={{ justifyContent: 'center', minHeight: '80vh' }}>
      <h1 style={{ margin: 0 }}>储能英语实战</h1>
      <p className="muted">先添加到主屏幕，再开始使用（语料约 70MB+，将在安装后下载）。</p>
      <ol className="stack" style={{ textAlign: 'left', gap: 8, padding: '0 8px' }}>
        <li>点底部中间的「分享」按钮</li>
        <li>选择「添加到主屏幕」</li>
        <li>返回主屏幕，点击「储能英语实战」图标打开</li>
      </ol>
      {isIosSafari() ? (
        <div className="muted">打开独立 App 后会自动下载语料并开始学习。</div>
      ) : (
        <div className="muted">请使用 iPhone 自带 Safari 浏览器访问本应用。</div>
      )}
    </div>
  );
}

export function App() {
  const [startup, setStartup] = useState<StartupState>({
    phase: 'idle',
    progress: 0,
    message: '',
    error: null,
  });
  const location = useLocation();
  const isPlayer = location.pathname.startsWith('/article/');
  const hideNav = isPlayer;
  const isTopLevel =
    location.pathname === '/vocabulary' ||
    location.pathname === '/scenario' ||
    location.pathname === '/article';

  useEffect(() => {
    void runStartup(setStartup);
  }, []);

  if (startup.phase !== 'ready') {
    if (startup.phase === 'needs-install') {
      return (
        <div className="app-shell no-nav">
          <InstallGuide />
        </div>
      );
    }
    return (
      <div className="app-shell no-nav">
        <div className="page stack" style={{ justifyContent: 'center', minHeight: '80vh' }}>
          <h1 style={{ margin: 0 }}>储能英语实战</h1>
          <p className="muted">iOS 可安装网页应用 · 完全离线学习</p>
          {startup.phase === 'error' ? (
            <>
              <div className="error-box">{startup.error ?? '启动失败'}</div>
              <button type="button" onClick={() => void runStartup(setStartup)}>
                重试
              </button>
            </>
          ) : (
            <>
              <div className="muted">{startup.message || '准备中…'}</div>
              <div className="progress-bar">
                <span style={{ width: `${startup.progress}%` }} />
              </div>
              <div className="muted">首次启动需下载语料（约 70MB+），请保持页面打开。</div>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={`app-shell${hideNav ? ' no-nav' : ''}`}>
      {!hideNav && (
        <header className="topbar">
          <h1>{titleFor(location.pathname)}</h1>
          {isTopLevel && (
            <NavLink
              to="/settings"
              className="icon-btn"
              style={{ display: 'grid', placeItems: 'center', textDecoration: 'none' }}
              title="设置"
            >
              <IconSettings />
            </NavLink>
          )}
        </header>
      )}
      <Routes>
        <Route path="/vocabulary" element={<VocabularyPage />} />
        <Route path="/scenario" element={<ScenarioPage />} />
        <Route path="/article" element={<ArticleListPage />} />
        <Route path="/article/:articleId" element={<ArticlePlayerPage />} />
        <Route path="/settings" element={<SettingsPage />} />
        <Route path="*" element={<Navigate to="/vocabulary" replace />} />
      </Routes>
      <footer className="icp-footer">
        <a href="https://beian.miit.gov.cn" target="_blank" rel="noreferrer">
          沪ICP备2026026194号
        </a>
        <a href="https://beian.mps.gov.cn" target="_blank" rel="noreferrer">
          沪公网安备31011702891887号
        </a>
      </footer>
      {!hideNav && (
        <nav className="bottom-nav">
          <NavLink to="/vocabulary" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <IconVocabulary />
            <span>词汇</span>
          </NavLink>
          <NavLink to="/scenario" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <IconScenario />
            <span>情景</span>
          </NavLink>
          <NavLink to="/article" className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <IconArticle />
            <span>文章</span>
          </NavLink>
        </nav>
      )}
    </div>
  );
}
