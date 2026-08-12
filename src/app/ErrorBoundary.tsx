import { Component, type ErrorInfo, type ReactNode } from 'react';
import { setMeta } from '@/data/Database';

interface Props {
  children: ReactNode;
}

interface State {
  error: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: String(error).replace(/^Error:\s*/, '') };
  }

  async componentDidCatch(error: unknown, info: ErrorInfo): Promise<void> {
    try {
      await setMeta('last_error_code', String(error).replace(/^Error:\s*/, '').split(':')[0] ?? 'RENDER_ERROR');
      await setMeta('last_error_detail', `${String(error)} | ${info.componentStack ?? ''}`);
    } catch {
      /* ignore */
    }
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children;
    return (
      <div className="page stack" style={{ justifyContent: 'center', minHeight: '70vh' }}>
        <h1 style={{ margin: 0 }}>出了点问题</h1>
        <div className="error-box">{this.state.error}</div>
        <p className="muted">学习记录都保存在本机，重新打开即可恢复。</p>
        <button type="button" onClick={() => window.location.reload()}>
          重新加载
        </button>
      </div>
    );
  }
}
