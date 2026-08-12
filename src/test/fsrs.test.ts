import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { FsrsScheduler, type FsrsCard } from '@/domain/Fsrs';
import { FsrsState, Rating } from '@/domain/Models';

const fixturePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  'fixtures/fsrs_golden.json',
);

const DAY_MS = 86_400_000;

interface GoldenStep {
  rating: string;
  elapsed_days: number;
  state: string;
  stability: number | null;
  difficulty: number | null;
  due_iso: string | null;
  step: number | null;
}

interface GoldenFixture {
  meta: {
    fsrs_version: string;
    desired_retention: number;
    parameters: number[];
    base_time: string;
  };
  [sequence: string]: unknown;
}

function ratingFrom(s: string): Rating {
  if (s === 'Again') return Rating.AGAIN;
  if (s === 'Hard') return Rating.HARD;
  if (s === 'Good') return Rating.GOOD;
  if (s === 'Easy') return Rating.EASY;
  throw new Error(`unknown rating ${s}`);
}

function stateFrom(s: string): FsrsState {
  if (s === 'Learning') return FsrsState.LEARNING;
  if (s === 'Review') return FsrsState.REVIEW;
  if (s === 'Relearning') return FsrsState.RELEARNING;
  if (s === 'New') return FsrsState.NEW;
  throw new Error(`unknown state ${s}`);
}

describe('FsrsScheduler golden vectors (py-fsrs 6.3.1 / Android)', () => {
  let raw: string;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch {
    it('skipped: fixture not prepared (run prepare-assets)', () => {
      expect(true).toBe(true);
    });
    return;
  }

  const fixture = JSON.parse(raw) as GoldenFixture;
  const baseMs = new Date(fixture.meta.base_time).getTime();
  const scheduler = new FsrsScheduler(fixture.meta.parameters, fixture.meta.desired_retention);

  const sequences = Object.entries(fixture).filter(([k, v]) => k !== 'meta' && Array.isArray(v));

  it(`validates ${sequences.length} golden sequences with real review times`, () => {
    expect(sequences.length).toBeGreaterThan(0);
    for (const [name, value] of sequences) {
      const steps = value as GoldenStep[];
      let card: FsrsCard = {
        state: FsrsState.NEW,
        step: null,
        stability: null,
        difficulty: null,
        dueAtEpochMs: baseMs,
        lastReviewAtEpochMs: null,
      };
      // py-fsrs golden: each step advances the clock by elapsed_days from the
      // previous review; the first step starts at base_time.
      let reviewAtEpochMs = baseMs;
      for (const step of steps) {
        reviewAtEpochMs += Math.max(0, step.elapsed_days) * DAY_MS;
        card = scheduler.review(card, ratingFrom(step.rating), reviewAtEpochMs);

        expect(card.state, `${name}: state`).toBe(stateFrom(step.state));
        expect(card.step, `${name}: step`).toBe(step.step);
        if (step.stability != null) {
          expect(card.stability, `${name}: stability`).toBeCloseTo(step.stability, 4);
        }
        if (step.difficulty != null) {
          expect(card.difficulty, `${name}: difficulty`).toBeCloseTo(step.difficulty, 4);
        }
        if (step.due_iso != null) {
          expect(card.dueAtEpochMs, `${name}: due`).toBe(new Date(step.due_iso).getTime());
        }
        expect(card.lastReviewAtEpochMs, `${name}: lastReview`).toBe(reviewAtEpochMs);
      }
    }
  });
});
