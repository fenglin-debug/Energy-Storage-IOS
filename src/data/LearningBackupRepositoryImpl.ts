import {
  APP_VERSION_CODE,
  APP_VERSION_NAME,
  DATABASE_VERSION,
  type AppSupportInfo,
  type LearningBackupCounts,
  type LearningBackupInspection,
  type OperationResult,
} from '@/domain/Models';
import type { LearningBackupRepository } from '@/domain/Repositories';
import {
  decryptAesGcm,
  encryptAesGcm,
  fromBase64,
  randomBytes,
  sha256Hex,
  toBase64,
  utf8,
  utf8String,
  DEFAULT_ITERATIONS,
} from './Crypto';
import { db, getMeta } from './Database';
import { storageEstimateText } from './BundledLoader';
import { unzipToMap, zipFromMap } from './Zip';
import type { SettingsRepositoryImpl } from './SettingsRepositoryImpl';

const NONE = 'NONE_SHA256';
const ENCRYPTED = 'AES_256_GCM_PBKDF2_HMAC_SHA256';
const JVM_LONG_MAX_TEXT = '9223372036854775807';

interface LearningBackupPayload {
  wordMemoryStates: unknown[];
  reviewLogs: unknown[];
  vocabularyCheckpoints: unknown[];
  reviewActionKeys: unknown[];
  scenarioSessions: unknown[];
  scenarioTurnProgress: unknown[];
  studyTasks: unknown[];
  itemMemoryStates: unknown[];
  articleProgress: unknown[];
}

interface LearningBackupHeader {
  formatVersion: number;
  createdAtEpochMs: number;
  appVersionName: string;
  appVersionCode: number;
  databaseVersion: number;
  corpusPackageKey: string | null;
  corpusContentVersion: string | null;
  encrypted: boolean;
  algorithm: string;
  kdfIterations: number | null;
  saltBase64: string | null;
  nonceBase64: string | null;
  payloadSha256: string;
  counts: LearningBackupCounts;
}

interface PreviewCache {
  payload: LearningBackupPayload;
  header: LearningBackupHeader;
}

/**
 * Field-level schema for each backed-up table. Untrusted backup JSON is
 * sanitized through this before being written to IndexedDB, so a malicious
 * or corrupted .bessbackup cannot inject arbitrary keys / oversized values
 * / prototype-polluting fields into learning rows. A row whose primary key
 * is missing or the wrong type is dropped entirely; other type mismatches
 * fall back to a safe default so the row still imports.
 */
type FieldType = 'string' | 'number' | 'boolean';
interface FieldSpec {
  name: string;
  type: FieldType;
  /** primary key — rows without a valid value here are dropped */
  pk?: boolean;
}

