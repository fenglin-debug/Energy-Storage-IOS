import { db } from './Database';

export async function putAudioBlob(
  key: string,
  data: Uint8Array,
  mimeType = 'audio/mp4',
): Promise<void> {
  const copy = new Uint8Array(data.byteLength);
  copy.set(data);
  const blob = new Blob([copy], { type: mimeType });
  await db.audioBlobs.put({ key, mimeType, blob });
}

export async function getAudioObjectUrl(assetId: string): Promise<string | null> {
  const index = await db.audioFileIndex.get(assetId);
  if (!index) return null;
  const row = await db.audioBlobs.get(index.localKey);
  if (!row) return null;
  return URL.createObjectURL(row.blob);
}

export async function deleteAudioBySource(
  source: 'CORPUS' | 'ARTICLE' | 'BUNDLED_ARTICLE',
): Promise<void> {
  const rows = await db.audioFileIndex.where('source').equals(source).toArray();
  await db.transaction('rw', db.audioFileIndex, db.audioBlobs, async () => {
    for (const row of rows) {
      await db.audioBlobs.delete(row.localKey);
      await db.audioFileIndex.delete(row.assetId);
    }
  });
}
