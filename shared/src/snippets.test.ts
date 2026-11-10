import { describe, expect, it } from "vitest";
import {
  LANGUAGES,
  getSnippet,
  isLanguage,
  listSnippets,
  pickSnippet,
} from "./index.js";
import type { Language } from "./index.js";

describe("snippet catalog", () => {
  it("covers the languages a race can ask for", () => {
    expect([...LANGUAGES]).toEqual(["javascript", "typescript", "python", "go", "rust"]);
    expect(isLanguage("python")).toBe(true);
    expect(isLanguage("Go")).toBe(false);
    expect(isLanguage("ruby")).toBe(false);
  });

  it("gives every language at least two typeable passages", () => {
    const ids = new Set<string>();
    for (const snippet of listSnippets()) {
      expect(ids.has(snippet.id)).toBe(false);
      ids.add(snippet.id);
      expect(snippet.title.trim()).toBe(snippet.title);
      expect(snippet.title.length).toBeGreaterThan(0);
      expect(snippet.code.length).toBeGreaterThanOrEqual(40);
      expect(snippet.code.endsWith("\n")).toBe(false);
      expect(snippet.code.includes("\r")).toBe(false);
      for (const line of snippet.code.split("\n")) {
        expect(line.length).toBeLessThanOrEqual(72);
        expect(line.endsWith(" ")).toBe(false);
        expect(line.endsWith("\t")).toBe(false);
      }
      if (snippet.language === "go") {
        expect(snippet.code).toContain("\t");
      } else {
        expect(snippet.code).not.toContain("\t");
      }
    }

    for (const language of LANGUAGES) {
      expect(listSnippets(language).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("filters by language and looks up an id", () => {
    const python = listSnippets("python");
    expect(python.length).toBeGreaterThan(0);
    expect(python.every((snippet) => snippet.language === "python")).toBe(true);
    expect(getSnippet(python[0]?.id ?? "")).toEqual(python[0]);
    expect(getSnippet("missing")).toBeUndefined();
  });

  it("rejects an unknown language instead of looking like an empty catalog", () => {
    expect(() => listSnippets("ruby" as Language)).toThrow(RangeError);
    expect(() => pickSnippet({ language: "ruby" as Language })).toThrow(/unknown language: ruby/);
  });
});

describe("pickSnippet", () => {
  it("repeats a seeded choice and varies across seeds", () => {
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed += 1) {
      const once = pickSnippet({ seed });
      expect(pickSnippet({ seed })).toEqual(once);
      seen.add(once.id);
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("stays inside the requested language for every seed", () => {
    for (const language of LANGUAGES) {
      for (let seed = 0; seed < 20; seed += 1) {
        expect(pickSnippet({ language, seed }).language).toBe(language);
      }
    }
  });

  it("skips excluded ids and returns the only snippet left", () => {
    const first = pickSnippet({ seed: 7 });
    const second = pickSnippet({ seed: 7, excludeIds: [first.id] });
    expect(second.id).not.toBe(first.id);

    const python = listSnippets("python");
    const keep = python[0];
    if (keep === undefined) {
      throw new Error("expected python snippets");
    }
    const excludeIds = python.slice(1).map((snippet) => snippet.id);
    expect(pickSnippet({ language: "python", seed: 3, excludeIds })).toEqual(keep);
  });

  it("throws when every matching snippet is excluded", () => {
    const excludeIds = listSnippets("go").map((snippet) => snippet.id);
    expect(() => pickSnippet({ language: "go", seed: 1, excludeIds })).toThrow(RangeError);
  });

  it("rejects a seed that is not a non-negative integer", () => {
    expect(() => pickSnippet({ seed: -1 })).toThrow(RangeError);
    expect(() => pickSnippet({ seed: 1.5 })).toThrow(RangeError);
    expect(() => pickSnippet({ seed: Number.NaN })).toThrow(RangeError);
  });

  it("picks a catalog snippet when no seed is given", () => {
    const picked = pickSnippet();
    expect(getSnippet(picked.id)).toEqual(picked);
  });

  it("reduces seeds to 32 bits", () => {
    expect(pickSnippet({ seed: 0x1_0000_0007 })).toEqual(pickSnippet({ seed: 7 }));
  });
});
