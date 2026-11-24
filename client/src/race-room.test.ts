import { createTypingState, typeText, type Snippet } from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import type { LanguagePassage } from "./race-language.js";
import { openPassage } from "./race-passage.js";
import { adoptRacePassage, racePassageIsOnScreen } from "./race-room.js";

const clamp: Snippet = {
  id: "ts-clamp",
  language: "typescript",
  title: "Clamp a number",
  code: "const n = 1;\n",
};

const other: Snippet = {
  id: "py-sum",
  language: "python",
  title: "Add",
  code: "n = 1\n",
};

describe("adoptRacePassage", () => {
  it("returns the same passage when it is already that snippet and has not started", () => {
    const current = passage(clamp);
    expect(adoptRacePassage(current, clamp)).toBe(current);
  });

  it("replaces a started passage and follows the snippet language", () => {
    const started = passage(other, "any");
    const typed = typeText(started.session.typing, "n");
    const current: LanguagePassage = {
      language: "any",
      session: { ...started.session, typing: typed, timing: { startedAt: 5, finishedAt: null } },
    };

    const next = adoptRacePassage(current, clamp);

    expect(next).not.toBe(current);
    expect(next.language).toBe("typescript");
    expect(next.session.snippet).toEqual(clamp);
    expect(next.session.typing.cursor).toBe(0);
    expect(next.session.typing.started).toBe(false);
    expect(next.session.timing.startedAt).toBeNull();
  });

  it("replaces a passage whose clock started or whose code differs", () => {
    const timed: LanguagePassage = {
      language: "typescript",
      session: { ...openPassage(clamp), timing: { startedAt: 1, finishedAt: null } },
    };
    expect(adoptRacePassage(timed, clamp).session.timing.startedAt).toBeNull();

    const retitled: Snippet = { ...clamp, title: "Clamp again" };
    expect(adoptRacePassage(passage(clamp), retitled).session.snippet.title).toBe("Clamp again");
  });

  it("replaces a buffer that was started and then cleared", () => {
    const typed = typeText(createTypingState(clamp.code), "x");
    const cleared = { ...typed, cursor: 0, started: true };
    const current: LanguagePassage = {
      language: "typescript",
      session: { ...openPassage(clamp), typing: cleared },
    };

    expect(adoptRacePassage(current, clamp).session.typing.started).toBe(false);
  });
});

describe("racePassageIsOnScreen", () => {
  it("is true only while a joined race's snippet is the unfinished passage", () => {
    const current = passage(clamp);
    expect(racePassageIsOnScreen(current, clamp, true)).toBe(true);
    expect(racePassageIsOnScreen(current, clamp, false)).toBe(false);
    expect(racePassageIsOnScreen(current, undefined, true)).toBe(false);
    expect(racePassageIsOnScreen(current, other, true)).toBe(false);
    expect(racePassageIsOnScreen(current, { ...clamp, code: "const n = 2;\n" }, true)).toBe(false);

    const finished = typeText(current.session.typing, clamp.code);
    const done: LanguagePassage = { ...current, session: { ...current.session, typing: finished } };
    expect(finished.finished).toBe(true);
    expect(racePassageIsOnScreen(done, clamp, true)).toBe(false);
  });
});

function passage(snippet: Snippet, language: LanguagePassage["language"] = snippet.language): LanguagePassage {
  return { language, session: openPassage(snippet) };
}
