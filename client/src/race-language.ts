import {
  LANGUAGES,
  isLanguage,
  listSnippets,
  pickSnippet,
  type Language,
  type PickSnippetOptions,
  type Snippet,
} from "@code-racer/shared";
import { openPassage, type PassageSession } from "./race-passage.js";

/**
 * Language filter for the single-player screen.
 *
 * A named language asks the shared generator for that language only. "any"
 * leaves the language unset, so the pick can come from the whole catalog.
 * The snippet on screen is skipped when another match exists.
 */

export const RACE_LANGUAGES = ["any", ...LANGUAGES] as const;

export type RaceLanguage = (typeof RACE_LANGUAGES)[number];

/** True for "any" and for every language the catalog can generate. */
export function isRaceLanguage(value: string): value is RaceLanguage {
  return value === "any" || isLanguage(value);
}

/** A snippet catalog the filter can read. Tests pass a fake one. */
export interface LanguageCatalog {
  list(language?: Language): readonly { readonly id: string }[];
  pick(options: PickSnippetOptions): Snippet;
}

export interface LanguageSnippetOptions {
  /** Same seed, language, current id, and source always pick the same snippet. */
  readonly seed?: number;
  readonly source?: LanguageCatalog;
}

/** The filter and the passage currently on screen. */
export interface LanguagePassage {
  readonly language: RaceLanguage;
  readonly session: PassageSession;
}

const sharedCatalog: LanguageCatalog = {
  list(language) {
    if (language === undefined) {
      return listSnippets();
    }
    return listSnippets(language);
  },
  pick(options) {
    return pickSnippet(options);
  },
};

/**
 * Choose a snippet for `language`.
 *
 * "any" does not set a language, so the generator uses the whole catalog.
 * The current id is excluded only when it is in that pool and another
 * snippet is left. A pool of one keeps that snippet.
 */
export function selectSnippetForLanguage(
  language: RaceLanguage,
  currentId?: string,
  options: LanguageSnippetOptions = {},
): Snippet {
  const source = options.source ?? sharedCatalog;
  const pool = language === "any" ? source.list() : source.list(language);
  const filter = language === "any" ? undefined : language;
  return source.pick(pickOptions(filter, options.seed, excludeCurrent(pool, currentId)));
}

/**
 * Switch filters and open a fresh passage.
 *
 * Choosing the language already on screen returns `race`, so a repeated
 * click does not wipe the typing state or the clock. Any other choice loads
 * a new snippet and clears both.
 */
export function changeLanguagePassage(
  race: LanguagePassage,
  language: RaceLanguage,
  options: LanguageSnippetOptions = {},
): LanguagePassage {
  if (race.language === language) {
    return race;
  }
  return openLanguagePassage(language, race.session.snippet.id, options);
}

/**
 * The next passage for the filter already chosen.
 *
 * The language stays put, including "any". Typing and the clock start over,
 * and the snippet just shown is skipped when another match exists.
 */
export function advanceLanguagePassage(
  race: LanguagePassage,
  options: LanguageSnippetOptions = {},
): LanguagePassage {
  return openLanguagePassage(race.language, race.session.snippet.id, options);
}

function openLanguagePassage(
  language: RaceLanguage,
  currentId: string | undefined,
  options: LanguageSnippetOptions,
): LanguagePassage {
  return {
    language,
    session: openPassage(selectSnippetForLanguage(language, currentId, options)),
  };
}

/**
 * Skip `currentId` when the pool contains it and still has another snippet.
 * An id from a different language is not in the pool, so it is not listed.
 */
function excludeCurrent(
  pool: readonly { readonly id: string }[],
  currentId: string | undefined,
): readonly string[] | undefined {
  if (currentId === undefined) {
    return undefined;
  }
  const currentIsInPool = pool.some((snippet) => snippet.id === currentId);
  const anotherExists = pool.some((snippet) => snippet.id !== currentId);
  if (currentIsInPool && anotherExists) {
    return [currentId];
  }
  return undefined;
}

function pickOptions(
  language: Language | undefined,
  seed: number | undefined,
  excludeIds: readonly string[] | undefined,
): PickSnippetOptions {
  if (language !== undefined && seed !== undefined && excludeIds !== undefined) {
    return { language, seed, excludeIds };
  }
  if (language !== undefined && seed !== undefined) {
    return { language, seed };
  }
  if (language !== undefined && excludeIds !== undefined) {
    return { language, excludeIds };
  }
  if (seed !== undefined && excludeIds !== undefined) {
    return { seed, excludeIds };
  }
  if (language !== undefined) {
    return { language };
  }
  if (seed !== undefined) {
    return { seed };
  }
  if (excludeIds !== undefined) {
    return { excludeIds };
  }
  return {};
}
