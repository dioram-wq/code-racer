/**
 * Short code passages a race can ask the player to type.
 *
 * Each snippet is real code in one language, kept narrow enough to finish in
 * a single race. Go uses tabs, matching gofmt; the other languages use spaces.
 * `pickSnippet` chooses one. Pass a seed when every client must show the same
 * passage.
 */

export const LANGUAGES = ["javascript", "typescript", "python", "go", "rust"] as const;

export type Language = (typeof LANGUAGES)[number];

/** A passage the player types, tagged with the language it is written in. */
export interface Snippet {
  readonly id: string;
  readonly language: Language;
  /** Short label for the race header. */
  readonly title: string;
  /** Exact characters to type. No trailing newline and no trailing spaces. */
  readonly code: string;
}

export interface PickSnippetOptions {
  readonly language?: Language;
  /**
   * Non-negative integer. Reduced to 32 bits. The same seed, language, and
   * exclusions always return the same snippet.
   */
  readonly seed?: number;
  /** Skip these ids so a race can avoid repeating the passage just played. */
  readonly excludeIds?: readonly string[];
}

const LANGUAGE_SET: ReadonlySet<string> = new Set(LANGUAGES);

const SNIPPETS: readonly Snippet[] = [
  {
    id: "js-sum",
    language: "javascript",
    title: "Sum an array",
    code: `function sum(values) {
  return values.reduce((total, value) => total + value, 0);
}`,
  },
  {
    id: "js-range",
    language: "javascript",
    title: "Build a half-open range",
    code: `function range(start, end) {
  const values = [];
  for (let i = start; i < end; i += 1) {
    values.push(i);
  }
  return values;
}`,
  },
  {
    id: "ts-clamp",
    language: "typescript",
    title: "Clamp a number",
    code: `function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}`,
  },
  {
    id: "ts-is-blank",
    language: "typescript",
    title: "Check for blank text",
    code: `function isBlank(value: string | null): boolean {
  return value === null || value.trim() === "";
}`,
  },
  {
    id: "py-average",
    language: "python",
    title: "Average a list",
    code: `def average(values):
    if not values:
        return 0
    return sum(values) / len(values)`,
  },
  {
    id: "py-counts",
    language: "python",
    title: "Count items",
    code: `def counts(items):
    totals = {}
    for item in items:
        totals[item] = totals.get(item, 0) + 1
    return totals`,
  },
  {
    id: "go-contains",
    language: "go",
    title: "Search a slice",
    code: `func contains(values []string, target string) bool {
\tfor _, value := range values {
\t\tif value == target {
\t\t\treturn true
\t\t}
\t}
\treturn false
}`,
  },
  {
    id: "go-sum",
    language: "go",
    title: "Sum a slice",
    code: `func sum(values []int) int {
\ttotal := 0
\tfor _, value := range values {
\t\ttotal += value
\t}
\treturn total
}`,
  },
  {
    id: "rs-clamp",
    language: "rust",
    title: "Clamp an integer",
    code: `fn clamp(value: i32, min: i32, max: i32) -> i32 {
    value.max(min).min(max)
}`,
  },
  {
    id: "rs-title-case",
    language: "rust",
    title: "Capitalize a word",
    code: `fn title_case(word: &str) -> String {
    let mut chars = word.chars();
    match chars.next() {
        None => String::new(),
        Some(first) => {
            let head: String = first.to_uppercase().collect();
            head + chars.as_str()
        }
    }
}`,
  },
];

/** True when `value` is one of the languages the catalog can generate. */
export function isLanguage(value: string): value is Language {
  return LANGUAGE_SET.has(value);
}

/** Snippets in catalog order, optionally limited to one language. */
export function listSnippets(language?: Language): readonly Snippet[] {
  if (language !== undefined) {
    assertLanguage(language);
    return SNIPPETS.filter((snippet) => snippet.language === language);
  }
  return SNIPPETS;
}

/** The snippet with this id, or undefined when the catalog has no such id. */
export function getSnippet(id: string): Snippet | undefined {
  return SNIPPETS.find((snippet) => snippet.id === id);
}

/**
 * Choose a snippet for a race.
 *
 * A seed makes the choice depend only on that seed, the language, and the
 * excluded ids. Without a seed, the choice uses `Math.random`.
 *
 * Throws when the language is unknown, the seed is not a non-negative
 * integer, or every matching snippet was excluded.
 */
export function pickSnippet(options: PickSnippetOptions = {}): Snippet {
  if (options.language !== undefined) {
    assertLanguage(options.language);
  }
  if (options.seed !== undefined) {
    assertSeed(options.seed);
  }

  const excluded = new Set(options.excludeIds ?? []);
  const pool = listSnippets(options.language).filter((snippet) => !excluded.has(snippet.id));
  if (pool.length === 0) {
    throw new RangeError("no snippets match the given language and exclusions");
  }

  const index =
    options.seed === undefined
      ? Math.floor(Math.random() * pool.length)
      : Math.floor(unitInterval(options.seed) * pool.length);
  const snippet = pool[index];
  if (snippet === undefined) {
    throw new RangeError("snippet index was out of range");
  }
  return snippet;
}

function assertLanguage(language: string): asserts language is Language {
  if (!isLanguage(language)) {
    throw new RangeError(`unknown language: ${language}`);
  }
}

function assertSeed(seed: number): void {
  if (!Number.isInteger(seed) || seed < 0) {
    throw new RangeError("seed must be a non-negative integer");
  }
}

/**
 * 32-bit mix mapped onto [0, 1).
 *
 * A plain linear congruential step leaves nearby seeds in the same bucket,
 * so a race counter of 1, 2, 3 would repeat one snippet. This mix (lowbias32)
 * spreads those seeds across the catalog. Only the low 32 bits affect it.
 */
function unitInterval(seed: number): number {
  let mixed = seed >>> 0;
  mixed = Math.imul(mixed ^ (mixed >>> 16), 0x7feb352d);
  mixed = Math.imul(mixed ^ (mixed >>> 15), 0x846ca68b);
  return ((mixed ^ (mixed >>> 16)) >>> 0) / 4294967296;
}
