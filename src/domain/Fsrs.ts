import { FsrsState, Rating } from './Models';

export interface FsrsCard {
  state: FsrsState;
  step: number | null;
  stability: number | null;
  difficulty: number | null;
  dueAtEpochMs: number;
  lastReviewAtEpochMs: number | null;
}

export const FSRS_DEFAULT_PARAMETERS: number[] = [
  0.212, 1.2931, 2.3065, 8.2956, 6.4133, 0.8334, 3.0194, 0.001, 1.8722, 0.1666, 0.796, 1.4835,
  0.0614, 0.2629, 1.6483, 0.6014, 1.8729, 0.5425, 0.0912, 0.0658, 0.1542,
];

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/**
 * Pure TypeScript port of FSRS v6 (aligned with Android/HarmonyOS golden vectors).
 * Production may enable fuzzing later; tests keep enableFuzzing = false.
 */
export class FsrsScheduler {
  private readonly parameters: number[];
  private readonly desiredRetention: number;
  private readonly maximumIntervalDays: number;
  private readonly decay: number;
  private readonly factor: number;

  constructor(
    parameters: number[] = FSRS_DEFAULT_PARAMETERS,
    desiredRetention = 0.9,
    maximumIntervalDays = 36500,
  ) {
    if (parameters.length !== 21) throw new Error('FSRS requires 21 parameters');
    this.parameters = parameters.slice();
    this.desiredRetention = desiredRetention;
    this.maximumIntervalDays = maximumIntervalDays;
    this.decay = -this.parameters[20];
    this.factor = Math.pow(0.9, 1.0 / this.decay) - 1.0;
  }

  retrievability(card: FsrsCard, nowEpochMs: number): number {
    if (card.stability === null || card.lastReviewAtEpochMs === null) return 0.0;
    const elapsedDays = Math.max(0, Math.floor((nowEpochMs - card.lastReviewAtEpochMs) / DAY_MS));
    return Math.pow(1.0 + (this.factor * elapsedDays) / card.stability, this.decay);
  }

  review(card: FsrsCard, rating: Rating, reviewAtEpochMs: number): FsrsCard {
    let state = card.state;
    let step = card.step;
    let stability = card.stability;
    let difficulty = card.difficulty;
    const elapsedDays =
      card.lastReviewAtEpochMs === null
        ? null
        : Math.floor((reviewAtEpochMs - card.lastReviewAtEpochMs) / DAY_MS);

    if (state === FsrsState.NEW) {
      state = FsrsState.LEARNING;
      step = 0;
    }

    if (state === FsrsState.LEARNING || state === FsrsState.RELEARNING) {
      const steps = state === FsrsState.RELEARNING ? [10 * MINUTE_MS] : [MINUTE_MS, 10 * MINUTE_MS];
      const currentStep = step === null ? 0 : step;
      if (stability === null || difficulty === null) {
        stability = this.initialStability(rating);
        difficulty = this.initialDifficulty(rating, true);
      } else if (elapsedDays !== null && elapsedDays < 1) {
        stability = this.shortTermStability(stability, rating);
        difficulty = this.nextDifficulty(difficulty, rating);
      } else {
        const r = this.retrievability(card, reviewAtEpochMs);
        stability = this.nextStability(difficulty, stability, r, rating);
        difficulty = this.nextDifficulty(difficulty, rating);
      }

      let intervalMs = 0;
      if (currentStep >= steps.length && rating !== Rating.AGAIN) {
        state = FsrsState.REVIEW;
        step = null;
        intervalMs = this.nextIntervalDays(stability) * DAY_MS;
      } else if (rating === Rating.AGAIN) {
        step = 0;
        intervalMs = steps[0];
      } else if (rating === Rating.HARD) {
        if (currentStep === 0 && steps.length === 1) {
          intervalMs = Math.floor(steps[0] * 1.5);
        } else if (currentStep === 0) {
          intervalMs = Math.floor((steps[0] + steps[1]) / 2);
        } else {
          intervalMs = steps[currentStep];
        }
      } else if (rating === Rating.GOOD) {
        if (currentStep + 1 === steps.length) {
          state = FsrsState.REVIEW;
          step = null;
          intervalMs = this.nextIntervalDays(stability) * DAY_MS;
        } else {
          step = currentStep + 1;
          intervalMs = steps[currentStep + 1];
        }
      } else {
        state = FsrsState.REVIEW;
        step = null;
        intervalMs = this.nextIntervalDays(stability) * DAY_MS;
      }
      return {
        state,
        step,
        stability,
        difficulty,
        dueAtEpochMs: reviewAtEpochMs + intervalMs,
        lastReviewAtEpochMs: reviewAtEpochMs,
      };
    }

    if (stability === null || difficulty === null) {
      throw new Error('Review state requires stability and difficulty');
    }
    const newStability =
      elapsedDays !== null && elapsedDays < 1
        ? this.shortTermStability(stability, rating)
        : this.nextStability(
            difficulty,
            stability,
            this.retrievability(card, reviewAtEpochMs),
            rating,
          );
    const newDifficulty = this.nextDifficulty(difficulty, rating);
    let intervalMs = this.nextIntervalDays(newStability) * DAY_MS;
    if (rating === Rating.AGAIN) {
      state = FsrsState.RELEARNING;
      step = 0;
      intervalMs = 10 * MINUTE_MS;
    }
    return {
      state,
      step,
      stability: newStability,
      difficulty: newDifficulty,
      dueAtEpochMs: reviewAtEpochMs + intervalMs,
      lastReviewAtEpochMs: reviewAtEpochMs,
    };
  }

