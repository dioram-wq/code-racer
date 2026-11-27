import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RaceResults, resultRows } from "./race-results.js";

const places = [
  { playerId: "bea", name: "Bea", place: 1, timeMs: 12_100, wpm: 40.5 },
  { playerId: "ada", name: "Ada", place: 2, timeMs: 61_500, wpm: 26.4 },
] as const;

describe("resultRows", () => {
  it("keeps server order and labels time and words per minute", () => {
    expect(resultRows(places, "ada")).toEqual([
      {
        playerId: "bea",
        name: "Bea",
        place: 1,
        timeMs: 12_100,
        wpm: 40.5,
        timeLabel: "12.1s",
        wpmLabel: "41",
        self: false,
      },
      {
        playerId: "ada",
        name: "Ada",
        place: 2,
        timeMs: 61_500,
        wpm: 26.4,
        timeLabel: "1:01.5",
        wpmLabel: "26",
        self: true,
      },
    ]);
  });

  it("marks nobody when this socket's id is absent or not in the list", () => {
    expect(resultRows(places, undefined).map((row) => row.self)).toEqual([false, false]);
    expect(resultRows(places, "cy").every((row) => !row.self)).toBe(true);
  });

  it("labels a finish at the start as zero", () => {
    const [row] = resultRows(
      [{ playerId: "ada", name: "Ada", place: 1, timeMs: 0, wpm: 0 }],
      "ada",
    );

    expect(row?.timeLabel).toBe("0.0s");
    expect(row?.wpmLabel).toBe("0");
    expect(row?.self).toBe(true);
  });

  it("returns no rows when nobody finished", () => {
    expect(resultRows([], "ada")).toEqual([]);
  });
});

describe("RaceResults", () => {
  it("renders nothing before a race has finished", () => {
    expect(
      renderToStaticMarkup(createElement(RaceResults, { results: undefined, selfId: "ada" })),
    ).toBe("");
  });

  it("says when the race ended with nobody finished", () => {
    const html = renderToStaticMarkup(createElement(RaceResults, { results: [], selfId: "ada" }));

    expect(html).toContain('aria-label="Race results"');
    expect(html).toContain("no finishes");
    expect(html).not.toContain("<table");
  });

  it("renders place, name, time, and wpm, and marks the local player", () => {
    const html = renderToStaticMarkup(
      createElement(RaceResults, { results: places, selfId: "ada" }),
    );

    expect(html).toContain(">place<");
    expect(html).toContain(">player<");
    expect(html).toContain(">time<");
    expect(html).toContain(">wpm<");
    expect(html).toContain("Bea");
    expect(html).toContain("12.1s");
    expect(html).toContain(">41<");
    expect(html).toContain("Ada");
    expect(html).toContain("1:01.5");
    expect(html).toContain(">26<");
    expect(html.indexOf("Bea")).toBeLessThan(html.indexOf("Ada"));

    const local = html.slice(html.indexOf('data-self="true"'));
    expect(local.startsWith('data-self="true"')).toBe(true);
    expect(local).toContain(">&gt;</span>2");
    expect(local).toContain("Ada");
    expect(html.slice(0, html.indexOf('data-self="true"'))).toContain("> </span>1");
  });
});
