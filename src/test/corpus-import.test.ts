import { beforeEach, describe, expect, it } from 'vitest';
import { CorpusRepositoryImpl } from '@/data/CorpusRepositoryImpl';
import { db, getMeta } from '@/data/Database';
import { buildTestCorpusPack, resetDb } from './helpers';

function fileOf(bytes: Uint8Array, name = 'x.besspack'): File {
  return new File([bytes as BlobPart], name, { type: 'application/zip' });
}

describe('CorpusRepository three-phase import', () => {
  let repo: CorpusRepositoryImpl;

  beforeEach(async () => {
    await resetDb();
    repo = new CorpusRepositoryImpl();
  });

  it('inspect → activate → event log, and replacesActive flags', async () => {
    const pack = buildTestCorpusPack('test.corpus.1');
    const inspect = await repo.inspectPackage(fileOf(pack));
    expect(inspect).not.toBeNull();
    if (!('previewId' in inspect)) throw new Error('expected preview');

    expect(inspect.contentVersion).toBe('test.corpus.1');
    expect(inspect.counts.vocabulary).toBe(0);
    expect(inspect.replacesActive).toBe(false);
    expect(inspect.activeContentVersion).toBeNull();

    const active = await repo.activatePreview(inspect.previewId);
    expect(active.ok).toBe(true);
    expect(await getMeta('active_corpus_content_version')).toBe('test.corpus.1');

    const events = await repo.listImportEvents();
    expect(events.length).toBe(1);
    expect(events[0]!.action).toBe('ACTIVATED');
    expect(events[0]!.contentVersion).toBe('test.corpus.1');
  });

  it('discardPreview invalidates the preview without touching the DB', async () => {
    const pack = buildTestCorpusPack('test.corpus.2');
    const inspect = await repo.inspectPackage(fileOf(pack));
    if (!('previewId' in inspect)) throw new Error('expected preview');

    await repo.discardPreview(inspect.previewId);
    const r = await repo.activatePreview(inspect.previewId);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('PREVIEW_NOT_FOUND');
    expect(await getMeta('active_corpus_content_version')).toBeNull();
    expect(await repo.listImportEvents()).toHaveLength(0);
  });

  it('invalid package fails inspection without any DB writes', async () => {
    const garbage = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00]); // broken zip
    const r = await repo.inspectPackage(fileOf(garbage, 'bad.besspack'));
    expect('ok' in r).toBe(true);
    if ('ok' in r) expect(r.ok).toBe(false);
    expect(await getMeta('active_corpus_content_version')).toBeNull();
  });

  it('download activation with wrong SHA keeps old corpus and logs nothing new', async () => {
    // Install v1 first
    const pack1 = buildTestCorpusPack('test.corpus.v1');
    const i1 = await repo.inspectPackage(fileOf(pack1));
    if (!('previewId' in i1)) throw new Error('expected preview');
    await repo.activatePreview(i1.previewId);
    expect(await getMeta('active_corpus_content_version')).toBe('test.corpus.v1');

    // activateDownloaded with a mismatched SHA must fail before any write
    const badSha = 'f'.repeat(64);
    const r = await repo.activateDownloaded(pack1, badSha);
    expect(r.ok).toBe(false);
    expect(r.errorCode).toBe('CORPUS_DOWNLOAD_CHECKSUM_MISMATCH');
    expect(await getMeta('active_corpus_content_version')).toBe('test.corpus.v1');

    const events = await repo.listImportEvents();
    // Only the v1 ACTIVATED event — the failed attempt never touched the DB.
    expect(events).toHaveLength(1);
    expect(events[0]!.action).toBe('ACTIVATED');
  });
});
