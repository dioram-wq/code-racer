import { backspace, createTypingState, typeCharacter, typeText } from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import { raceCharacters } from "./race-characters.js";

describe("raceCharacters", () => {
  it("puts the cursor on the first character and leaves the rest pending", () => {
    const glyphs = raceCharacters(createTypingState("ab"));

    expect(glyphs).toEqual([
      { index: 0, value: "a", className: "char-cursor" },
      { index: 1, value: "b", className: "char-pending" },
    ]);
  });

  it("keeps the target glyph when a keystroke is wrong and advances the cursor", () => {
    const glyphs = raceCharacters(typeText(createTypingState("abX"), "ac"));

    expect(glyphs).toEqual([
      { index: 0, value: "a", className: "char-correct" },
      { index: 1, value: "b", className: "char-incorrect" },
      { index: 2, value: "X", className: "char-cursor" },
    ]);
  });

  it("moves the cursor back when the engine deletes a character", () => {
    const typed = typeCharacter(createTypingState("go"), "g");
    const glyphs = raceCharacters(backspace(typed));

    expect(glyphs.map((glyph) => glyph.className)).toEqual(["char-cursor", "char-pending"]);
  });

  it("styles newlines and tabs without dropping them", () => {
    const glyphs = raceCharacters(typeCharacter(createTypingState("a\n\tb"), "a"));

    expect(glyphs).toEqual([
      { index: 0, value: "a", className: "char-correct" },
      { index: 1, value: "\n", className: "char-cursor" },
      { index: 2, value: "\t", className: "char-pending" },
      { index: 3, value: "b", className: "char-pending" },
    ]);
  });

  it("leaves no cursor once the passage is finished", () => {
    const glyphs = raceCharacters(typeText(createTypingState("ab"), "ab"));

    expect(glyphs.map((glyph) => glyph.className)).toEqual(["char-correct", "char-correct"]);
  });
});
