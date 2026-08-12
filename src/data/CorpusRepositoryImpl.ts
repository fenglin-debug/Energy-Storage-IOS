import type {
  CorpusImportEvent,
  CorpusImportPreview,
  OperationResult,
} from '@/domain/Models';
import type { CorpusRepository } from '@/domain/Repositories';
import { loadBundledBytes, requestPersistentStorage } from './BundledLoader';
import { sha256Hex } from './Crypto';
import {
  db,
  getMeta,
  setMeta,
  type DialoguePairRow,
  type DialogueTurnRow,
  type ExampleRow,
  type PhraseRow,
  type ScenarioRow,
  type VocabularyEntryRow,
} from './Database';
import { putAudioBlob } from './AudioStore';
import { validateCorpusPackage } from './PackageValidator';
import type { ValidatedCorpus } from './PackageModels';

interface PreviewEntry {
  pack: ValidatedCorpus;
  bundled: boolean;
}

function failure(error: unknown): OperationResult {
  const raw = String(error);
  const code = raw.replace(/^Error:\s*/, '').split(':')[0] ?? 'CORPUS_IMPORT_FAILED';
  return {
    ok: false,
    errorCode: code,
    message: `语料操作失败（${code}）`,
  };
}

export class CorpusRepositoryImpl implements CorpusRepository {
  private previews = new Map<string, PreviewEntry>();

  async activeVersion(): Promise<string | null> {
    return getMeta('active_corpus_content_version');
  }

  /**
   * Phase 1 — validate and preview. The package bytes stay in memory only;
   * nothing is written to the database until activatePreview() succeeds.
   */
  async inspectPackage(file: File): Promise<CorpusImportPreview | OperationResult> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const pack = await validateCorpusPackage(bytes);
      const previewId = `preview-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`;
      this.previews.set(previewId, { pack, bundled: false });

      const activeKey = await getMeta('active_corpus_package_key');
      const activeVer = await getMeta('active_corpus_content_version');
      const packageKey = `${pack.manifest.packageId}:${pack.manifest.contentVersion}`;
      const c = pack.manifest.counts;
      const [vocabSessions, scenarioSessions] = await Promise.all([
        db.vocabCheckpoints.where('status').equals('IN_PROGRESS').count(),
        db.scenarioSessions.where('status').equals('IN_PROGRESS').count(),
      ]);

