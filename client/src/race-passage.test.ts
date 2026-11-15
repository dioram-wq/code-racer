import {
  createTypingState,
  getSnippet,
  pickSnippet,
  type PickSnippetOptions,
  type Snippet,
  typeText,
} from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import {
  advancePassage,
  formatPassageResult,
  isNextSnippetKey,
  openPassage,
  selectNextSnippet,
  type SnippetSource,
} from "./race-passage.js";
import { advanceRaceTiming, createRaceTiming, liveRaceStats } from "./race-stats.js";

function snippet(id: string, code = `const ${id} = 1;`): Snippet {
  return {
    id,
    language: "typescript",
    title: id,
    code,
  };
}

function sourceOf(snippets: readonly Snippet[]): SnippetSource & { calls: PickSnippetOptions[] } {
  return {
    calls: [],
    list() {
      return snippets;
    },
    pick(options) {
      this.calls.push(options);
      const excluded = new Set(options.excludeIds ?? []);
      const pool = snippets.filter((entry) => !excluded.has(entry.id));
      if (pool.length === 0) {
        throw new RangeError("no snippets match the given language and exclusions");
      }
      const index = options.seed === undefined ? 0 : options.seed % pool.length;
      const chosen = pool[index];
      if (chosen === undefined) {
        throw new Error("expected a snippet");
      }
      return chosen;
    },
  };
}

describe("selectNextSnippet", () => {
  it("asks the generator to skip the snippet that just finished", () => {
    const source = sourceOf([snippet("one"), snippet("two"), snippet("three")]);

    expect(selectNextSnippet("two", { seed: 0, source }).id).toBe("one");
    expect(source.calls).toEqual([{ seed: 0, excludeIds: ["two"] }]);
    expect(selectNextSnippet("two", { seed: 1, source }).id).toBe("three");
  });

  it("repeats a seeded choice from the shared catalog and does not return the current id", () => {
    const current = pickSnippet({ seed: 3 });
    const next = selectNextSnippet(current.id, { seed: 11 });

    expect(next.id).not.toBe(current.id);
    expect(selectNextSnippet(current.id, { seed: 11 })).toEqual(next);
    expect(getSnippet(next.id)).toEqual(next);
  });

  it("keeps the only snippet when excluding it would leave nothing", () => {
    const only = snippet("only", "const only = true;");
    const source = sourceOf([only]);

    expect(selectNextSnippet(only.id, { source })).toEqual(only);
    expect(source.calls).toEqual([{}]);
  });
});

describe("advancePassage", () => {
  it("loads the next snippet and clears the typing state and clock", () => {
    const currentSnippet = getSnippet("ts-clamp");
    if (currentSnippet === undefined) {
      throw new Error("missing snippet: ts-clamp");
    }
    const started = openPassage(currentSnippet);
    const finishedTyping = typeText(started.typing, currentSnippet.code);
    const finished = {
      snippet: currentSnippet,
      typing: finishedTyping,
      timing: advanceRaceTiming(started.timing, finishedTyping, { now: () => 4_000 }),
      now: 4_000,
    };

    const next = advancePassage(finished, { seed: 2 });

    expect(next.snippet.id).not.toBe(currentSnippet.id);
    expect(next.typing).toEqual(createTypingState(next.snippet.code));
    expect(next.typing.started).toBe(false);
    expect(next.typing.finished).toBe(false);
    expect(next.timing).toEqual(createRaceTiming());
    expect(next.now).toBe(0);
    expect(liveRaceStats(next.timing, next.typing, next.now)).toMatchObject({
      elapsedMs: 0,
      elapsedLabel: "0.0s",
      running: false,
      finished: false,
      resultLabel: null,
    });
  });

  it("does not carry a finished result into the next passage", () => {
    const source = sourceOf([
      snippet("gone", "const gone = 1;"),
      snippet("fresh", "const fresh = 2;"),
    ]);
    const done = {
      ...openPassage(snippet("gone", "const gone = 1;")),
      typing: typeText(createTypingState("const gone = 1;"), "const gone = 1;"),
      timing: { startedAt: 10, finishedAt: 2_000 },
      now: 2_000,
    };

    const next = advancePassage(done, { seed: 0, source });

    expect(next.snippet.id).toBe("fresh");
    expect(next.typing.typed).toBe("");
    expect(next.timing.startedAt).toBeNull();
    expect(next.timing.finishedAt).toBeNull();
  });
});

describe("formatPassageResult", () => {
  it("stays a hint until the clock stops", () => {
    expect(formatPassageResult(null)).toBe("type the snippet");
  });

  it("prints the frozen words per minute, accuracy, and time", () => {
    let state = typeText(createTypingState("ab"), "a");
    let timing = advanceRaceTiming(createRaceTiming(), state, { now: () => 1_000 });
    state = typeText(state, "b");
    timing = advanceRaceTiming(timing, state, { now: () => 11_000 });
    const stats = liveRaceStats(timing, state, 99_000);

    expect(stats.resultLabel).toBe("2 wpm · 100% · 10.0s");
    expect(formatPassageResult(stats.resultLabel)).toBe("passage complete · 2 wpm · 100% · 10.0s");
  });
});

describe("isNextSnippetKey", () => {
  it("accepts enter and tab and ignores typing keys", () => {
    expect(isNextSnippetKey("Enter")).toBe(true);
    expect(isNextSnippetKey("Tab")).toBe(true);
    expect(isNextSnippetKey(" ")).toBe(false);
    expect(isNextSnippetKey("a")).toBe(false);
    expect(isNextSnippetKey("Backspace")).toBe(false);
    expect(isNextSnippetKey("Escape")).toBe(false);
  });
});
