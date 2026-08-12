import type { Article, OperationResult } from '@/domain/Models';
import type { ArticleRepository } from '@/domain/Repositories';
import { loadBundledBytes, requestPersistentStorage } from './BundledLoader';
import { sha256Hex } from './Crypto';
import { db, getMeta, setMeta } from './Database';
import { putAudioBlob } from './AudioStore';
import { validateArticlePackage } from './PackageValidator';

function failure(error: unknown): OperationResult {
  const raw = String(error);
  const code = raw.replace(/^Error:\s*/, '').split(':')[0] ?? 'ARTICLE_IMPORT_FAILED';
  return { ok: false, errorCode: code, message: `文章操作失败（${code}）` };
}

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

export class ArticleRepositoryImpl implements ArticleRepository {
  /** 今日已完成文章任务数 (meta 幂等计数) */
  async todayCompletedCount(): Promise<number> {
    const v = await getMeta(`day:${todayKey()}:article_done_ids`);
    if (!v) return 0;
    try {
      return (JSON.parse(v) as string[]).length;
    } catch {
      return 0;
    }
  }

  /** 记录一篇今日文章任务完成 (幂等: 同一篇只计一次) */
  async markCompletedToday(articleId: string): Promise<void> {
    const key = `day:${todayKey()}:article_done_ids`;
    const v = await getMeta(key);
    let ids: string[] = [];
    try {
      ids = v ? (JSON.parse(v) as string[]) : [];
    } catch {
      ids = [];
    }
    if (!ids.includes(articleId)) {
      ids.push(articleId);
      await setMeta(key, JSON.stringify(ids));
    }
  }

  async list(): Promise<Article[]> {
    const articles = await db.articles.toArray();
    const progress = await db.articleProgress.toArray();
    const prog = new Map(progress.map((p) => [p.articleId, p]));
    return articles
      .map((a) => this.mapArticle(a, prog.get(a.id)))
      .sort((x, y) => x.id.localeCompare(y.id));
  }

  async get(articleId: string): Promise<Article | null> {
    const a = await db.articles.get(articleId);
    if (!a) return null;
    const p = await db.articleProgress.get(articleId);
    return this.mapArticle(a, p);
  }

  async randomId(): Promise<string | null> {
    const ids = await db.articles.toCollection().primaryKeys();
    if (ids.length === 0) return null;
    return ids[Math.floor(Math.random() * ids.length)] as string;
  }

  async saveProgress(
    articleId: string,
    positionMs: number,
    completed: boolean,
  ): Promise<void> {
    const now = Date.now();
    const existing = await db.articleProgress.get(articleId);
    await db.articleProgress.put({
      articleId,
      lastPositionMs: Math.max(0, Math.floor(positionMs)),
      listenCount: (existing?.listenCount ?? 0) + (completed ? 1 : 0),
      completedAtEpochMs: completed ? now : (existing?.completedAtEpochMs ?? null),
      updatedAtEpochMs: now,
    });
  }

