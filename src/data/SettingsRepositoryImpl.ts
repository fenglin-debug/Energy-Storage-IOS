import { DEFAULT_SETTINGS, type AppSettings } from '@/domain/Models';
import type { SettingsRepository } from '@/domain/Repositories';
import { db } from './Database';

export class SettingsRepositoryImpl implements SettingsRepository {
  async get(): Promise<AppSettings> {
    const row = await db.settings.get(1);
    if (!row) return { ...DEFAULT_SETTINGS };
    try {
      return { ...DEFAULT_SETTINGS, ...(JSON.parse(row.json) as AppSettings) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  async save(settings: AppSettings): Promise<void> {
    const next: AppSettings = {
      ...DEFAULT_SETTINGS,
      ...settings,
      dailyNewWordTarget: Math.min(50, Math.max(1, Math.floor(settings.dailyNewWordTarget))),
      playbackSpeed: [0.85, 1.0, 1.15].includes(settings.playbackSpeed)
        ? settings.playbackSpeed
        : 1.0,
    };
    await db.settings.put({ id: 1, json: JSON.stringify(next) });
  }
}
