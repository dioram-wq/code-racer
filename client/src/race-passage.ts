import {
  createTypingState,
  listSnippets,
  pickSnippet,
  type PickSnippetOptions,
  type Snippet,
  type TypingState,
} from "@code-racer/shared";
import { createRaceTiming, type RaceTiming } from "./race-stats.js";

/**
 * One passage on the single-player screen.
 *
 * The typing engine and the race clock stay separate. This module is the
 * piece that swaps the snippet and clears both when the player asks for
 * another passage.
 */

/** A snippet catalog the next-passage choice can read. Tests pass a fake one. */
export interface SnippetSource {
  list(): readonly { readonly id: string }[];
  pick(options: PickSnippetOptions): Snippet;
}

export interface NextSnippetOptions {
  /** Same seed, current id, and source always pick the same snippet. */
  readonly seed?: number;
  readonly source?: SnippetSource;
}

/** Snippet, typing buffer, and clock for the passage on screen. `now` is the latest sample. */
export interface PassageSession {
  readonly snippet: Snippet;
  readonly typing: TypingState;
  readonly timing: RaceTiming;
  readonly now: number;
}

const catalog: SnippetSource = {
  list() {
    return listSnippets();
  },
  pick(options) {
    return pickSnippet(options);
  },
};

/**
 * Choose the passage that follows `currentId`.
 *
 * The shared generator skips that id when another snippet exists, so the next
 * race is not an immediate repeat. A catalog of one snippet has nothing else
 * to offer, and then the same passage is allowed.
 */
export function selectNextSnippet(currentId: string, options: NextSnippetOptions = {}): Snippet {
  const source = options.source ?? catalog;
  const anotherExists = source.list().some((snippet) => snippet.id !== currentId);
  return source.pick(pickOptions(options.seed, anotherExists ? [currentId] : undefined));
}

/** A passage that has not started. The clock sample is zero until the first keystroke. */
export function openPassage(snippet: Snippet): PassageSession {
  return {
    snippet,
    typing: createTypingState(snippet.code),
    timing: createRaceTiming(),
    now: 0,
  };
}

/** Replace the passage with a new snippet and a cleared typing buffer and clock. */
export function advancePassage(session: PassageSession, options: NextSnippetOptions = {}): PassageSession {
  return openPassage(selectNextSnippet(session.snippet.id, options));
}

/**
 * The line under the passage.
 *
 * While the race is open this is the typing hint. After the clock stops it is
 * the final words per minute, accuracy, and time from `liveRaceStats`.
 */
export function formatPassageResult(resultLabel: string | null): string {
  if (resultLabel === null) {
    return "type the snippet";
  }
  return `passage complete · ${resultLabel}`;
}

/** Keys that load the next snippet once the passage is finished. */
export function isNextSnippetKey(key: string): boolean {
  return key === "Enter" || key === "Tab";
}

function pickOptions(
  seed: number | undefined,
  excludeIds: readonly string[] | undefined,
): PickSnippetOptions {
  if (seed !== undefined && excludeIds !== undefined) {
    return { seed, excludeIds };
  }
  if (seed !== undefined) {
    return { seed };
  }
  if (excludeIds !== undefined) {
    return { excludeIds };
  }
  return {};
}
