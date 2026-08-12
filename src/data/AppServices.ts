import { ArticleRepositoryImpl } from './ArticleRepositoryImpl';
import { AudioPlaybackRepositoryImpl } from './AudioPlaybackRepositoryImpl';
import { CorpusDownloader } from './CorpusDownloader';
import { CorpusRepositoryImpl } from './CorpusRepositoryImpl';
import { LearningBackupRepositoryImpl } from './LearningBackupRepositoryImpl';
import { ScenarioRepositoryImpl } from './ScenarioRepositoryImpl';
import { SettingsRepositoryImpl } from './SettingsRepositoryImpl';
import { VocabularyRepositoryImpl } from './VocabularyRepositoryImpl';
import type { StartupState } from '@/domain/Models';

const settings = new SettingsRepositoryImpl();
const vocabulary = new VocabularyRepositoryImpl(settings);
const scenario = new ScenarioRepositoryImpl(settings);
const article = new ArticleRepositoryImpl();
const corpus = new CorpusRepositoryImpl();
const audio = new AudioPlaybackRepositoryImpl();
const backup = new LearningBackupRepositoryImpl(settings);
const downloader = new CorpusDownloader(corpus, article);

export const appServices = {
  settings,
  vocabulary,
  scenario,
  article,
  corpus,
  audio,
  backup,
};

export async function runStartup(
  onUpdate: (state: StartupState) => void,
): Promise<void> {
  try {
    onUpdate({ phase: 'opening-db', progress: 5, message: '初始化本地数据库…', error: null });
    // Touch Dexie open
    await appServices.settings.get();

    // First launch: check storage, persist, then download SHA-versioned
    // corpus/article packages from the catalog (or bundled fallback).
    await downloader.run(onUpdate);

    onUpdate({ phase: 'ready', progress: 100, message: '就绪', error: null });
  } catch (e) {
    onUpdate({
      phase: 'error',
      progress: 0,
      message: '启动失败',
      error: String(e).replace(/^Error:\s*/, ''),
    });
  }
}