      return {
        previewId,
        packageKey,
        contentVersion: pack.manifest.contentVersion,
        schemaVersion: pack.manifest.schemaVersion,
        counts: {
          vocabulary: c.vocabulary,
          phrases: c.phrases,
          examples: c.examples,
          scenarios: c.scenarios,
          dialogueTurns: c.dialogueTurns,
          dialoguePairs: c.dialoguePairs,
          audioAssets: c.audioAssets,
        },
        totalSizeBytes: bytes.byteLength,
        audioCount: pack.audioAssets.length,
        activeContentVersion: activeVer,
        replacesActive: activeKey !== null && activeKey !== packageKey,
        activeSessionImpact: {
          vocabularySessions: vocabSessions,
          scenarioSessions,
        },
      };
    } catch (e) {
      return failure(e);
    }
  }

  /**
   * Phase 2 — activate a previewed package inside a single transaction.
   * Any failure rolls the whole transaction back; old corpus, learning
   * memory and audio are untouched. A FAILED event is recorded on error.
   */
  async activatePreview(previewId: string): Promise<OperationResult> {
    const entry = this.previews.get(previewId);
    if (!entry) {
      return { ok: false, errorCode: 'PREVIEW_NOT_FOUND', message: '预览已失效，请重新选择文件' };
    }
    try {
      const result = await this.install(entry.pack, entry.bundled);
      this.previews.delete(previewId);
      return result;
    } catch (e) {
      this.previews.delete(previewId);
      await this.logEvent('CORPUS', 'FAILED', null, null, String(e).replace(/^Error:\s*/, ''));
      return failure(e);
    }
  }

  /**
   * Phase 3 — discard a preview without touching the database.
   */
  async discardPreview(previewId: string): Promise<void> {
    this.previews.delete(previewId);
  }

  /**
   * Activate a corpus package downloaded from the content catalog.
   * Verifies the SHA-256 before validating and installing; any failure
   * rolls back atomically and leaves old corpus/learning data untouched.
   */
  async activateDownloaded(
    bytes: Uint8Array,
    sha256: string,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult> {
    try {
      onProgress?.(8, '校验下载完整性…');
      const actual = await sha256Hex(bytes);
      if (actual.toLowerCase() !== sha256.toLowerCase()) {
        return { ok: false, errorCode: 'CORPUS_DOWNLOAD_CHECKSUM_MISMATCH', message: '下载校验失败' };
      }
      const pack = await validateCorpusPackage(bytes);
      return await this.install(pack, false, onProgress);
    } catch (e) {
      await this.logEvent('CORPUS', 'FAILED', null, null, String(e).replace(/^Error:\s*/, ''));
      return failure(e);
    }
  }

  async restoreBundled(
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult> {
    try {
      onProgress?.(5, '读取内置语料…');
      const bytes = await loadBundledBytes('bundled.besspack');
      const pack = await validateCorpusPackage(bytes);
      return await this.install(pack, true, onProgress);
    } catch (e) {
      return failure(e);
    }
  }

  async ensureBundledActivated(
    onProgress?: (p: number, msg: string) => void,
  ): Promise<void> {
    if ((await this.activeVersion()) !== null) return;
    const result = await this.restoreBundled(onProgress);
    if (!result.ok) throw new Error(result.errorCode ?? 'CORPUS_INSTALL_FAILED');
  }

  async listImportEvents(): Promise<CorpusImportEvent[]> {
    const rows = await db.corpusImportEvents.reverse().sortBy('createdAtEpochMs');
    return rows
      .map((r) => ({
        id: r.id,
        kind: r.kind,
        action: r.action as CorpusImportEvent['action'],
        packageKey: r.packageKey,
        contentVersion: r.contentVersion,
        createdAtEpochMs: r.createdAtEpochMs,
        detail: r.detail,
      }))
      .reverse();
  }

  private async install(
    pack: ValidatedCorpus,
    bundled: boolean,
    onProgress?: (p: number, msg: string) => void,
  ): Promise<OperationResult> {
    onProgress?.(10, '校验语料包…');
    onProgress?.(30, '写入学习库…');
    await requestPersistentStorage();
    const packageKey = `${pack.manifest.packageId}:${pack.manifest.contentVersion}`;
    const manifestHash = await sha256Hex(pack.files.get('manifest.json')!);

    await db.transaction(
      'rw',
      [
        db.vocabulary,
        db.phrases,
        db.examples,
        db.scenarios,
        db.dialogueTurns,
        db.dialoguePairs,
        db.pairWords,
        db.pairPhrases,
        db.audioAssets,
        db.audioFileIndex,
        db.audioBlobs,
        db.meta,
        db.vocabCheckpoints,
        db.scenarioSessions,
      ],
      async () => {
        // Replace content tables; keep learning memory tables.
        await db.pairWords.clear();
        await db.pairPhrases.clear();
        await db.dialoguePairs.clear();
        await db.dialogueTurns.clear();
        await db.scenarios.clear();
        await db.vocabulary.clear();
        await db.phrases.clear();
        await db.examples.clear();
        await db.audioAssets.clear();

        // Drop previous corpus audio blobs
        const oldIndex = await db.audioFileIndex.where('source').equals('CORPUS').toArray();
        for (const row of oldIndex) {
          await db.audioBlobs.delete(row.localKey);
          await db.audioFileIndex.delete(row.assetId);
        }

        await this.insertContent(pack);

        await setMeta('active_corpus_package_key', packageKey);
        await setMeta('active_corpus_content_version', pack.manifest.contentVersion);
        await setMeta('active_corpus_bundled', bundled ? '1' : '0');
        await setMeta('active_corpus_manifest_sha256', manifestHash);

        const now = Date.now();
        await db.vocabCheckpoints
          .where('status')
          .equals('IN_PROGRESS')
          .modify((cp) => {
            if (cp.corpusVersion !== pack.manifest.contentVersion) {
              cp.status = 'EXPIRED';
              cp.updatedAtEpochMs = now;
            }
          });
        await db.scenarioSessions
          .where('status')
          .equals('IN_PROGRESS')
          .modify((s) => {
            s.status = 'ABORTED_CORPUS_CHANGED';
            s.updatedAtEpochMs = now;
          });
      },
    );

    await this.logEvent(
      'CORPUS',
      bundled ? 'RESTORED' : 'ACTIVATED',
      packageKey,
      pack.manifest.contentVersion,
      null,
    );

    onProgress?.(100, bundled ? '内置语料已激活' : '语料包已导入');
    return {
      ok: true,
      errorCode: null,
      message: bundled ? '内置语料已恢复' : '语料包已导入',
    };
  }

  private async insertContent(pack: ValidatedCorpus): Promise<void> {
    const vocabRows: VocabularyEntryRow[] = pack.vocabulary.map((item) => ({
      id: item.id,
      term: item.term,
      normalizedTerm: item.normalizedTerm,
      ipa: item.ipa,
      partOfSpeech: item.partOfSpeech ?? '',
      chineseGloss: item.chineseGloss,
      englishDefinition: item.englishDefinition ?? null,
      collocationsJson: JSON.stringify(item.collocations ?? []),
      exampleSentenceEn: item.exampleSentenceEn,
      exampleSentenceZh: item.exampleSentenceZh ?? null,
      commonMistakes: item.commonMistakes,
      topic: item.topic,
      scenarioTagsJson: JSON.stringify(item.scenarioTags ?? []),
      cefrLevel: item.cefrLevel,
      wordAudioAssetId: item.wordAudioAssetId,
      exampleAudioAssetId: item.exampleAudioAssetId,
      contentSource: item.contentSource ?? 'CORE',
      contentHash: item.contentHash,
      active: 1,
    }));
    await db.vocabulary.bulkPut(vocabRows);

    const phraseRows: PhraseRow[] = pack.phrases.map((item) => ({
      id: item.id,
      industry: item.industry ?? '',
      scene: item.scene ?? '',
      category: item.category ?? '',
      textEn: item.textEn,
      textZh: item.textZh,
      linkedTermIdsJson: JSON.stringify(item.linkedTermIds ?? []),
      sourceType: item.sourceType ?? '',
      audioAssetId: item.audioAssetId,
      contentHash: item.contentHash,
      active: 1,
    }));
    await db.phrases.bulkPut(phraseRows);

    const exampleRows: ExampleRow[] = pack.examples.map((item) => ({
      id: item.id,
      industry: item.industry ?? '',
      scene: item.scene ?? '',
      speaker: item.speaker ?? '',
      textEn: item.textEn,
      textZh: item.textZh ?? '',
      linkedTermIdsJson: JSON.stringify(item.linkedTermIds ?? []),
      dialogueGroupId: item.dialogueGroupId ?? null,
      sourceType: item.sourceType ?? '',
      audioAssetId: item.audioAssetId,
      contentHash: item.contentHash,
      active: 1,
    }));
    await db.examples.bulkPut(exampleRows);

    const scenarioRows: ScenarioRow[] = pack.scenarios.map((item) => ({
      id: item.id,
      title: item.title,
      topic: item.topic,
      salesStage: item.salesStage,
      customerRole: item.customerRole,
      difficulty: item.difficulty,
      projectType: item.projectType,
      estimatedMinutes: item.estimatedMinutes,
      description: item.description ?? null,
      contentHash: item.contentHash,
      active: 1,
    }));
    await db.scenarios.bulkPut(scenarioRows);

    const turnRows: DialogueTurnRow[] = pack.turns.map((item) => ({
      id: item.id,
      scenarioId: item.scenarioId,
      turnNo: item.turnNo,
      speaker: item.speaker,
      textEn: item.textEn,
      textZh: item.textZh ?? null,
      hint: item.hint ?? null,
      audioAssetId: item.audioAssetId ?? null,
      contentHash: item.contentHash,
    }));
    await db.dialogueTurns.bulkPut(turnRows);

    const pairRows: DialoguePairRow[] = pack.pairs.map((item) => ({
      id: item.id,
      scenarioId: item.scenarioId,
      pairIndex: item.pairIndex,
      customerTurnId: item.customerTurnId,
      salesTurnId: item.salesTurnId,
      referenceCoreEn: item.referenceCoreEn,
      referenceChineseHint: item.referenceChineseHint,
      formalAlternativesJson: JSON.stringify(item.formalAlternatives ?? []),
      scoringPointsJson: JSON.stringify(item.scoringPoints ?? []),
      riskNote: item.riskNote ?? null,
      contentHash: item.contentHash,
    }));
    await db.dialoguePairs.bulkPut(pairRows);

    await db.pairWords.bulkPut(
      pack.pairWords.map((p) => ({
        pairId: p.pairId,
        wordId: p.wordId,
        sortOrder: p.sortOrder ?? 0,
      })),
    );
    await db.pairPhrases.bulkPut(
      pack.pairPhrases.map((p) => ({
        pairId: p.pairId,
        phraseId: p.phraseId,
        sortOrder: p.sortOrder ?? 0,
      })),
    );

    await db.audioAssets.bulkPut(
      pack.audioAssets.map((a) => ({
        id: a.id,
        kind: a.kind,
        relativePath: a.relativePath,
        sha256: a.sha256,
        mimeType: a.mimeType ?? 'audio/mp4',
        codec: a.codec ?? 'aac-lc',
        durationMs: a.durationMs,
        sizeBytes: a.sizeBytes,
      })),
    );

    // Store audio blobs in batches to limit peak memory churn
    const batchSize = 40;
    for (let i = 0; i < pack.audioAssets.length; i += batchSize) {
      const slice = pack.audioAssets.slice(i, i + batchSize);
      await Promise.all(
        slice.map(async (asset) => {
          const data = pack.files.get(asset.relativePath);
          if (!data) throw new Error(`AUDIO_MISSING:${asset.relativePath}`);
          const localKey = `corpus/${asset.id}`;
          await putAudioBlob(localKey, data, asset.mimeType ?? 'audio/mp4');
          await db.audioFileIndex.put({
            assetId: asset.id,
            localKey,
            source: 'CORPUS',
          });
        }),
      );
    }
  }

  private async logEvent(
    kind: 'CORPUS' | 'ARTICLE',
    action: 'ACTIVATED' | 'FAILED' | 'RESTORED',
    packageKey: string | null,
    contentVersion: string | null,
    detail: string | null,
  ): Promise<void> {
    await db.corpusImportEvents.put({
      id: `evt-${Date.now()}-${Math.floor(Math.random() * 1_000_000_000)}`,
      kind,
      action,
      packageKey,
      contentVersion,
      createdAtEpochMs: Date.now(),
      detail,
    });
  }
}
