import {
  LANGUAGES,
  createTypingState,
  getSnippet,
  typeText,
  type Language,
  type PickSnippetOptions,
  type Snippet,
} from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import {
  RACE_LANGUAGES,
  advanceLanguagePassage,
  changeLanguagePassage,
  isRaceLanguage,
  selectSnippetForLanguage,
  type LanguageCatalog,
  type LanguagePassage,
} from "./race-language.js";
import { openPassage } from "./race-passage.js";
import { advanceRaceTiming, createRaceTiming, liveRaceStats } from "./race-stats.js";

function snippet(id: string, language: Language, code = `const ${id} = 1;`): Snippet {
  return {
    id,
    language,
    title: id,
    code,
  };
}

function catalogOf(snippets: readonly Snippet[]): LanguageCatalog & { calls: PickSnippetOptions[] } {
  return {
    calls: [],
    list(language) {
      if (language === undefined) {
        return snippets;
      }
      return snippets.filter((entry) => entry.language === language);
    },
    pick(options) {
      this.calls.push(options);
      const excluded = new Set(options.excludeIds ?? []);
      const pool = snippets.filter(
        (entry) =>
          (options.language === undefined || entry.language === options.language) &&
          !excluded.has(entry.id),
      );
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

function requireSnippet(id: string): Snippet {
  const found = getSnippet(id);
  if (found === undefined) {
    throw new Error(`missing snippet: ${id}`);
  }
  return found;
}

describe("race languages", () => {
  it("offers any plus every catalog language", () => {
    expect([...RACE_LANGUAGES]).toEqual(["any", "javascript", "typescript", "python", "go", "rust"]);
    expect(isRaceLanguage("any")).toBe(true);
    expect(isRaceLanguage("rust")).toBe(true);
    expect(isRaceLanguage("Go")).toBe(false);
    expect(isRaceLanguage("ruby")).toBe(false);
  });
});

describe("selectSnippetForLanguage", () => {
  it("asks the generator for one language and skips the snippet on screen", () => {
    const source = catalogOf([
      snippet("js-a", "javascript"),
      snippet("js-b", "javascript"),
      snippet("py-a", "python"),
    ]);

    expect(selectSnippetForLanguage("javascript", "js-a", { seed: 0, source }).id).toBe("js-b");
    expect(source.calls).toEqual([{ language: "javascript", seed: 0, excludeIds: ["js-a"] }]);
  });

  it("does not exclude an id that is outside the chosen language", () => {
    const source = catalogOf([
      snippet("js-a", "javascript"),
      snippet("py-a", "python"),
      snippet("py-b", "python"),
    ]);

    const next = selectSnippetForLanguage("python", "js-a", { seed: 1, source });

    expect(next.language).toBe("python");
    expect(next.id).toBe("py-b");
    expect(source.calls).toEqual([{ language: "python", seed: 1 }]);
  });

  it("keeps the only snippet in that language", () => {
    const only = snippet("go-only", "go", "func only() int {\n\treturn 1\n}");
    const source = catalogOf([only, snippet("js-a", "javascript")]);

    expect(selectSnippetForLanguage("go", only.id, { source })).toEqual(only);
    expect(source.calls).toEqual([{ language: "go" }]);
  });

  it("stays inside the chosen language for every seed", () => {
    for (const language of LANGUAGES) {
      const current = requireSnippet(selectSnippetForLanguage(language, undefined, { seed: 0 }).id);
      for (let seed = 0; seed < 12; seed += 1) {
        const next = selectSnippetForLanguage(language, current.id, { seed });
        expect(next.language).toBe(language);
        expect(selectSnippetForLanguage(language, current.id, { seed })).toEqual(next);
      }
    }
  });

  it("draws from every language when the choice is any, without an immediate repeat", () => {
    const source = catalogOf([
      snippet("js-a", "javascript"),
      snippet("py-a", "python"),
      snippet("go-a", "go"),
    ]);

    expect(selectSnippetForLanguage("any", "js-a", { seed: 0, source }).id).toBe("py-a");
    expect(source.calls).toEqual([{ seed: 0, excludeIds: ["js-a"] }]);

    const seen = new Set<string>();
    for (let seed = 0; seed < 30; seed += 1) {
      const picked = selectSnippetForLanguage("any", undefined, { seed });
      expect(selectSnippetForLanguage("any", undefined, { seed })).toEqual(picked);
      expect(LANGUAGES).toContain(picked.language);
      seen.add(picked.language);
      expect(selectSnippetForLanguage("any", picked.id, { seed }).id).not.toBe(picked.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe("changeLanguagePassage", () => {
  it("loads a snippet in the new language and resets typing and the clock", () => {
    const current = requireSnippet("go-sum");
    const typed = typeText(createTypingState(current.code), "func");
    const race: LanguagePassage = {
      language: "go",
      session: {
        snippet: current,
        typing: typed,
        timing: advanceRaceTiming(createRaceTiming(), typed, { now: () => 2_500 }),
        now: 2_500,
      },
    };

    const next = changeLanguagePassage(race, "rust", { seed: 3 });

    expect(next.language).toBe("rust");
    expect(next.session.snippet.language).toBe("rust");
    expect(next.session.snippet.id).not.toBe(current.id);
    expect(next.session.typing).toEqual(createTypingState(next.session.snippet.code));
    expect(next.session.typing.started).toBe(false);
    expect(next.session.timing).toEqual(createRaceTiming());
    expect(next.session.now).toBe(0);
    expect(liveRaceStats(next.session.timing, next.session.typing, next.session.now)).toMatchObject({
      elapsedMs: 0,
      elapsedLabel: "0.0s",
      running: false,
      finished: false,
      resultLabel: null,
    });
  });

  it("lets any replace a named language without repeating the passage", () => {
    const current = requireSnippet("rs-clamp");
    const race: LanguagePassage = {
      language: "rust",
      session: {
        ...openPassage(current),
        typing: typeText(createTypingState(current.code), "fn"),
        timing: { startedAt: 10, finishedAt: 4_000 },
        now: 4_000,
      },
    };

    const next = changeLanguagePassage(race, "any", { seed: 5 });

    expect(next.language).toBe("any");
    expect(next.session.snippet.id).not.toBe(current.id);
    expect(LANGUAGES).toContain(next.session.snippet.language);
    expect(next.session.typing.typed).toBe("");
    expect(next.session.timing.finishedAt).toBeNull();
    expect(next.session.now).toBe(0);
  });

  it("keeps the passage when the language does not change", () => {
    const race: LanguagePassage = {
      language: "python",
      session: openPassage(requireSnippet("py-average")),
    };

    expect(changeLanguagePassage(race, "python", { seed: 4 })).toBe(race);
  });
});

describe("advanceLanguagePassage", () => {
  it("stays in the chosen language and clears a finished passage", () => {
    const current = requireSnippet("js-sum");
    const race: LanguagePassage = {
      language: "javascript",
      session: {
        snippet: current,
        typing: typeText(createTypingState(current.code), current.code),
        timing: { startedAt: 20, finishedAt: 8_000 },
        now: 8_000,
      },
    };

    const next = advanceLanguagePassage(race, { seed: 1 });

    expect(next.language).toBe("javascript");
    expect(next.session.snippet.language).toBe("javascript");
    expect(next.session.snippet.id).not.toBe(current.id);
    expect(next.session.typing).toEqual(createTypingState(next.session.snippet.code));
    expect(next.session.timing).toEqual(createRaceTiming());
    expect(next.session.now).toBe(0);
  });

  it("keeps any selected while the next passage has its own language", () => {
    const current = requireSnippet("ts-clamp");
    const race: LanguagePassage = {
      language: "any",
      session: openPassage(current),
    };

    const next = advanceLanguagePassage(race, { seed: 8 });

    expect(next.language).toBe("any");
    expect(next.session.snippet.id).not.toBe(current.id);
    expect(LANGUAGES).toContain(next.session.snippet.language);
  });

  it("repeats the only match and still resets typing", () => {
    const only = snippet("py-only", "python", "def only():\n    return 1");
    const source = catalogOf([only]);
    const race: LanguagePassage = {
      language: "python",
      session: {
        snippet: only,
        typing: typeText(createTypingState(only.code), "def"),
        timing: { startedAt: 1, finishedAt: null },
        now: 40,
      },
    };

    const next = advanceLanguagePassage(race, { source });

    expect(next.session.snippet).toEqual(only);
    expect(next.session.typing.typed).toBe("");
    expect(next.session.timing).toEqual(createRaceTiming());
    expect(next.session.now).toBe(0);
    expect(source.calls).toEqual([{ language: "python" }]);
  });
});
