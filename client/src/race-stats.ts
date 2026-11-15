import { calculateTypingStats, type TypingState } from "@code-racer/shared";

/**
 * Race clock for the single-player screen.
 *
 * The typing engine does not keep time. `started` and `finished` say when to
 * start and stop, and the character counts are what `calculateTypingStats`
 * accepts. This module records those two timestamps from an injected clock
 * and formats the live readout. It does not redo the WPM or accuracy math.
 */

/** Monotonic milliseconds. Tests return a fixed sequence instead of the system clock. */
export interface RaceClock {
  now(): number;
}

/** Clock backed by `performance.now`, so a system-time change does not move the race. */
export const systemRaceClock: RaceClock = {
  now() {
    return performance.now();
  },
};

/**
 * Start and stop timestamps. `null` means that event has not happened.
 * Zero is a valid reading, so absence is null rather than a falsy number.
 */
export interface RaceTiming {
  readonly startedAt: number | null;
  readonly finishedAt: number | null;
}

/** A race whose clock has not started. */
export function createRaceTiming(): RaceTiming {
  return { startedAt: null, finishedAt: null };
}

/** True after the first inserted character and before the engine reports finish. */
export function isRaceClockRunning(timing: RaceTiming): boolean {
  return timing.startedAt !== null && timing.finishedAt === null;
}

/**
 * Start on the first inserted character and stop when the engine finishes.
 *
 * Returns the same value when the keystroke does not change either timestamp.
 * A passage that starts and finishes on one reading gets both timestamps from
 * that single `clock.now()` call.
 */
export function advanceRaceTiming(
  timing: RaceTiming,
  state: TypingState,
  clock: RaceClock,
): RaceTiming {
  const needsStart = state.started && timing.startedAt === null;
  const needsFinish =
    state.finished && timing.finishedAt === null && (needsStart || timing.startedAt !== null);
  if (!needsStart && !needsFinish) {
    return timing;
  }

  const now = clock.now();
  assertClockReading(now);
  return {
    startedAt: needsStart ? now : timing.startedAt,
    finishedAt: needsFinish ? now : timing.finishedAt,
  };
}

/** Unrounded stats plus the strings the race screen renders. */
export interface LiveRaceStats {
  readonly elapsedMs: number;
  /** Correct characters per minute, from `calculateTypingStats`. Not rounded. */
  readonly wpm: number;
  /** Percentage from 0 to 100, from `calculateTypingStats`. Not rounded. */
  readonly accuracy: number;
  readonly running: boolean;
  readonly finished: boolean;
  /** Elapsed time, floored to a tenth of a second. */
  readonly elapsedLabel: string;
  /** WPM rounded to the nearest integer. */
  readonly wpmLabel: string;
  /** Accuracy rounded to the nearest percent, with a percent sign. */
  readonly accuracyLabel: string;
  /** Null until the clock stops. Then `48 wpm · 96% · 12.4s`. */
  readonly resultLabel: string | null;
}

/**
 * Live time, WPM, and accuracy.
 *
 * `now` is a sample from the same clock passed to `advanceRaceTiming`. The
 * sample is ignored before the clock starts and after it stops, so a stopped
 * race keeps the result it had at the finish.
 */
export function liveRaceStats(timing: RaceTiming, state: TypingState, now: number): LiveRaceStats {
  const elapsedMs = elapsedMilliseconds(timing, now);
  const calculated = calculateTypingStats(state.correctCharacters, state.typedCharacters, elapsedMs);
  const elapsedLabel = formatElapsed(elapsedMs);
  const wpmLabel = String(Math.round(calculated.wpm));
  const accuracyLabel = `${Math.round(calculated.accuracy)}%`;
  const finished = timing.finishedAt !== null;

  return {
    elapsedMs,
    wpm: calculated.wpm,
    accuracy: calculated.accuracy,
    running: isRaceClockRunning(timing),
    finished,
    elapsedLabel,
    wpmLabel,
    accuracyLabel,
    resultLabel: finished ? `${wpmLabel} wpm · ${accuracyLabel} · ${elapsedLabel}` : null,
  };
}

function elapsedMilliseconds(timing: RaceTiming, now: number): number {
  if (timing.startedAt === null) {
    return 0;
  }
  assertClockReading(timing.startedAt);
  const end = timing.finishedAt ?? now;
  assertClockReading(end);
  return Math.max(0, end - timing.startedAt);
}

/** `12.4s` under a minute, then `1:05.2`. Tenths are floored, not rounded up. */
function formatElapsed(elapsedMs: number): string {
  const tenthsTotal = Math.floor(elapsedMs / 100);
  const minutes = Math.floor(tenthsTotal / 600);
  const seconds = Math.floor(tenthsTotal / 10) % 60;
  const tenths = tenthsTotal % 10;
  if (minutes === 0) {
    return `${seconds}.${tenths}s`;
  }
  return `${minutes}:${String(seconds).padStart(2, "0")}.${tenths}`;
}

function assertClockReading(value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError("race clock must return a non-negative finite number");
  }
}
