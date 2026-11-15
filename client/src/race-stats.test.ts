import {
  backspace,
  calculateTypingStats,
  createTypingState,
  typeCharacter,
  typeText,
} from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import {
  advanceRaceTiming,
  createRaceTiming,
  isRaceClockRunning,
  liveRaceStats,
  type RaceClock,
} from "./race-stats.js";

function idleClock(): RaceClock {
  return {
    now() {
      throw new Error("clock should stay idle");
    },
  };
}

describe("advanceRaceTiming", () => {
  it("stays idle until a character is inserted", () => {
    const timing = createRaceTiming();
    const empty = createTypingState("ab");

    expect(isRaceClockRunning(timing)).toBe(false);
    expect(advanceRaceTiming(timing, empty, idleClock())).toBe(timing);
    expect(advanceRaceTiming(timing, backspace(empty), idleClock())).toBe(timing);
  });

  it("starts on the first character and keeps that timestamp", () => {
    const started = typeCharacter(createTypingState("ab"), "a");
    let reads = 0;
    const timing = advanceRaceTiming(createRaceTiming(), started, {
      now() {
        reads += 1;
        return 1_000;
      },
    });

    expect(reads).toBe(1);
    expect(timing).toEqual({ startedAt: 1_000, finishedAt: null });
    expect(isRaceClockRunning(timing)).toBe(true);
    expect(advanceRaceTiming(timing, started, idleClock())).toBe(timing);
    expect(advanceRaceTiming(timing, backspace(started), idleClock())).toBe(timing);
  });

  it("stops when the engine finishes and ignores the clock after that", () => {
    let state = typeCharacter(createTypingState("ab"), "a");
    let timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 1_000 });
    state = typeCharacter(state, "b");
    let reads = 0;
    timing = advanceRaceTiming(timing, state, {
      now() {
        reads += 1;
        return 11_000;
      },
    });

    expect(reads).toBe(1);
    expect(timing).toEqual({ startedAt: 1_000, finishedAt: 11_000 });
    expect(isRaceClockRunning(timing)).toBe(false);
    expect(advanceRaceTiming(timing, state, idleClock())).toBe(timing);
    expect(advanceRaceTiming(timing, typeCharacter(state, "x"), idleClock())).toBe(timing);
  });

  it("stamps start and finish from one reading when the passage is a single character", () => {
    let reads = 0;
    const timing = advanceRaceTiming(createRaceTiming(), typeText(createTypingState("a"), "a"), {
      now() {
        reads += 1;
        return 42;
      },
    });

    expect(reads).toBe(1);
    expect(timing).toEqual({ startedAt: 42, finishedAt: 42 });
  });

  it("rejects a clock reading that is not a usable timestamp", () => {
    const started = typeCharacter(createTypingState("ab"), "a");
    const timing = createRaceTiming();

    expect(() => advanceRaceTiming(timing, started, { now: () => -1 })).toThrow(RangeError);
    expect(() => advanceRaceTiming(timing, started, { now: () => Number.NaN })).toThrow(RangeError);
    expect(() =>
      advanceRaceTiming(timing, started, { now: () => Number.POSITIVE_INFINITY }),
    ).toThrow(RangeError);
  });
});

describe("liveRaceStats", () => {
  it("reads zero words per minute and full accuracy before the clock starts", () => {
    const stats = liveRaceStats(createRaceTiming(), createTypingState("ab"), Number.NaN);

    expect(stats).toMatchObject({
      elapsedMs: 0,
      wpm: 0,
      accuracy: 100,
      running: false,
      finished: false,
      elapsedLabel: "0.0s",
      wpmLabel: "0",
      accuracyLabel: "100%",
      resultLabel: null,
    });
  });

  it("uses the shared stats for the sample and leaves them unrounded", () => {
    const state = typeText(createTypingState("abc"), "abX");
    const timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 0 });
    const stats = liveRaceStats(timing, state, 1_100);

    expect(stats.running).toBe(true);
    expect(stats.finished).toBe(false);
    expect(stats.resultLabel).toBeNull();
    expect({ wpm: stats.wpm, accuracy: stats.accuracy }).toEqual(
      calculateTypingStats(state.correctCharacters, state.typedCharacters, 1_100),
    );
    expect(stats.wpmLabel).toBe("22");
    expect(stats.accuracyLabel).toBe("67%");
    expect(stats.elapsedLabel).toBe("1.1s");
  });

  it("keeps the clock running after a corrected mistake", () => {
    let state = typeCharacter(createTypingState("ab"), "a");
    const timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 1_000 });
    state = backspace(typeCharacter(state, "X"));
    const stats = liveRaceStats(timing, state, 5_000);

    expect(stats.elapsedMs).toBe(4_000);
    expect(stats.running).toBe(true);
    expect({ wpm: stats.wpm, accuracy: stats.accuracy }).toEqual(
      calculateTypingStats(1, 1, 4_000),
    );
    expect(stats.accuracyLabel).toBe("100%");
  });

  it("floors elapsed labels across the minute boundary", () => {
    const state = typeCharacter(createTypingState("ab"), "a");
    const timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 0 });

    expect(liveRaceStats(timing, state, 1_999).elapsedLabel).toBe("1.9s");
    expect(liveRaceStats(timing, state, 59_999).elapsedLabel).toBe("59.9s");
    expect(liveRaceStats(timing, state, 60_000).elapsedLabel).toBe("1:00.0");
    expect(liveRaceStats(timing, state, 61_500).elapsedLabel).toBe("1:01.5");
  });

  it("treats a sample from before the start as no elapsed time", () => {
    const state = typeCharacter(createTypingState("ab"), "a");
    const timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 5_000 });
    const stats = liveRaceStats(timing, state, 4_000);

    expect(stats.elapsedMs).toBe(0);
    expect(stats.wpm).toBe(0);
    expect(stats.elapsedLabel).toBe("0.0s");
  });

  it("freezes the result when the engine finishes", () => {
    let state = typeCharacter(createTypingState("ab"), "a");
    let timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 1_000 });
    state = typeCharacter(state, "b");
    timing = advanceRaceTiming(timing, state, { now: () => 11_000 });
    const stats = liveRaceStats(timing, state, Number.NaN);

    expect(stats.finished).toBe(true);
    expect(stats.running).toBe(false);
    expect(stats.elapsedMs).toBe(10_000);
    expect({ wpm: stats.wpm, accuracy: stats.accuracy }).toEqual(
      calculateTypingStats(2, 2, 10_000),
    );
    expect(stats.wpmLabel).toBe("2");
    expect(stats.accuracyLabel).toBe("100%");
    expect(stats.elapsedLabel).toBe("10.0s");
    expect(stats.resultLabel).toBe("2 wpm · 100% · 10.0s");
  });
});
