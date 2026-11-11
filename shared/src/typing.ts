/**
 * Pure typing state for one race.
 *
 * Each inserted character is stored and compared with the target at the same
 * index. Newlines, spaces, and tabs are ordinary characters, so a space where
 * the snippet has a tab is a mistake. The buffer never grows past the target:
 * extra keystrokes wait until backspace makes room. The race finishes when
 * the buffer equals the target, and input after that is ignored.
 *
 * The engine does not keep a clock. `correctCharacters` and `typedCharacters`
 * are the buffer after backspaces, which is what `calculateWpm` and
 * `calculateAccuracy` accept. `started` and `finished` tell the caller when
 * to start and stop that clock.
 */

/** Whether the character at one index matches the target. */
export type CharacterCorrectness = "correct" | "incorrect";

/** One typed character and how it compares with the target at that index. */
export interface TypedCharacter {
  readonly expected: string;
  readonly actual: string;
  readonly correctness: CharacterCorrectness;
}

/**
 * Immutable snapshot of a race. Functions in this module return a new value
 * when something changes and the same value when the keystroke has no effect.
 */
export interface TypingState {
  readonly target: string;
  /** Characters entered so far, including ones that do not match. */
  readonly typed: string;
  /** Index of the next character to type. Equal to `typed.length`. */
  readonly cursor: number;
  /** One entry per typed character, in order. */
  readonly characters: readonly TypedCharacter[];
  /** Incorrect characters still in the buffer. */
  readonly errorCount: number;
  /**
   * Buffer characters that match the target. Pass to `calculateWpm` and
   * `calculateAccuracy`.
   */
  readonly correctCharacters: number;
  /**
   * Buffer length, including mistakes not yet backspaced. Pass to
   * `calculateAccuracy` with `correctCharacters`.
   */
  readonly typedCharacters: number;
  /**
   * True after the first inserted character, and still true if that character
   * is later deleted. Backspace on an empty buffer does not start the race.
   */
  readonly started: boolean;
  /**
   * True when the buffer equals the target. Further keystrokes are ignored,
   * so the counts a caller scores stay put.
   */
  readonly finished: boolean;
}

/** A race against this exact passage. The target is compared character by character. */
export function createTypingState(target: string): TypingState {
  if (typeof target !== "string" || target.length === 0) {
    throw new RangeError("target must be a non-empty string");
  }
  return derive(target, "", false);
}

/**
 * Append one character. `character` is one UTF-16 code unit, which covers
 * the newlines and indentation in the snippet catalog.
 *
 * Returns the same state when the race is already finished or the buffer is
 * already as long as the target.
 */
export function typeCharacter(state: TypingState, character: string): TypingState {
  assertSingleCharacter(character);
  if (state.typed.length >= state.target.length) {
    return state;
  }
  return derive(state.target, state.typed + character, true);
}

/**
 * Delete the character before the cursor.
 *
 * Returns the same state at the start of the buffer, and after the race has
 * finished.
 */
export function backspace(state: TypingState): TypingState {
  if (state.finished || state.typed.length === 0) {
    return state;
  }
  return derive(state.target, state.typed.slice(0, -1), state.started);
}

/**
 * Apply each code unit in `text` as a character keystroke.
 *
 * Code units keep the cursor aligned with indexes into `target`. Once the
 * buffer matches the target, the rest of `text` is ignored.
 */
export function typeText(state: TypingState, text: string): TypingState {
  if (typeof text !== "string") {
    throw new RangeError("text must be a string");
  }
  let next = state;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === undefined) {
      continue;
    }
    next = typeCharacter(next, character);
  }
  return next;
}

function derive(target: string, typed: string, started: boolean): TypingState {
  const characters: TypedCharacter[] = [];
  let correctCharacters = 0;

  for (let index = 0; index < typed.length; index += 1) {
    const actual = typed.charAt(index);
    const expected = target.charAt(index);
    const correctness: CharacterCorrectness = actual === expected ? "correct" : "incorrect";
    if (correctness === "correct") {
      correctCharacters += 1;
    }
    characters.push({ expected, actual, correctness });
  }

  return {
    target,
    typed,
    cursor: typed.length,
    characters,
    errorCount: typed.length - correctCharacters,
    correctCharacters,
    typedCharacters: typed.length,
    started,
    finished: typed === target,
  };
}

function assertSingleCharacter(character: string): void {
  if (typeof character !== "string" || character.length !== 1) {
    throw new RangeError("character must be a single character");
  }
}
