import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  OTHER_PLAYER_BAR_CELLS,
  otherPlayerRows,
  RaceStandings,
  type StandingPlayer,
} from "./race-standings.js";

const ada: StandingPlayer = { id: "ada", name: "Ada", position: 4, finished: false };
const bea: StandingPlayer = { id: "bea", name: "Bea", position: 8, finished: false };
const cy: StandingPlayer = { id: "cy", name: "Cy", position: 16, finished: true };

describe("otherPlayerRows", () => {
  it("lists the other players in join order and leaves the local player out", () => {
    expect(otherPlayerRows([ada, bea, cy], 16, "ada").map((row) => row.name)).toEqual([
      "Bea",
      "Cy",
    ]);
  });

  it("lists everyone when this socket does not know its own id", () => {
    expect(otherPlayerRows([ada, bea], 16, undefined).map((row) => row.id)).toEqual(["ada", "bea"]);
  });

  it("returns no rows when nobody else is in the room", () => {
    expect(otherPlayerRows([], 16, undefined)).toEqual([]);
    expect(otherPlayerRows([ada], 16, "ada")).toEqual([]);
  });

  it("scales the bar from the cursor and shows the position over the snippet length", () => {
    const [row] = otherPlayerRows([bea], 16, "ada");

    expect(row).toEqual({
      id: "bea",
      name: "Bea",
      bar: "########--------",
      filled: 8,
      position: 8,
      length: 16,
      finished: false,
      status: "8/16",
    });
  });

  it("floors a partial cell so the bar is not full before the end", () => {
    const partial: StandingPlayer = { id: "bea", name: "Bea", position: 1, finished: false };
    const [row] = otherPlayerRows([partial], 10, undefined);

    expect(row?.filled).toBe(1);
    expect(row?.bar).toBe("#---------------");
    expect(row?.status).toBe("1/10");
    expect(row?.bar).toHaveLength(OTHER_PLAYER_BAR_CELLS);
  });

  it("fills the bar and says done when that player has finished", () => {
    const [row] = otherPlayerRows([cy], 16, "ada");

    expect(row?.bar).toBe("################");
    expect(row?.filled).toBe(OTHER_PLAYER_BAR_CELLS);
    expect(row?.status).toBe("done");
    expect(row?.finished).toBe(true);
  });

  it("leaves the bar empty before a snippet length is known", () => {
    const [row] = otherPlayerRows([bea], undefined, undefined);

    expect(row?.bar).toBe("----------------");
    expect(row?.length).toBeUndefined();
    expect(row?.status).toBe("8");
  });
});

describe("RaceStandings", () => {
  it("renders nothing when there are no other players", () => {
    expect(renderToStaticMarkup(createElement(RaceStandings, { rows: [] }))).toBe("");
  });

  it("renders a terminal bar, the name, and the status for each other player", () => {
    const rows = otherPlayerRows([ada, bea, cy], 16, "ada");
    const html = renderToStaticMarkup(createElement(RaceStandings, { rows }));

    expect(html).toContain('aria-label="Other players"');
    expect(html).toContain("Bea");
    expect(html).toContain("[########--------]");
    expect(html).toContain("8/16");
    expect(html).toContain("Cy");
    expect(html).toContain("[################]");
    expect(html).toContain("done");
    expect(html).toContain('data-finished="true"');
    expect(html).not.toContain("Ada");
    expect(html).not.toContain(">4/16<");
  });
});
