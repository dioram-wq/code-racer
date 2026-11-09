import { describe, expect, it } from "vitest";
import {
  CHARACTERS_PER_WORD,
  calculateAccuracy,
  calculateTypingStats,
  calculateWpm,
} from "./index.js";

describe("calculateWpm", () => {
  it("uses five characters as one word", () => {
    expect(CHARACTERS_PER_WORD).toBe(5);
    // 250 correct characters is 50 words. Over one minute that is 50 WPM.
    expect(calculateWpm(250, 60_000)).toBe(50);
  });

  it("scales with elapsed time", () => {
    // 100 correct characters is 20 words. Half a minute is 40 WPM.
    expect(calculateWpm(100, 30_000)).toBe(40);
    // One word in one second is 60 WPM.
    expect(calculateWpm(CHARACTERS_PER_WORD, 1_000)).toBe(60);
  });

  it("matches the five-character formula for an arbitrary passage", () => {
    const correctCharacters = 123;
    const elapsedMs = 45_000;
    expect(calculateWpm(correctCharacters, elapsedMs)).toBe(
      correctCharacters / CHARACTERS_PER_WORD / (elapsedMs / 60_000),
    );
  });

  it("is zero before the clock starts or when nothing correct has been typed", () => {
    expect(calculateWpm(40, 0)).toBe(0);
    expect(calculateWpm(0, 60_000)).toBe(0);
  });

  it("rejects counts and durations that are not usable", () => {
    expect(() => calculateWpm(-1, 1_000)).toThrow(RangeError);
    expect(() => calculateWpm(1.5, 1_000)).toThrow(RangeError);
    expect(() => calculateWpm(10, -1)).toThrow(RangeError);
    expect(() => calculateWpm(10, Number.POSITIVE_INFINITY)).toThrow(RangeError);
    expect(() => calculateWpm(Number.NaN, 1_000)).toThrow(RangeError);
  });
});

describe("calculateAccuracy", () => {
  it("returns the percentage of typed characters that were correct", () => {
    expect(calculateAccuracy(8, 10)).toBe(80);
    expect(calculateAccuracy(0, 4)).toBe(0);
    expect(calculateAccuracy(3, 3)).toBe(100);
    expect(calculateAccuracy(1, 3)).toBeCloseTo(100 / 3);
  });

  it("starts at 100 when nothing has been typed", () => {
    expect(calculateAccuracy(0, 0)).toBe(100);
  });

  it("rejects impossible or invalid counts", () => {
    expect(() => calculateAccuracy(4, 3)).toThrow(RangeError);
    expect(() => calculateAccuracy(-1, 3)).toThrow(RangeError);
    expect(() => calculateAccuracy(1, 1.2)).toThrow(RangeError);
  });
});

describe("calculateTypingStats", () => {
  it("reports wpm and accuracy together", () => {
    expect(calculateTypingStats(50, 50, 60_000)).toEqual({
      wpm: 10,
      accuracy: 100,
    });
    expect(calculateTypingStats(15, 20, 30_000)).toEqual({
      wpm: 6,
      accuracy: 75,
    });
  });
});
