import { describe, expect, it } from "vitest";
import {
  CHARACTERS_PER_WORD,
  backspace,
  calculateAccuracy,
  calculateTypingStats,
  calculateWpm,
  createTypingState,
  getSnippet,
  typeCharacter,
  typeText,
} from "./index.js";

describe("createTypingState", () => {
  it("starts at the first character with nothing typed", () => {
    const state = createTypingState("let n = 1;");
    expect(state).toEqual({
      target: "let n = 1;",
      typed: "",
      cursor: 0,
      characters: [],
      errorCount: 0,
      correctCharacters: 0,
      typedCharacters: 0,
      started: false,
      finished: false,
    });
  });

  it("rejects an empty target", () => {
    expect(() => createTypingState("")).toThrow(RangeError);
  });
});

describe("typeCharacter", () => {
  it("records each correct character and leaves the previous state unchanged", () => {
    const target = "let n = 1;";
    let state = createTypingState(target);

    for (let index = 0; index < target.length; index += 1) {
      const character = target[index];
      if (character === undefined) {
        throw new Error("expected a target character");
      }
      const before = state;
      state = typeCharacter(state, character);

      expect(state).not.toBe(before);
      expect(before.cursor).toBe(index);
      expect(before.typed).toBe(target.slice(0, index));
      expect(state.cursor).toBe(index + 1);
      expect(state.typed).toBe(target.slice(0, index + 1));
      expect(state.started).toBe(true);
      expect(state.errorCount).toBe(0);
      expect(state.correctCharacters).toBe(index + 1);
      expect(state.typedCharacters).toBe(index + 1);
      expect(state.characters[index]).toEqual({
        expected: character,
        actual: character,
        correctness: "correct",
      });
      expect(state.finished).toBe(index === target.length - 1);
    }
  });

  it("marks a mistake without treating later matches as wrong", () => {
    const state = typeText(createTypingState("abcd"), "abXd");

    expect(state.characters.map((character) => character.correctness)).toEqual([
      "correct",
      "correct",
      "incorrect",
      "correct",
    ]);
    expect(state.characters[2]).toEqual({
      expected: "c",
      actual: "X",
      correctness: "incorrect",
    });
    expect(state.cursor).toBe(4);
    expect(state.errorCount).toBe(1);
    expect(state.correctCharacters).toBe(3);
    expect(state.typedCharacters).toBe(4);
    expect(state.started).toBe(true);
    expect(state.finished).toBe(false);
  });

  it("ignores extra characters once the buffer is as long as the target", () => {
    const wrong = typeText(createTypingState("ab"), "axyz");
    expect(wrong.typed).toBe("ax");
    expect(wrong.finished).toBe(false);
    expect(wrong.errorCount).toBe(1);
    expect(typeCharacter(wrong, "q")).toBe(wrong);

    const done = typeText(createTypingState("ab"), "abcd");
    expect(done.typed).toBe("ab");
    expect(done.finished).toBe(true);
    expect(typeText(done, "cd")).toBe(done);
  });

  it("rejects a key that is not one character", () => {
    const state = createTypingState("ab");
    expect(() => typeCharacter(state, "")).toThrow(RangeError);
    expect(() => typeCharacter(state, "ab")).toThrow(RangeError);
    expect(() => typeText(state, undefined as unknown as string)).toThrow(RangeError);
    expect(state.typed).toBe("");
    expect(typeText(state, "")).toBe(state);
  });
});

describe("backspace", () => {
  it("removes an error, including characters typed after it", () => {
    let state = typeText(createTypingState("cat"), "cot");
    expect(state.characters.map((character) => character.correctness)).toEqual([
      "correct",
      "incorrect",
      "correct",
    ]);
    expect(state.errorCount).toBe(1);

    state = backspace(state);
    expect(state.typed).toBe("co");
    expect(state.cursor).toBe(2);
    expect(state.errorCount).toBe(1);
    expect(state.correctCharacters).toBe(1);

    state = backspace(state);
    expect(state.typed).toBe("c");
    expect(state.errorCount).toBe(0);
    expect(state.correctCharacters).toBe(1);
    expect(state.characters).toEqual([
      { expected: "c", actual: "c", correctness: "correct" },
    ]);

    state = typeText(state, "at");
    expect(state.finished).toBe(true);
    expect(state.typed).toBe("cat");
    expect(state.errorCount).toBe(0);
  });

  it("does nothing at the start, before the race has started", () => {
    const state = createTypingState("ab");
    expect(backspace(state)).toBe(state);
    expect(state.cursor).toBe(0);
    expect(state.started).toBe(false);
    expect(state.errorCount).toBe(0);
  });

  it("stays at the start after the buffer is cleared and does not restart", () => {
    let state = typeCharacter(createTypingState("ab"), "z");
    expect(state.started).toBe(true);
    expect(state.errorCount).toBe(1);

    state = backspace(state);
    expect(state.typed).toBe("");
    expect(state.cursor).toBe(0);
    expect(state.characters).toEqual([]);
    expect(state.errorCount).toBe(0);
    expect(state.correctCharacters).toBe(0);
    expect(state.started).toBe(true);
    expect(state.finished).toBe(false);
    expect(backspace(state)).toBe(state);
  });
});

