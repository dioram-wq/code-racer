/**
 * Typing-test statistics.
 *
 * Words per minute use the standard definition of one word as five characters.
 * Only correct characters count, so mistakes do not inflate speed. Accuracy is
 * the share of typed characters that were correct.
 *
 * The typing engine reports both counts from the buffer after backspaces, so
 * a corrected mistake no longer counts as typed. Callers that track raw
 * keystrokes themselves can pass those totals instead.
 */

/** Characters that make up one word in the standard WPM formula. */
export const CHARACTERS_PER_WORD = 5;

/** Unrounded words per minute and accuracy for a passage in progress. */
export interface TypingStats {
  /** Correct characters, converted at five characters per word, per minute. */
  wpm: number;
  /** Percentage from 0 to 100. */
  accuracy: number;
}

/**
 * Net words per minute for the characters the player got right.
 *
 * Returns 0 when no time has elapsed, including the moment a race starts.
 * The result is not rounded.
 */
export function calculateWpm(correctCharacters: number, elapsedMs: number): number {
  assertNonNegativeInteger("correctCharacters", correctCharacters);
  assertNonNegativeFinite("elapsedMs", elapsedMs);

  if (elapsedMs === 0) {
    return 0;
  }

  const words = correctCharacters / CHARACTERS_PER_WORD;
  const minutes = elapsedMs / 60_000;
  return words / minutes;
}

/**
 * Accuracy as a percentage of typed characters that were correct.
 *
 * Returns 100 when nothing has been typed yet, which is the usual starting
 * value for a live race display. The result is not rounded.
 */
export function calculateAccuracy(
  correctCharacters: number,
  typedCharacters: number,
): number {
  assertNonNegativeInteger("correctCharacters", correctCharacters);
  assertNonNegativeInteger("typedCharacters", typedCharacters);

  if (correctCharacters > typedCharacters) {
    throw new RangeError("correctCharacters cannot exceed typedCharacters");
  }

  if (typedCharacters === 0) {
    return 100;
  }

  return (correctCharacters / typedCharacters) * 100;
}

/** WPM and accuracy for one set of counts and an elapsed time. */
export function calculateTypingStats(
  correctCharacters: number,
  typedCharacters: number,
  elapsedMs: number,
): TypingStats {
  return {
    wpm: calculateWpm(correctCharacters, elapsedMs),
    accuracy: calculateAccuracy(correctCharacters, typedCharacters),
  };
}

function assertNonNegativeInteger(name: string, value: number): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer`);
  }
}

function assertNonNegativeFinite(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}
