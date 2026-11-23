/**
 * Terminal bars for everyone in the room except the local player.
 *
 * The fraction is `position / length`, floored onto a fixed row of cells.
 * A finished player fills the row. Before a snippet is known the row stays
 * empty and the status is the raw position, because there is nothing to
 * scale it against.
 */

/** Cells in one bar, filled with `#` then padded with `-`. */
export const OTHER_PLAYER_BAR_CELLS = 16;

/** One player, as folded from the room broadcasts. */
export interface StandingPlayer {
  readonly id: string;
  readonly name: string;
  readonly position: number;
  readonly finished: boolean;
}

/** One row the race screen can render. */
export interface OtherPlayerRow {
  readonly id: string;
  readonly name: string;
  /** `filled` cells of `#`, then `-`, always `OTHER_PLAYER_BAR_CELLS` long. */
  readonly bar: string;
  readonly filled: number;
  readonly position: number;
  /** Snippet length. Absent before the race-start frame. */
  readonly length: number | undefined;
  readonly finished: boolean;
  /** `8/40`, `done`, or the raw position when the snippet length is unknown. */
  readonly status: string;
}

/**
 * Rows for the other players, in the order they joined.
 *
 * `selfId` is left out. When it is omitted, every player is listed, because
 * the screen does not yet know which id belongs to this socket.
 */
export function otherPlayerRows(
  players: readonly StandingPlayer[],
  snippetLength: number | undefined,
  selfId: string | undefined,
): readonly OtherPlayerRow[] {
  const rows: OtherPlayerRow[] = [];
  for (const player of players) {
    if (selfId !== undefined && player.id === selfId) {
      continue;
    }
    const filled = filledCells(player.position, snippetLength, player.finished);
    rows.push({
      id: player.id,
      name: player.name,
      bar: "#".repeat(filled) + "-".repeat(OTHER_PLAYER_BAR_CELLS - filled),
      filled,
      position: player.position,
      length: snippetLength,
      finished: player.finished,
      status: statusLabel(player.position, snippetLength, player.finished),
    });
  }
  return rows;
}

/** The list under the passage. Renders nothing when this socket is alone. */
export function RaceStandings({ rows }: { readonly rows: readonly OtherPlayerRow[] }) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <section className="standings" aria-label="Other players">
      <p className="standings-label">room</p>
      <ol className="standings-list">
        {rows.map((row) => (
          <li
            key={row.id}
            className="standings-player"
            data-finished={row.finished ? "true" : "false"}
          >
            <span className="standings-name">{row.name}</span>
            <span className="standings-bar" aria-hidden="true">
              [{row.bar}]
            </span>
            <span className="standings-status">{row.status}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

function filledCells(position: number, length: number | undefined, finished: boolean): number {
  if (finished) {
    return OTHER_PLAYER_BAR_CELLS;
  }
  if (length === undefined || length <= 0 || position <= 0) {
    return 0;
  }
  const ratio = Math.min(position, length) / length;
  return Math.floor(ratio * OTHER_PLAYER_BAR_CELLS);
}

function statusLabel(position: number, length: number | undefined, finished: boolean): string {
  if (finished) {
    return "done";
  }
  if (length === undefined) {
    return String(position);
  }
  return `${position}/${length}`;
}
