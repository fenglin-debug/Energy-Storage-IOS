import type { AudioPlaybackRepository } from '@/domain/Repositories';
import type { PlaybackSnapshot } from '@/domain/Models';
import { getAudioObjectUrl } from './AudioStore';

type Listener = (snapshot: PlaybackSnapshot) => void;

export class AudioPlaybackRepositoryImpl implements AudioPlaybackRepository {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;
  private listeners = new Set<Listener>();
  private current: PlaybackSnapshot = {
    assetId: null,
    state: 'IDLE',
    positionMs: 0,
    durationMs: 0,
    speed: 1,
    errorCode: null,
  };

  snapshot(): PlaybackSnapshot {
    return { ...this.current };
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => {
      this.listeners.delete(listener);
    };
  }

  private emit(): void {
    const snap = this.snapshot();
    for (const l of this.listeners) l(snap);
  }

  private ensureAudio(): HTMLAudioElement {
    if (!this.audio) {
      this.audio = new Audio();
      this.audio.preload = 'auto';
      this.audio.addEventListener('timeupdate', () => {
        this.current.positionMs = Math.floor((this.audio?.currentTime ?? 0) * 1000);
        this.emit();
      });
      this.audio.addEventListener('loadedmetadata', () => {
        this.current.durationMs = Math.floor((this.audio?.duration ?? 0) * 1000);
        this.emit();
      });
      this.audio.addEventListener('ended', () => {
        this.current.state = 'COMPLETED';
        this.emit();
      });
      this.audio.addEventListener('error', () => {
        this.current.state = 'FAILED';
        this.current.errorCode = 'AUDIO_PLAYBACK_FAILED';
        this.emit();
      });
    }
    return this.audio;
  }

  async play(assetId: string, speed: number): Promise<void> {
    const url = await getAudioObjectUrl(assetId);
    if (!url) {
      this.current = {
        assetId,
        state: 'FAILED',
        positionMs: 0,
        durationMs: 0,
        speed,
        errorCode: 'AUDIO_NOT_FOUND',
      };
      this.emit();
      return;
    }
    if (this.objectUrl) URL.revokeObjectURL(this.objectUrl);
    this.objectUrl = url;
    const audio = this.ensureAudio();
    audio.src = url;
    audio.playbackRate = speed;
    this.current = {
      assetId,
      state: 'BUFFERING',
      positionMs: 0,
      durationMs: 0,
      speed,
      errorCode: null,
    };
    this.emit();
    try {
      await audio.play();
      this.current.state = 'PLAYING';
      this.emit();
    } catch {
      this.current.state = 'FAILED';
      this.current.errorCode = 'AUDIO_PLAY_BLOCKED';
      this.emit();
    }
  }

  async pause(): Promise<void> {
    this.audio?.pause();
    if (this.current.state === 'PLAYING' || this.current.state === 'BUFFERING') {
      this.current.state = 'PAUSED';
      this.emit();
    }
  }

  async resume(): Promise<void> {
    if (!this.audio) return;
    if (this.current.state !== 'PAUSED' && this.current.state !== 'BUFFERING') return;
    try {
      await this.audio.play();
      this.current.state = 'PLAYING';
      this.current.speed = this.audio.playbackRate;
      this.emit();
    } catch {
      this.current.state = 'FAILED';
      this.current.errorCode = 'AUDIO_PLAY_BLOCKED';
      this.emit();
    }
  }

  async seekTo(positionMs: number): Promise<void> {
    if (!this.audio) return;
    this.audio.currentTime = Math.max(0, positionMs / 1000);
    this.current.positionMs = positionMs;
    this.emit();
  }

  async stop(): Promise<void> {
    if (this.audio) {
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
    this.current = {
      assetId: null,
      state: 'IDLE',
      positionMs: 0,
      durationMs: 0,
      speed: 1,
      errorCode: null,
    };
    this.emit();
  }
}