const SCHEMA: Record<keyof LearningBackupPayload, FieldSpec[]> = {
  wordMemoryStates: [
    { name: 'wordId', type: 'string', pk: true },
    { name: 'fsrsState', type: 'string' },
    { name: 'difficulty', type: 'number' },
    { name: 'stability', type: 'number' },
    { name: 'dueAtEpochMs', type: 'number' },
    { name: 'lastReviewAtEpochMs', type: 'number' },
    { name: 'reps', type: 'number' },
    { name: 'lapses', type: 'number' },
    { name: 'masteredUi', type: 'number' },
    { name: 'lastQuestionMode', type: 'string' },
    { name: 'isFavorite', type: 'number' },
    { name: 'learnedContentHash', type: 'string' },
    { name: 'legacyNormalizedTerm', type: 'string' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
  reviewLogs: [
    { name: 'id', type: 'string', pk: true },
    { name: 'wordId', type: 'string' },
    { name: 'rating', type: 'string' },
    { name: 'questionMode', type: 'string' },
    { name: 'usedHint', type: 'number' },
    { name: 'revealedAnswer', type: 'number' },
    { name: 'reviewedAtEpochMs', type: 'number' },
    { name: 'responseTimeMs', type: 'number' },
    { name: 'scheduledDays', type: 'number' },
    { name: 'elapsedDays', type: 'number' },
    { name: 'stateBefore', type: 'string' },
    { name: 'stateAfter', type: 'string' },
  ],
  vocabularyCheckpoints: [
    { name: 'sessionId', type: 'string', pk: true },
    { name: 'status', type: 'string' },
    { name: 'corpusVersion', type: 'string' },
    { name: 'queueWordIdsJson', type: 'string' },
    { name: 'currentIndex', type: 'number' },
    { name: 'questionMode', type: 'string' },
    { name: 'answerRevealed', type: 'number' },
    { name: 'hintRevealed', type: 'number' },
    { name: 'assessmentSubmitted', type: 'number' },
    { name: 'selectedAssessment', type: 'string' },
    { name: 'startedAtEpochMs', type: 'number' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
  reviewActionKeys: [
    { name: 'actionKey', type: 'string', pk: true },
    { name: 'sessionId', type: 'string' },
    { name: 'currentIndex', type: 'number' },
    { name: 'createdAtEpochMs', type: 'number' },
  ],
  scenarioSessions: [
    { name: 'id', type: 'string', pk: true },
    { name: 'scenarioId', type: 'string' },
    { name: 'scenarioContentHash', type: 'string' },
    { name: 'status', type: 'string' },
    { name: 'currentPairId', type: 'string' },
    { name: 'currentPairIndex', type: 'number' },
    { name: 'pairCount', type: 'number' },
    { name: 'practiceMode', type: 'string' },
    { name: 'queuePairIdsJson', type: 'string' },
    { name: 'startedAtEpochMs', type: 'number' },
    { name: 'completedAtEpochMs', type: 'number' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
  scenarioTurnProgress: [
    { name: 'sessionId', type: 'string', pk: true },
    { name: 'pairId', type: 'string', pk: true },
    { name: 'customerAudioCompleted', type: 'number' },
    { name: 'customerTextRevealed', type: 'number' },
    { name: 'keywordsRevealed', type: 'number' },
    { name: 'answerRevealed', type: 'number' },
    { name: 'selfRating', type: 'string' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
  studyTasks: [
    { name: 'dateEpochDay', type: 'number', pk: true },
    { name: 'newWordTarget', type: 'number' },
    { name: 'newWordDone', type: 'number' },
    { name: 'reviewTarget', type: 'number' },
    { name: 'reviewDone', type: 'number' },
    { name: 'recommendedScenarioId', type: 'string' },
    { name: 'studySeconds', type: 'number' },
    { name: 'completed', type: 'number' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
  itemMemoryStates: [
    { name: 'itemId', type: 'string', pk: true },
    { name: 'itemType', type: 'string', pk: true },
    { name: 'fsrsState', type: 'string' },
    { name: 'difficulty', type: 'number' },
    { name: 'stability', type: 'number' },
    { name: 'dueAtEpochMs', type: 'number' },
    { name: 'lastReviewAtEpochMs', type: 'number' },
    { name: 'reps', type: 'number' },
    { name: 'lapses', type: 'number' },
    { name: 'masteredUi', type: 'number' },
    { name: 'learnedContentHash', type: 'string' },
    { name: 'updatedAtEpochMs', type: 'number' },
    { name: 'isFavorite', type: 'number' },
  ],
  articleProgress: [
    { name: 'articleId', type: 'string', pk: true },
    { name: 'lastPositionMs', type: 'number' },
    { name: 'listenCount', type: 'number' },
    { name: 'completedAtEpochMs', type: 'number' },
    { name: 'updatedAtEpochMs', type: 'number' },
  ],
};

const FIELD_DEFAULTS: Record<FieldType, unknown> = {
  string: '',
  number: 0,
  boolean: false,
};

function sanitizeRow(raw: unknown, fields: FieldSpec[]): Record<string, unknown> | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const src = raw as Record<string, unknown>;
  // Primary keys must all be present and correctly typed; otherwise drop the row.
  for (const f of fields) {
    if (!f.pk) continue;
    if (typeof src[f.name] !== f.type) return null;
  }
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    const v = src[f.name];
    out[f.name] = typeof v === f.type ? v : FIELD_DEFAULTS[f.type];
  }
  return out;
}

function sanitizeTable(raw: unknown, fields: FieldSpec[]): unknown[] {
  if (!Array.isArray(raw)) return [];
  const out: unknown[] = [];
  for (const item of raw) {
    const row = sanitizeRow(item, fields);
    if (row) out.push(row);
  }
  return out;
}

function sanitizePayload(payload: LearningBackupPayload): LearningBackupPayload {
  const out = {} as LearningBackupPayload;
  for (const key of Object.keys(SCHEMA) as (keyof typeof SCHEMA)[]) {
    out[key] = sanitizeTable(payload[key], SCHEMA[key]);
  }
  return out;
}

export class LearningBackupRepositoryImpl implements LearningBackupRepository {
  private previews = new Map<string, PreviewCache>();

  constructor(private readonly settings: SettingsRepositoryImpl) {}

  async exportBackup(
    password?: string,
  ): Promise<{ ok: true; blob: Blob; fileName: string } | OperationResult> {
    try {
      const payload = await this.collectPayload();
      const metadata = {
        createdAtEpochMs: Date.now(),
        appVersionName: APP_VERSION_NAME,
        appVersionCode: APP_VERSION_CODE,
        databaseVersion: DATABASE_VERSION,
        corpusPackageKey: await getMeta('active_corpus_package_key'),
        corpusContentVersion: await getMeta('active_corpus_content_version'),
      };
      const bytes = await this.encode(payload, metadata, password);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy], { type: 'application/octet-stream' });
      const fileName = `bess-learning-${metadata.createdAtEpochMs}.bessbackup`;
      const s = await this.settings.get();
      await this.settings.save({ ...s, lastBackupAtEpochMs: metadata.createdAtEpochMs });
      return { ok: true, blob, fileName };
    } catch (e) {
      return {
        ok: false,
        errorCode: 'BACKUP_EXPORT_FAILED',
        message: String(e),
      };
    }
  }

  async inspectBackup(
    file: File,
    password?: string,
  ): Promise<LearningBackupInspection | OperationResult> {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = await this.decode(bytes, password);
      const previewId = `preview-${Date.now()}`;
      this.previews.set(previewId, decoded);
      const activeKey = await getMeta('active_corpus_package_key');
      const activeVer = await getMeta('active_corpus_content_version');
      return {
        previewId,
        createdAtEpochMs: decoded.header.createdAtEpochMs,
        appVersionName: decoded.header.appVersionName,
        appVersionCode: decoded.header.appVersionCode,
        databaseVersion: decoded.header.databaseVersion,
        corpusPackageKey: decoded.header.corpusPackageKey,
        corpusContentVersion: decoded.header.corpusContentVersion,
        corpusMatches:
          decoded.header.corpusPackageKey === activeKey &&
          decoded.header.corpusContentVersion === activeVer,
        encrypted: decoded.header.encrypted,
        counts: decoded.header.counts,
      };
    } catch (e) {
      const raw = String(e).replace(/^Error:\s*/, '');
      return {
        ok: false,
        errorCode: raw.split(':')[0] ?? 'BACKUP_INSPECT_FAILED',
        message: raw,
      };
    }
  }

  async restoreBackup(previewId: string): Promise<OperationResult> {
    const preview = this.previews.get(previewId);
    if (!preview) {
      return { ok: false, errorCode: 'PREVIEW_NOT_FOUND', message: '预览已失效' };
    }
    try {
      const p = preview.payload;
      await db.transaction(
        'rw',
        [
          db.wordMemory,
          db.reviewLogs,
          db.vocabCheckpoints,
          db.reviewActionKeys,
          db.scenarioSessions,
          db.scenarioProgress,
          db.studyTasks,
          db.itemMemory,
          db.articleProgress,
        ],
        async () => {
          await db.wordMemory.clear();
          await db.reviewLogs.clear();
          await db.vocabCheckpoints.clear();
          await db.reviewActionKeys.clear();
          await db.scenarioSessions.clear();
          await db.scenarioProgress.clear();
          await db.studyTasks.clear();
          await db.itemMemory.clear();
          await db.articleProgress.clear();

          // Restore with best-effort shape mapping from wire format
          await db.wordMemory.bulkPut(p.wordMemoryStates as never[]);
          await db.reviewLogs.bulkPut(p.reviewLogs as never[]);
          await db.vocabCheckpoints.bulkPut(p.vocabularyCheckpoints as never[]);
          await db.reviewActionKeys.bulkPut(p.reviewActionKeys as never[]);
          await db.scenarioSessions.bulkPut(p.scenarioSessions as never[]);
          await db.scenarioProgress.bulkPut(p.scenarioTurnProgress as never[]);
          await db.studyTasks.bulkPut(p.studyTasks as never[]);
          await db.itemMemory.bulkPut(p.itemMemoryStates as never[]);
          await db.articleProgress.bulkPut(p.articleProgress as never[]);
        },
      );
      this.previews.delete(previewId);
      return { ok: true, errorCode: null, message: '学习进度已恢复' };
    } catch (e) {
      return {
        ok: false,
        errorCode: 'BACKUP_RESTORE_FAILED',
        message: String(e),
      };
    }
  }

  async discardPreview(previewId: string): Promise<void> {
    this.previews.delete(previewId);
  }

  async getSupportInfo(): Promise<AppSupportInfo> {
    const counts = await this.countAll();
    const settings = await this.settings.get();
    let persisted = false;
    try {
      if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
        persisted = await navigator.storage.persisted();
      }
    } catch {
      /* ignore */
    }
    return {
      appVersionName: APP_VERSION_NAME,
      appVersionCode: APP_VERSION_CODE,
      databaseVersion: DATABASE_VERSION,
      corpusPackageKey: await getMeta('active_corpus_package_key'),
      corpusContentVersion: await getMeta('active_corpus_content_version'),
      recordCounts: counts,
      lastBackupAtEpochMs: settings.lastBackupAtEpochMs,
      lastErrorCode: await getMeta('last_error_code'),
      storageEstimate: await storageEstimateText(),
      storagePersisted: persisted,
      swVersion: await getMeta('sw_version'),
    };
  }

  async exportDiagnostics(): Promise<
    { ok: true; blob: Blob; fileName: string } | OperationResult
  > {
    try {
      const info = await this.getSupportInfo();
      const payload: Record<string, unknown> = {
        exportedAtEpochMs: Date.now(),
        appVersionName: info.appVersionName,
        appVersionCode: info.appVersionCode,
        databaseVersion: info.databaseVersion,
        corpusPackageKey: info.corpusPackageKey,
        corpusContentVersion: info.corpusContentVersion,
        storageEstimate: info.storageEstimate,
        storagePersisted: info.storagePersisted,
        swVersion: info.swVersion,
        lastErrorCode: info.lastErrorCode,
        lastBackupAtEpochMs: info.lastBackupAtEpochMs,
        recordCounts: info.recordCounts,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown',
        displayMode:
          typeof window !== 'undefined' &&
          window.matchMedia('(display-mode: standalone)').matches
            ? 'standalone'
            : 'browser',
      };
      const blob = new Blob([JSON.stringify(payload, null, 2)], {
        type: 'application/json',
      });
      const fileName = `bess-diagnostics-${Date.now()}.json`;
      return { ok: true, blob, fileName };
    } catch (e) {
      return {
        ok: false,
        errorCode: 'DIAGNOSTICS_EXPORT_FAILED',
        message: String(e),
      };
    }
  }

  private async collectPayload(): Promise<LearningBackupPayload> {
    return {
      wordMemoryStates: await db.wordMemory.toArray(),
      reviewLogs: await db.reviewLogs.toArray(),
      vocabularyCheckpoints: await db.vocabCheckpoints.toArray(),
      reviewActionKeys: await db.reviewActionKeys.toArray(),
      scenarioSessions: await db.scenarioSessions.toArray(),
      scenarioTurnProgress: await db.scenarioProgress.toArray(),
      studyTasks: await db.studyTasks.toArray(),
      itemMemoryStates: await db.itemMemory.toArray(),
      articleProgress: await db.articleProgress.toArray(),
    };
  }

  private counts(payload: LearningBackupPayload): LearningBackupCounts {
    return {
      wordMemoryStates: payload.wordMemoryStates.length,
      reviewLogs: payload.reviewLogs.length,
      vocabularyCheckpoints: payload.vocabularyCheckpoints.length,
      reviewActionKeys: payload.reviewActionKeys.length,
      scenarioSessions: payload.scenarioSessions.length,
      scenarioTurnProgress: payload.scenarioTurnProgress.length,
      studyTasks: payload.studyTasks.length,
      itemMemoryStates: payload.itemMemoryStates.length,
      articleProgress: payload.articleProgress.length,
    };
  }

  private async countAll(): Promise<LearningBackupCounts> {
    return {
      wordMemoryStates: await db.wordMemory.count(),
      reviewLogs: await db.reviewLogs.count(),
      vocabularyCheckpoints: await db.vocabCheckpoints.count(),
      reviewActionKeys: await db.reviewActionKeys.count(),
      scenarioSessions: await db.scenarioSessions.count(),
      scenarioTurnProgress: await db.scenarioProgress.count(),
      studyTasks: await db.studyTasks.count(),
      itemMemoryStates: await db.itemMemory.count(),
      articleProgress: await db.articleProgress.count(),
    };
  }

  private async encode(
    payload: LearningBackupPayload,
    metadata: {
      createdAtEpochMs: number;
      appVersionName: string;
      appVersionCode: number;
      databaseVersion: number;
      corpusPackageKey: string | null;
      corpusContentVersion: string | null;
    },
    password?: string,
  ): Promise<Uint8Array> {
    const counts = this.counts(payload);
    let payloadJson = JSON.stringify(payload);
    payloadJson = payloadJson.replace(
      /"dueAtEpochMs":9007199254740991/g,
      `"dueAtEpochMs":${JVM_LONG_MAX_TEXT}`,
    );
    const plain = utf8(payloadJson);
    const useEncryption = !!password && password.length > 0;
    let header: LearningBackupHeader;
    let storedPayload: Uint8Array;

    if (useEncryption) {
      const salt = randomBytes(16);
      const nonce = randomBytes(12);
      header = {
        formatVersion: 1,
        createdAtEpochMs: metadata.createdAtEpochMs,
        appVersionName: metadata.appVersionName,
        appVersionCode: metadata.appVersionCode,
        databaseVersion: metadata.databaseVersion,
        corpusPackageKey: metadata.corpusPackageKey,
        corpusContentVersion: metadata.corpusContentVersion,
        encrypted: true,
        algorithm: ENCRYPTED,
        kdfIterations: DEFAULT_ITERATIONS,
        saltBase64: toBase64(salt),
        nonceBase64: toBase64(nonce),
        payloadSha256: '',
        counts,
      };
      const aad = utf8(JSON.stringify({ ...header, payloadSha256: '' }));
      storedPayload = await encryptAesGcm(
        plain,
        password!,
        salt,
        nonce,
        DEFAULT_ITERATIONS,
        aad,
      );
    } else {
      header = {
        formatVersion: 1,
        createdAtEpochMs: metadata.createdAtEpochMs,
        appVersionName: metadata.appVersionName,
        appVersionCode: metadata.appVersionCode,
        databaseVersion: metadata.databaseVersion,
        corpusPackageKey: metadata.corpusPackageKey,
        corpusContentVersion: metadata.corpusContentVersion,
        encrypted: false,
        algorithm: NONE,
        kdfIterations: null,
        saltBase64: null,
        nonceBase64: null,
        payloadSha256: '',
        counts,
      };
      storedPayload = plain;
    }
    header.payloadSha256 = await sha256Hex(storedPayload);
    const entries = new Map<string, Uint8Array>();
    entries.set('manifest.json', utf8(JSON.stringify(header)));
    entries.set('learning-data.bin', storedPayload);
    return zipFromMap(entries);
  }

  private async decode(
    bytes: Uint8Array,
    password?: string,
  ): Promise<PreviewCache> {
    const files = unzipToMap(bytes);
    const headerBytes = files.get('manifest.json');
    const storedPayload = files.get('learning-data.bin');
    if (!headerBytes || !storedPayload) throw new Error('INVALID_BACKUP');
    const header = JSON.parse(utf8String(headerBytes)) as LearningBackupHeader;
    if (header.formatVersion !== 1) throw new Error('UNSUPPORTED_BACKUP_VERSION');
    const digest = await sha256Hex(storedPayload);
    if (digest.toLowerCase() !== header.payloadSha256.toLowerCase()) {
      throw new Error('WRONG_PASSWORD_OR_DAMAGED');
    }
    let plain: Uint8Array;
    if (header.encrypted) {
      if (!password) throw new Error('PASSWORD_REQUIRED');
      const aadHeader = {
        ...header,
        payloadSha256: '',
      };
      plain = await decryptAesGcm(
        storedPayload,
        password,
        fromBase64(header.saltBase64!),
        fromBase64(header.nonceBase64!),
        header.kdfIterations ?? DEFAULT_ITERATIONS,
        utf8(JSON.stringify(aadHeader)),
      );
    } else {
      plain = storedPayload;
    }
    let json = utf8String(plain);
    json = json.replace(new RegExp(`"dueAtEpochMs":${JVM_LONG_MAX_TEXT}`, 'g'), '"dueAtEpochMs":9007199254740991');
    const rawPayload = JSON.parse(json) as LearningBackupPayload;
    // Sanitize before anything is stored: strip unknown keys, coerce types,
    // drop rows missing primary keys. Defends against malicious / corrupted
    // .bessbackup files polluting the local learning database.
    const payload = sanitizePayload(rawPayload);
    return { header, payload };
  }
}