  private ratingIndex(rating: Rating): number {
    if (rating === Rating.AGAIN) return 0;
    if (rating === Rating.HARD) return 1;
    if (rating === Rating.GOOD) return 2;
    return 3;
  }

  private clampDifficulty(value: number): number {
    return Math.min(Math.max(value, 1.0), 10.0);
  }

  private clampStability(value: number): number {
    return Math.max(value, 0.001);
  }

  private initialStability(rating: Rating): number {
    return this.clampStability(this.parameters[this.ratingIndex(rating)]);
  }

  private initialDifficulty(rating: Rating, clamp: boolean): number {
    const d = this.parameters[4] - Math.exp(this.parameters[5] * this.ratingIndex(rating)) + 1.0;
    return clamp ? this.clampDifficulty(d) : d;
  }

  private nextIntervalDays(stability: number): number {
    const raw =
      (stability / this.factor) * (Math.pow(this.desiredRetention, 1.0 / this.decay) - 1.0);
    return Math.min(Math.max(Math.round(raw), 1), this.maximumIntervalDays);
  }

  private shortTermStability(stability: number, rating: Rating): number {
    let increase =
      Math.exp(this.parameters[17] * (this.ratingIndex(rating) - 2.0 + this.parameters[18])) *
      Math.pow(stability, -this.parameters[19]);
    if (rating === Rating.GOOD || rating === Rating.EASY) {
      increase = Math.max(increase, 1.0);
    }
    return this.clampStability(stability * increase);
  }

  private nextDifficulty(difficulty: number, rating: Rating): number {
    const arg1 = this.initialDifficulty(Rating.EASY, false);
    const delta = -(this.parameters[6] * (this.ratingIndex(rating) - 2.0));
    const damped = difficulty + ((10.0 - difficulty) * delta) / 9.0;
    return this.clampDifficulty(this.parameters[7] * arg1 + (1.0 - this.parameters[7]) * damped);
  }

  private nextStability(
    difficulty: number,
    stability: number,
    retrievability: number,
    rating: Rating,
  ): number {
    if (rating === Rating.AGAIN) {
      const longTerm =
        this.parameters[11] *
        Math.pow(difficulty, -this.parameters[12]) *
        (Math.pow(stability + 1.0, this.parameters[13]) - 1.0) *
        Math.exp((1.0 - retrievability) * this.parameters[14]);
      const shortTerm = stability / Math.exp(this.parameters[17] * this.parameters[18]);
      return this.clampStability(Math.min(longTerm, shortTerm));
    }
    const hardPenalty = rating === Rating.HARD ? this.parameters[15] : 1.0;
    const easyBonus = rating === Rating.EASY ? this.parameters[16] : 1.0;
    const next =
      stability *
      (1.0 +
        Math.exp(this.parameters[8]) *
          (11.0 - difficulty) *
          Math.pow(stability, -this.parameters[9]) *
          (Math.exp((1.0 - retrievability) * this.parameters[10]) - 1.0) *
          hardPenalty *
          easyBonus);
    return this.clampStability(next);
  }
}
