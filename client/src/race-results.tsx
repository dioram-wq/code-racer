/**
 * Terminal table for a finished multiplayer race.
 *
 * Rows come from the `race-results` frame: `place`, `name`, `timeMs`, and
 * `wpm`, in the order the server sent. Time is the race clock's label for
 * `timeMs`. Words per minute are that figure rounded to the nearest integer,
 * the same way the live readout labels WPM. The local player's row is the
 * one whose `playerId` is this socket's id.
 */

import type { RaceResultEntry } from "@code-racer/shared";
import { formatElapsed } from "./race-stats.js";

/** One finisher, ready for the race screen. */
export interface ResultRow {
  readonly playerId: string;
  readonly name: string;
  readonly place: number;
  readonly timeMs: number;
  readonly wpm: number;
  /** `timeMs`, floored to a tenth of a second. */
  readonly timeLabel: string;
  /** `wpm`, rounded to the nearest integer. */
  readonly wpmLabel: string;
  /** True when `playerId` is this socket. */
  readonly self: boolean;
}

/**
 * Display rows for `results`, in server order.
 *
 * `selfId` marks the local player. When it is omitted, no row is marked.
 */
export function resultRows(
  results: readonly RaceResultEntry[],
  selfId: string | undefined,
): readonly ResultRow[] {
  return results.map((entry) => ({
    playerId: entry.playerId,
    name: entry.name,
    place: entry.place,
    timeMs: entry.timeMs,
    wpm: entry.wpm,
    timeLabel: formatElapsed(entry.timeMs),
    wpmLabel: String(Math.round(entry.wpm)),
    self: selfId !== undefined && entry.playerId === selfId,
  }));
}

/**
 * The places under the passage.
 *
 * Renders nothing before a race-results frame. An empty list is the race
 * that ended with nobody finished.
 */
export function RaceResults({
  results,
  selfId,
}: {
  readonly results: readonly RaceResultEntry[] | undefined;
  readonly selfId: string | undefined;
}) {
  if (results === undefined) {
    return null;
  }
  const rows = resultRows(results, selfId);
  return (
    <section className="results" aria-label="Race results">
      <p className="results-label">results</p>
      {rows.length === 0 ? (
        <p className="results-empty">no finishes</p>
      ) : (
        <table className="results-table">
          <thead>
            <tr>
              <th scope="col">place</th>
              <th scope="col">player</th>
              <th scope="col">time</th>
              <th scope="col">wpm</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.playerId} data-self={row.self ? "true" : "false"}>
                <td className="results-place">
                  <span className="results-mark" aria-hidden="true">
                    {row.self ? ">" : " "}
                  </span>
                  {row.place}
                </td>
                <td className="results-name">{row.name}</td>
                <td className="results-time">{row.timeLabel}</td>
                <td className="results-wpm">{row.wpmLabel}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
