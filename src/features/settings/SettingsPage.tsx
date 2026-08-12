import { useEffect, useRef, useState } from 'react';
import { appServices } from '@/data/AppServices';
import type {
  AppSettings,
  AppSupportInfo,
  LearningBackupInspection,
  OperationResult,
} from '@/domain/Models';

function isOpResult(v: unknown): v is OperationResult {
  return !!v && typeof v === 'object' && 'ok' in v && (v as OperationResult).ok === false;
}

export function SettingsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [info, setInfo] = useState<AppSupportInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [preview, setPreview] = useState<LearningBackupInspection | null>(null);
  const backupInput = useRef<HTMLInputElement>(null);

  async function reload() {
    setSettings(await appServices.settings.get());
    setInfo(await appServices.backup.getSupportInfo());
  }

  useEffect(() => {
    void reload();
  }, []);

  async function save(partial: Partial<AppSettings>) {
    if (!settings) return;
    const next = { ...settings, ...partial };
    await appServices.settings.save(next);
    setSettings(await appServices.settings.get());
    setMsg('设置已保存');
  }

  if (!settings) return <div className="page muted">加载中…</div>;

  return (
    <div className="page stack">
      {/* ① 播放 */}
      <section className="card stack">
        <strong>播放</strong>
        <label className="stack">
          <span className="muted">语速</span>
          <div className="segmented">
            {(
              [
                [0.85, '慢速'],
                [1, '标准'],
                [1.15, '快速'],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                type="button"
                className={settings.playbackSpeed === v ? 'active' : undefined}
                onClick={() => void save({ playbackSpeed: v })}
              >
                {label}
              </button>
            ))}
          </div>
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.autoPlayCustomerAudio}
            onChange={(e) => void save({ autoPlayCustomerAudio: e.target.checked })}
          />
          自动播放客户音频
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={settings.autoPlayVocabularyAudio}
            onChange={(e) => void save({ autoPlayVocabularyAudio: e.target.checked })}
          />
          自动播放词汇音频
        </label>
      </section>

      {/* ② 学习计划 */}
      <section className="card stack">
        <strong>学习计划</strong>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>每日新词目标</span>
          <span className="stepper">
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyNewWordTarget: Math.max(0, settings.dailyNewWordTarget - 5) })}
            >
              −
            </button>
            <span className="stepper-value">{settings.dailyNewWordTarget}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyNewWordTarget: Math.min(50, settings.dailyNewWordTarget + 5) })}
            >
              ＋
            </button>
          </span>
        </label>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>每日情景任务数</span>
          <span className="stepper">
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyScenarioTaskCount: Math.max(1, settings.dailyScenarioTaskCount - 1) })}
            >
              −
            </button>
            <span className="stepper-value">{settings.dailyScenarioTaskCount}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyScenarioTaskCount: Math.min(10, settings.dailyScenarioTaskCount + 1) })}
            >
              ＋
            </button>
          </span>
        </label>
        <label className="row" style={{ justifyContent: 'space-between' }}>
          <span>每日文章任务数</span>
          <span className="stepper">
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyArticleTaskCount: Math.max(1, settings.dailyArticleTaskCount - 1) })}
            >
              −
            </button>
            <span className="stepper-value">{settings.dailyArticleTaskCount}</span>
            <button
              type="button"
              className="secondary"
              onClick={() => void save({ dailyArticleTaskCount: Math.min(10, settings.dailyArticleTaskCount + 1) })}
            >
              ＋
            </button>
          </span>
        </label>
      </section>

      {/* ③ 学习记录备份 */}
      <section className="card stack">
        <strong>学习记录备份</strong>
        <div className="muted">
          备份只包含学习进度和练习断点，不包含语料、音频、导入文章或提醒设置。恢复会完整覆盖本机学习记录。
        </div>
        <div className="muted">
          最近备份：
          {info?.lastBackupAtEpochMs
            ? new Date(info.lastBackupAtEpochMs).toLocaleString()
            : '无'}
        </div>
        <label className="stack">
          <span className="muted">密码（8–128 字符，留空则不加密）</span>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="可选密码"
            autoComplete="new-password"
          />
        </label>
        <button
          type="button"
          onClick={async () => {
            if (password.length > 0 && password.length < 8) {
              setErr('密码长度需为 8–128 字符');
              return;
            }
            const r = await appServices.backup.exportBackup(password || undefined);
            if (isOpResult(r) || !('blob' in r)) {
              setErr((r as OperationResult).errorCode);
              return;
            }
            const url = URL.createObjectURL(r.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = r.fileName;
            a.click();
            URL.revokeObjectURL(url);
            setMsg('备份已导出');
            await reload();
          }}
        >
          导出学习记录
        </button>
        <button type="button" className="secondary" onClick={() => backupInput.current?.click()}>
          恢复学习记录
        </button>
        <input
          ref={backupInput}
          type="file"
          accept=".bessbackup,application/zip"
          hidden
          onChange={async (e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const r = await appServices.backup.inspectBackup(f, password || undefined);
            if (isOpResult(r) || !('previewId' in r)) {
              setErr((r as OperationResult).errorCode);
              setPreview(null);
              return;
            }
            setPreview(r);
            setMsg('备份已检视，确认后可恢复');
          }}
        />
        {preview && (
          <div className="card stack">
            <div className="muted">
              备份时间：{new Date(preview.createdAtEpochMs).toLocaleString()}
              <br />
              来源版本：{preview.appVersionName} ({preview.appVersionCode})
              <br />
              加密：{preview.encrypted ? '是' : '否'}
              <br />
              学习记录：{preview.counts.wordMemoryStates} 条
              {!preview.corpusMatches && (
                <span style={{ color: 'var(--warning)' }}>
                  <br />
                  备份语料与当前不一致，恢复后旧语料相关进度可能不适用。
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={async () => {
                const r = await appServices.backup.restoreBackup(preview.previewId);
                setMsg(r.message);
                if (!r.ok) setErr(r.errorCode);
                setPreview(null);
                await reload();
              }}
            >
              确认完整恢复学习状态
            </button>
            <button
              type="button"
              className="secondary"
              onClick={async () => {
                await appServices.backup.discardPreview(preview.previewId);
                setPreview(null);
              }}
            >
              取消
            </button>
          </div>
        )}
      </section>

      {/* ④ 版本与支持 */}
      <section className="card stack">
        <strong>版本与支持</strong>
        <div className="muted">
          版本 {info?.appVersionName} ({info?.appVersionCode}) · 数据库 v{info?.databaseVersion}
          <br />
          语料 {info?.corpusContentVersion ?? '未激活'} · 学习记录 {info?.recordCounts.wordMemoryStates ?? 0} 条
          {info?.lastErrorCode ? <br /> : null}
          {info?.lastErrorCode ? `最近错误：${info.lastErrorCode}` : null}
          <br />
          存储占用：{info?.storageEstimate ?? '未知'}
        </div>
        <button
          type="button"
          className="secondary"
          onClick={async () => {
            const r = await appServices.backup.exportDiagnostics();
            if (isOpResult(r) || !('blob' in r)) {
              setErr((r as OperationResult).errorCode);
              return;
            }
            const url = URL.createObjectURL(r.blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = r.fileName;
            a.click();
            URL.revokeObjectURL(url);
            setMsg('诊断报告已导出');
          }}
        >
          导出本地诊断报告
        </button>
        <div className="muted">诊断报告不包含学习正文；更新时直接覆盖安装即可，不要清除站点数据。</div>
      </section>

      {/* ⑤ 页脚说明 */}
      <div className="muted" style={{ textAlign: 'center', padding: '8px 0 4px' }}>
        本应用完全离线运行，不请求网络或录音权限。
      </div>

      {msg && <div className="banner">{msg}</div>}
      {err && <div className="error-box">{err}</div>}
    </div>
  );
}
