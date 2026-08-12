import { beforeEach, describe, expect, it } from 'vitest';
import { LearningBackupRepositoryImpl } from '@/data/LearningBackupRepositoryImpl';
import { SettingsRepositoryImpl } from '@/data/SettingsRepositoryImpl';
import { db } from '@/data/Database';
import { resetDb } from './helpers';

describe('LearningBackupRepository encrypt/restore round-trip', () => {
  let repo: LearningBackupRepositoryImpl;

  beforeEach(async () => {
    await resetDb();
    repo = new LearningBackupRepositoryImpl(new SettingsRepositoryImpl());
    await db.wordMemory.put({
      wordId: 'W-0001',
      fsrsState: 'REVIEW',
      difficulty: 3.1,
      stability: 12.4,
      dueAtEpochMs: 9007199254740991,
      lastReviewAtEpochMs: Date.now() - 1000,
      reps: 3,
      lapses: 1,
      masteredUi: 0,
      lastQuestionMode: 'EN2ZH',
      isFavorite: 1,
      learnedContentHash: 'h',
      legacyNormalizedTerm: null,
      updatedAtEpochMs: Date.now(),
    });
    await db.studyTasks.put({
      dateEpochDay: 20260,
      newWordTarget: 15,
      newWordDone: 3,
      reviewTarget: 0,
      reviewDone: 2,
      recommendedScenarioId: null,
      studySeconds: 600,
      completed: 0,
      updatedAtEpochMs: Date.now(),
    });
  });

  it('exports and restores encrypted backup with matching counts', async () => {
    const exported = await repo.exportBackup('secret-password');
    if (!('blob' in exported)) throw new Error('expected export success');
    expect(exported.fileName).toMatch(/\.bessbackup$/);

    const file = new File([exported.blob as BlobPart], exported.fileName);
    const inspected = await repo.inspectBackup(file, 'secret-password');
    if (!('previewId' in inspected)) throw new Error('expected inspection success');
    expect(inspected.encrypted).toBe(true);
    expect(inspected.counts.wordMemoryStates).toBe(1);
    expect(inspected.counts.studyTasks).toBe(1);

    // wipe and restore
    await db.wordMemory.clear();
    expect(await db.wordMemory.count()).toBe(0);

    const restored = await repo.restoreBackup(inspected.previewId);
    expect(restored.ok).toBe(true);
    expect(await db.wordMemory.count()).toBe(1);
    const row = await db.wordMemory.get('W-0001');
    expect(row?.stability).toBe(12.4);
    expect(row?.isFavorite).toBe(1);
  });

  it('rejects wrong password with WRONG_PASSWORD_OR_DAMAGED', async () => {
    const exported = await repo.exportBackup('right-password');
    if (!('blob' in exported)) throw new Error('expected export success');
    const file = new File([exported.blob as BlobPart], exported.fileName);
    const r = await repo.inspectBackup(file, 'wrong-password');
    if (!('ok' in r)) throw new Error('expected failure');
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('WRONG_PASSWORD_OR_DAMAGED');
  });

  it('exportDiagnostics returns JSON blob', async () => {
    const d = await repo.exportDiagnostics();
    if (!('blob' in d)) throw new Error('expected diagnostics success');
    expect(d.fileName).toMatch(/^bess-diagnostics-\d+\.json$/);
    const text = await d.blob.text();
    const parsed = JSON.parse(text) as { appVersionName: string; recordCounts?: { wordMemoryStates: number } };
    expect(parsed.appVersionName).toBeTruthy();
    expect(parsed.recordCounts?.wordMemoryStates).toBe(1);
  });
});
