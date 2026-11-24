/**
 * Swaps the passage on screen for the snippet a race-start frame named.
 *
 * The typing engine and the clock start over, and the language row follows
 * the snippet. A passage that is already that snippet and has not started is
 * returned as it was, so a repeated frame does not reset it. This module does
 * not open a socket.
 */

import type { Snippet } from "@code-racer/shared";
import type { LanguagePassage } from "./race-language.js";
import { openPassage } from "./race-passage.js";

/**
 * The passage to show for `snippet`.
 *
 * Returns `current` when the language, the snippet, and a still-unstarted
 * buffer already match. Otherwise the clock and the buffer are cleared.
 */
export function adoptRacePassage(current: LanguagePassage, snippet: Snippet): LanguagePassage {
  const session = current.session;
  if (
    current.language === snippet.language &&
    session.snippet.id === snippet.id &&
    session.snippet.language === snippet.language &&
    session.snippet.title === snippet.title &&
    session.snippet.code === snippet.code &&
    session.typing.cursor === 0 &&
    !session.typing.started &&
    session.timing.startedAt === null
  ) {
    return current;
  }
  return { language: snippet.language, session: openPassage(snippet) };
}

/**
 * True while this socket is in a room and the passage on screen is that
 * race's snippet, and the local buffer has not finished.
 *
 * The language row uses this to avoid swapping the shared passage for a
 * local one. A finished passage is free to change.
 */
export function racePassageIsOnScreen(
  current: LanguagePassage,
  snippet: Snippet | undefined,
  joined: boolean,
): boolean {
  if (!joined || snippet === undefined || current.session.typing.finished) {
    return false;
  }
  return current.session.snippet.id === snippet.id && current.session.snippet.code === snippet.code;
}