describe("finish detection", () => {
  it("finishes only when the full target has been typed correctly", () => {
    let state = typeText(createTypingState("go"), "g");
    expect(state.finished).toBe(false);

    state = typeCharacter(state, "x");
    expect(state.finished).toBe(false);
    expect(state.typed).toBe("gx");
    expect(typeCharacter(state, "o")).toBe(state);

    state = backspace(state);
    state = typeCharacter(state, "o");
    expect(state.finished).toBe(true);
    expect(state.cursor).toBe(2);
    expect(state.errorCount).toBe(0);
    expect(state.correctCharacters).toBe(2);
  });

  it("ignores keystrokes after the race is finished", () => {
    const state = typeText(createTypingState("go"), "go");
    expect(state.finished).toBe(true);
    expect(typeCharacter(state, "!")).toBe(state);
    expect(backspace(state)).toBe(state);
    expect(typeText(state, "fmt")).toBe(state);
  });
});

describe("newlines and indentation", () => {
  it("compares newlines and indent characters exactly", () => {
    const target = "{\n  return;\n}";
    const typed = typeText(createTypingState(target), target);
    expect(typed.finished).toBe(true);
    expect(typed.typed).toBe(target);

    const newline = target.indexOf("\n");
    expect(typed.characters[newline]).toEqual({
      expected: "\n",
      actual: "\n",
      correctness: "correct",
    });
    expect(typed.characters[newline + 1]).toEqual({
      expected: " ",
      actual: " ",
      correctness: "correct",
    });

    const tabbed = typeCharacter(
      typeText(createTypingState(target), target.slice(0, newline + 1)),
      "\t",
    );
    expect(tabbed.characters[newline + 1]).toEqual({
      expected: " ",
      actual: "\t",
      correctness: "incorrect",
    });
    expect(tabbed.errorCount).toBe(1);
    expect(tabbed.finished).toBe(false);
  });

  it("types catalog snippets that indent with spaces or tabs", () => {
    for (const id of ["py-average", "go-contains"] as const) {
      const snippet = getSnippet(id);
      if (snippet === undefined) {
        throw new Error(`expected snippet ${id}`);
      }
      expect(snippet.code).toContain("\n");

      const state = typeText(createTypingState(snippet.code), snippet.code);
      expect(state.finished).toBe(true);
      expect(state.errorCount).toBe(0);
      expect(state.cursor).toBe(snippet.code.length);
      expect(state.correctCharacters).toBe(snippet.code.length);

      const newline = snippet.code.indexOf("\n");
      expect(state.characters[newline]).toEqual({
        expected: "\n",
        actual: "\n",
        correctness: "correct",
      });
    }

    const go = getSnippet("go-contains");
    if (go === undefined) {
      throw new Error("expected go-contains");
    }
    const tabAt = go.code.indexOf("\t");
    expect(tabAt).toBeGreaterThan(0);
    const spaceForTab = typeText(createTypingState(go.code), `${go.code.slice(0, tabAt)} `);
    expect(spaceForTab.characters[tabAt]).toEqual({
      expected: "\t",
      actual: " ",
      correctness: "incorrect",
    });
    expect(spaceForTab.finished).toBe(false);

    const python = getSnippet("py-average");
    if (python === undefined) {
      throw new Error("expected py-average");
    }
    const indentAt = python.code.indexOf("\n") + 1;
    expect(python.code[indentAt]).toBe(" ");
    const tabForSpaces = typeText(
      createTypingState(python.code),
      `${python.code.slice(0, indentAt)}\t`,
    );
    expect(tabForSpaces.characters[indentAt]).toEqual({
      expected: " ",
      actual: "\t",
      correctness: "incorrect",
    });
  });
});

describe("stats calculators", () => {
  it("scores the buffer after backspace, so a corrected mistake no longer counts", () => {
    let state = typeText(createTypingState("return"), "returm");
    expect(state.correctCharacters).toBe(5);
    expect(state.typedCharacters).toBe(6);
    expect(state.finished).toBe(false);
    expect(calculateAccuracy(state.correctCharacters, state.typedCharacters)).toBe((5 / 6) * 100);
    expect(calculateWpm(state.correctCharacters, 60_000)).toBe(5 / CHARACTERS_PER_WORD);
    expect(calculateWpm(state.typedCharacters, 60_000)).toBeGreaterThan(
      calculateWpm(state.correctCharacters, 60_000),
    );

    state = typeCharacter(backspace(state), "n");
    expect(state.finished).toBe(true);
    expect(state.correctCharacters).toBe(6);
    expect(state.typedCharacters).toBe(6);
    expect(calculateTypingStats(state.correctCharacters, state.typedCharacters, 30_000)).toEqual({
      wpm: 6 / CHARACTERS_PER_WORD / (30_000 / 60_000),
      accuracy: 100,
    });
  });

  it("reports wpm from a finished catalog snippet", () => {
    const snippet = getSnippet("ts-clamp");
    if (snippet === undefined) {
      throw new Error("expected ts-clamp");
    }
    const state = typeText(createTypingState(snippet.code), snippet.code);
    expect(state.finished).toBe(true);
    expect(calculateTypingStats(state.correctCharacters, state.typedCharacters, 60_000)).toEqual({
      wpm: snippet.code.length / CHARACTERS_PER_WORD,
      accuracy: 100,
    });
  });
});
