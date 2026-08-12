import type { StartupState } from '@/domain/Models';
import type { ArticleRepositoryImpl } from './ArticleRepositoryImpl';
import type { CorpusRepositoryImpl } from './CorpusRepositoryImpl';
import { loadCatalog, requestPersistentStorage, type CatalogEntry } from './BundledLoader';
import { sha256Hex } from './Crypto';
import { getMeta } from './Database';
import { isStandalone } from '@/pwa/install';

/**
 * First-launch corpus download state machine.
 *
 * Flow: skip if already active (offline cold start) → if corpus not active
 * AND the app is not installed to the home screen, gate on `needs-install`
 * (no download; the App shell shows the add-to-home-screen guide) → request
 * persistent storage → fetch catalog → stream-download corpus/article with
 * progress → SHA-256 verify → atomic activation. On any failure nothing is
 * destroyed: old corpus/learning data stay intact and the startup error UI
 * offers retry. Dev/preview fall back to the bundled packages when no
 * catalog exists.
 *
 * 语料更新随应用版本发布: 不再提供检查/单独更新入口。
 */
export class CorpusDownloader {
  constructor(
    private readonly corpus: CorpusRepositoryImpl,
    private readonly article: ArticleRepositoryImpl,
  ) {}

  async run(onUpdate: (s: StartupState) => void): Promise<void> {
    const corpusActive = await getMeta('active_corpus_content_version');
    const articlesActive = await getMeta('articles_bundled_version');
    if (corpusActive !== null && articlesActive !== null) return; // already installed

    // First-launch gating: only download after the user adds the app to the
    // home screen and opens it standalone.
    if (!isStandalone()) {
      onUpdate({
        phase: 'needs-install',
        progress: 0,
        message: '请先将应用添加到主屏幕',
        error: null,
      });
      return;
    }

    onUpdate({ phase: 'checking-storage', progress: 6, message: '检查可用空间…', error: null });
    await requestPersistentStorage();

    let catalog: Awaited<ReturnType<typeof loadCatalog>> | null = null;
    try {
      catalog = await loadCatalog();
    } catch {
      catalog = null;
    }

    if (!catalog?.corpus || !catalog?.article) {
      // No catalog (dev/preview): fall back to bundled packages.
      await this.installBundled(corpusActive === null, articlesActive === null, onUpdate);
      return;
    }

    if (corpusActive === null && catalog.corpus) {
      onUpdate({ phase: 'downloading-corpus', progress: 10, message: '准备下载语料…', error: null });
      const bytes = await this.download(catalog.corpus, '语料', (p, msg) =>
        onUpdate({ phase: 'downloading-corpus', progress: p, message: msg, error: null }),
      );
      const sha = await sha256Hex(bytes);
      if (sha.toLowerCase() !== catalog.corpus.sha256.toLowerCase()) {
        throw new Error('CORPUS_DOWNLOAD_CHECKSUM_MISMATCH');
      }
      onUpdate({ phase: 'loading-corpus', progress: 72, message: '解压并写入学习库…', error: null });
      const r = await this.corpus.activateDownloaded(bytes, catalog.corpus.sha256, (p, msg) =>
        onUpdate({
          phase: 'loading-corpus',
          progress: 72 + Math.floor(p * 0.18),
          message: msg,
          error: null,
        }),
      );
      if (!r.ok) throw new Error(r.errorCode ?? 'CORPUS_DOWNLOAD_INSTALL_FAILED');
    }

    if (articlesActive === null && catalog.article) {
      onUpdate({ phase: 'downloading-corpus', progress: 90, message: '准备下载文章…', error: null });
      const bytes = await this.download(catalog.article, '文章', (p, msg) =>
        onUpdate({ phase: 'downloading-corpus', progress: p, message: msg, error: null }),
      );
      const sha = await sha256Hex(bytes);
      if (sha.toLowerCase() !== catalog.article.sha256.toLowerCase()) {
        throw new Error('ARTICLE_DOWNLOAD_CHECKSUM_MISMATCH');
      }
      onUpdate({ phase: 'loading-articles', progress: 92, message: '写入文章…', error: null });
      const r = await this.article.activateDownloaded(bytes, catalog.article.sha256, (p, msg) =>
        onUpdate({
          phase: 'loading-articles',
          progress: 92 + Math.floor(p * 0.06),
          message: msg,
          error: null,
        }),
      );
      if (!r.ok) throw new Error(r.errorCode ?? 'ARTICLE_DOWNLOAD_INSTALL_FAILED');
    }
  }

  private async installBundled(
    needCorpus: boolean,
    needArticles: boolean,
    onUpdate: (s: StartupState) => void,
  ): Promise<void> {
    if (needCorpus) {
      onUpdate({ phase: 'loading-corpus', progress: 15, message: '激活内置语料（首次较慢）…', error: null });
      await this.corpus.ensureBundledActivated((p, msg) =>
        onUpdate({
          phase: 'loading-corpus',
          progress: 15 + Math.floor(p * 0.55),
          message: msg,
          error: null,
        }),
      );
    }
    if (needArticles) {
      onUpdate({ phase: 'loading-articles', progress: 75, message: '激活内置文章…', error: null });
      await this.article.ensureBundledActivated((p, msg) =>
        onUpdate({
          phase: 'loading-articles',
          progress: 75 + Math.floor(p * 0.2),
          message: msg,
          error: null,
        }),
      );
    }
  }

  private async download(
    entry: CatalogEntry,
    label: string,
    onProgress: (p: number, msg: string) => void,
  ): Promise<Uint8Array> {
    const totalMb = Math.ceil(entry.sizeBytes / (1024 * 1024));
    onProgress(10, `下载${label}（约 ${totalMb}MB）…`);
    // Abort after 5 minutes of total transfer time (first-launch corpus is
    // ~40MB; on a slow link this is generous, on a stalled link it frees the
    // user from a hung startup with no way out).
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5 * 60 * 1000);
    // Refuse to buffer more than 1.5× the declared size — a malicious or
    // misbehaving origin streaming far more than advertised would otherwise OOM
    // the browser. The SHA-256 check afterwards still catches any tampering.
    const maxBytes = Math.max(entry.sizeBytes, 1) * 3 / 2;
    let response: Response;
    try {
      response = await fetch(`/content/${entry.fileName}`, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`DOWNLOAD_HTTP_${response.status}`);

    if (!response.body) {
      const buffer = await response.arrayBuffer();
      const out = new Uint8Array(buffer);
      if (out.byteLength > maxBytes) throw new Error('DOWNLOAD_SIZE_EXCEEDS_EXPECTED');
      return out;
    }

    const reader = response.body.getReader();
    const total = entry.sizeBytes;
    const chunks: Uint8Array[] = [];
    let received = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        received += value.byteLength;
        if (received > maxBytes) {
          controller.abort();
          throw new Error('DOWNLOAD_SIZE_EXCEEDS_EXPECTED');
        }
      }
      const pct = Math.min(96, Math.floor((received / Math.max(1, total)) * 100));
      const mb = (received / (1024 * 1024)).toFixed(0);
      onProgress(10 + Math.floor(pct * 0.62), `下载${label}… ${mb}/${totalMb} MB`);
    }
    const out = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return out;
  }
}
