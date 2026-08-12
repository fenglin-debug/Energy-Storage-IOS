/**
 * Silent auto-update flow (registerType: 'prompt').
 * A newer service worker is skip-waited and the page reloaded automatically —
 * no banner, no user prompt. Learning data lives in IndexedDB and survives
 * the reload; in-progress sessions resume from their checkpoints.
 */
import { registerSW } from 'virtual:pwa-register';

type UpdateFn = (reloadPage?: boolean) => Promise<void>;

let updateSW: UpdateFn | null = null;

export function registerSilentUpdate(): void {
  updateSW = registerSW({
    immediate: true,
    onNeedRefresh() {
      // New SW is waiting: activate it and reload to serve the new version.
      void updateSW?.(true);
    },
    onOfflineReady() {
      // App shell cached for offline use — nothing to do.
    },
  });
}