  async importPackage(file: File): Promise<OperationResult> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await this.install(bytes, false, 'IMPORTED');
    } catch (e) {
      return failure(e);
    }
  }

  async deleteImported(articleId: string): Promise<OperationResult> {
    try {
      const a = await db.articles.get(articleId);
      if (!a) return { ok: false, errorCode: 'NOT_FOUND', message: '文章不存在' };
      if (a.source === 'BUNDLED') {
        return { ok: false, errorCode: 'CANNOT_DELETE_BUNDLED', message: '不能删除内置文章' };
      }
      await db.transaction(
        'rw',
        db.articles,
        db.articleProgress,
        db.audioFileIndex,
        db.audioBlobs,
        async () => {
          const index = await db.audioFileIndex.get(a.audioAssetId);
          if (index) {
            await db.audioBlobs.delete(index.localKey);
            await db.audioFileIndex.delete(a.audioAssetId);
          }
          await db.articleProgress.delete(articleId);
          await db.articles.delete(articleId);
        },
      );
      return { ok: true, errorCode: null, message: '已删除' };
    } catch (e) {
      return failure(e);
    }
  }

  async ensureBundledActivated(
    onProgress?: (p: number, msg: string) => void,
  ): Promise<void> {
    if ((await getMeta('articles_bundled_version')) !== null) return;
    onProgress?.(5, '读取内置文章…');
    const bytes = await loadBundledBytes('bundled.bessarticle');
    const result = await this.install(bytes, true, 'BUNDLED', onProgress);
    if (!result.ok) throw new Error(result.errorCode ?? 'ARTICLE_INSTALL_FAILED');
  }

  async activateDownloaded(
    bytes: Uint8Array,
    sha256: string,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult> {
    try {
      onProgress?.(8, '校验下载完整性…');
      const actual = await sha256Hex(bytes);
      if (actual.toLowerCase() !== sha256.toLowerCase()) {
        return { ok: false, errorCode: 'ARTICLE_DOWNLOAD_CHECKSUM_MISMATCH', message: '下载校验失败' };
      }
      return await this.install(bytes, false, 'BUNDLED', onProgress);
    } catch (e) {
      return failure(e);
    }
  }

  private async install(
    bytes: Uint8Array,
    bundled: boolean,
    source: string,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult> {
    onProgress?.(15, '校验文章包…');
    const pack = await validateArticlePackage(bytes);
    onProgress?.(40, '写入文章…');
    await requestPersistentStorage();
    const now = Date.now();

    await db.transaction(
      'rw',
      [db.articles, db.audioFileIndex, db.audioBlobs, db.meta],
      async () => {
        if (bundled) {
          const old = await db.articles.where('source').equals('BUNDLED').toArray();
          for (const a of old) {
            const idx = await db.audioFileIndex.get(a.audioAssetId);
            if (idx) {
              await db.audioBlobs.delete(idx.localKey);
              await db.audioFileIndex.delete(a.audioAssetId);
            }
            await db.articles.delete(a.id);
          }
        }

        for (const article of pack.manifest.articles) {
          const audioAssetId = `article-${article.id}`;
          const audio = pack.files.get(article.audioFile);
          if (!audio) throw new Error('ARTICLE_AUDIO_MISSING');
          const localKey = `article/${article.id}`;
          await putAudioBlob(localKey, audio, 'audio/mp4');
          await db.audioFileIndex.put({
            assetId: audioAssetId,
            localKey,
            source: bundled ? 'BUNDLED_ARTICLE' : 'ARTICLE',
          });
          await db.articles.put({
            id: article.id,
            title: article.title,
            titleZh: article.titleZh,
            topic: article.topic,
            paragraphsJson: JSON.stringify(article.paragraphs),
            audioAssetId,
            durationMs: article.durationMs,
            source,
            contentScope: article.contentScope,
            contentHash: article.contentHash,
            createdAtEpochMs: now,
          });
        }

        if (bundled) {
          await setMeta('articles_bundled_version', pack.manifest.contentVersion);
        }
      },
    );

    onProgress?.(100, bundled ? '内置文章已激活' : '文章包已导入');
    return {
      ok: true,
      errorCode: null,
      message: bundled ? '内置文章已恢复' : '文章包已导入',
    };
  }

  private mapArticle(
    a: {
      id: string;
      title: string;
      titleZh: string;
      topic: string;
      paragraphsJson: string;
      audioAssetId: string;
      durationMs: number;
      source: string;
      contentScope: string;
      contentHash: string;
    },
    progress?: { lastPositionMs: number; completedAtEpochMs: number | null },
  ): Article {
    return {
      id: a.id,
      title: a.title,
      titleZh: a.titleZh,
      topic: a.topic,
      paragraphs: JSON.parse(a.paragraphsJson) as Article['paragraphs'],
      audioAssetId: a.audioAssetId,
      durationMs: a.durationMs,
      source: a.source,
      contentScope: a.contentScope,
      contentHash: a.contentHash,
      lastPositionMs: progress?.lastPositionMs ?? 0,
      completed: progress?.completedAtEpochMs != null,
    };
  }
}
