import type { TypingState } from "@code-racer/shared";

/** Class for one target character on the race screen. */
export const RACE_CHARACTER_CLASS = {
  pending: "char-pending",
  correct: "char-correct",
  incorrect: "char-incorrect",
  cursor: "char-cursor",
} as const;

export type RaceCharacterClass = (typeof RACE_CHARACTER_CLASS)[keyof typeof RACE_CHARACTER_CLASS];

/** One glyph of the snippet, in target order, ready to render. */
export interface RaceCharacter {
  readonly index: number;
  readonly value: string;
  readonly className: RaceCharacterClass;
}

/**
 * Map a typing-engine snapshot onto the snippet the player is copying.
 *
 * The glyph is always the target character, so a mistake does not rewrite
 * the passage. Typed positions are correct or incorrect. The cursor is the
 * next untyped character. A finished race has no cursor.
 */
export function raceCharacters(state: TypingState): readonly RaceCharacter[] {
  const glyphs: RaceCharacter[] = [];

  for (let index = 0; index < state.target.length; index += 1) {
    const value = state.target.charAt(index);
    const typed = state.characters[index];
    const className =
      typed === undefined
        ? index === state.cursor
          ? RACE_CHARACTER_CLASS.cursor
          : RACE_CHARACTER_CLASS.pending
        : typed.correctness === "correct"
          ? RACE_CHARACTER_CLASS.correct
          : RACE_CHARACTER_CLASS.incorrect;
    glyphs.push({ index, value, className });
  }

  return glyphs;
}
