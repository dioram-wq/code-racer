import { backspace, createTypingState, typeText } from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import {
  applyServerRoomMessage,
  createRaceRoomState,
  parseServerRoomMessage,
  progressMessage,
  reduceRaceRoom,
  type RaceRoomState,
} from "./race-protocol.js";

const ada = { id: "ada", name: "Ada" };
const bea = { id: "bea", name: "Bea" };

const snippet = {
  id: "tiny",
  language: "typescript" as const,
  title: "Tiny",
  code: "ab",
};

const startsAt = 1700000003000;

describe("progressMessage", () => {
  it("reports the cursor before any keystroke", () => {
    expect(progressMessage(createTypingState("ab"))).toEqual({ type: "progress", position: 0 });
  });

  it("counts mistakes, newlines, and tabs", () => {
    const typed = typeText(createTypingState("a\n\tb"), "x\n\t");

    expect(progressMessage(typed)).toEqual({ type: "progress", position: 3 });
  });

  it("follows the cursor when a character is deleted", () => {
    const typed = typeText(createTypingState("ab"), "a");

    expect(progressMessage(backspace(typed))).toEqual({ type: "progress", position: 0 });
  });

  it("reports the target length when the passage is finished", () => {
    const done = typeText(createTypingState("ab"), "ab");

    expect(done.finished).toBe(true);
    expect(progressMessage(done)).toEqual({ type: "progress", position: 2 });
  });
});

describe("parseServerRoomMessage", () => {
  it("parses a player list, a race start, and progress, ignoring extra fields", () => {
    expect(
      parseServerRoomMessage(
        JSON.stringify({
          type: "players",
          roomId: " ab12 ",
          players: [{ id: " ada ", name: "  Ada  ", host: true }],
          extra: true,
        }),
      ),
    ).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "ada", name: "Ada" }],
    });

    expect(
      parseServerRoomMessage(
        JSON.stringify({
          type: "race-start",
          roomId: "ab12",
          snippet: { ...snippet, note: "drop me" },
          startsAt,
          extra: 1,
        }),
      ),
    ).toEqual({ type: "race-start", roomId: "AB12", snippet, startsAt });

    expect(
      parseServerRoomMessage(
        JSON.stringify({
          type: "progress",
          roomId: "ab12",
          playerId: " ada ",
          position: 0,
          finished: false,
          extra: true,
        }),
      ),
    ).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "ada",
      position: 0,
      finished: false,
    });
    expect(
      parseServerRoomMessage(
        JSON.stringify({
          type: "progress",
          roomId: "AB12",
          playerId: "bea",
          position: 2,
          finished: true,
        }),
      ),
    ).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "bea",
      position: 2,
      finished: true,
    });
  });

  it("parses an error and drops extra fields", () => {
    expect(
      parseServerRoomMessage(
        JSON.stringify({
          type: "error",
          code: "invalid-progress",
          message: "Progress is past the end of the snippet",
          extra: true,
        }),
      ),
    ).toEqual({
      type: "error",
      code: "invalid-progress",
      message: "Progress is past the end of the snippet",
    });
  });

  it("ignores malformed JSON, non-objects, and unknown types", () => {
    for (const raw of [
      "",
      "{",
      "null",
      "[]",
      "42",
      JSON.stringify("hi"),
      JSON.stringify({ type: "wave" }),
      JSON.stringify({}),
    ]) {
      expect(parseServerRoomMessage(raw)).toBeUndefined();
    }
  });

  it("ignores a frame whose fields cannot be used", () => {
    const frames = [
      { type: "players", roomId: "ab-12", players: [ada] },
      { type: "players", roomId: "AB12", players: [{ id: "ada" }] },
      { type: "players", roomId: "AB12", players: [{ id: "ada", name: "   " }] },
      { type: "players", roomId: "AB12", players: [{ id: "ada", name: "a".repeat(25) }] },
      { type: "players", roomId: "AB12", players: [{ id: " ", name: "Ada" }] },
      { type: "players", roomId: "AB12", players: [ada, { id: " ada", name: "Bea" }] },
      { type: "players", roomId: "AB12", players: "ada" },
      { type: "players", players: [ada] },
      { type: "race-start", roomId: "AB12", snippet: { ...snippet, language: "java" }, startsAt },
      { type: "race-start", roomId: "AB12", snippet: { ...snippet, code: "" }, startsAt },
      { type: "race-start", roomId: "AB12", snippet: { ...snippet, title: "" }, startsAt },
      { type: "race-start", roomId: "AB12", snippet: null, startsAt },
      { type: "race-start", roomId: "AB12", snippet, startsAt: 1.5 },
      { type: "race-start", roomId: "AB12", snippet, startsAt: -1 },
      { type: "race-start", roomId: "ab-12", snippet, startsAt },
      { type: "progress", roomId: "AB12", playerId: "ada", position: -1, finished: false },
      { type: "progress", roomId: "AB12", playerId: "ada", position: 1.5, finished: false },
      { type: "progress", roomId: "AB12", playerId: "ada", position: "1", finished: false },
      { type: "progress", roomId: "AB12", playerId: "ada", position: 1, finished: "no" },
      { type: "progress", roomId: "AB12", playerId: "ada", position: 1 },
      { type: "progress", roomId: "AB12", playerId: " ", position: 1, finished: false },
      { type: "progress", roomId: "AB12", playerId: "ada", finished: false },
      { type: "progress", roomId: "bad id", playerId: "ada", position: 1, finished: true },
      { type: "error", code: "nope", message: "No" },
      { type: "error", code: "malformed" },
    ];
    for (const message of frames) {
      expect(parseServerRoomMessage(JSON.stringify(message))).toBeUndefined();
    }
  });
});

describe("applyServerRoomMessage", () => {
  it("keeps progress for players who stay and drops anyone who leaves", () => {
    let state = racing();
    state = applyServerRoomMessage(state, progressFrame("ada", 1, false));
    state = applyServerRoomMessage(state, progressFrame("bea", 2, true));

    expect(state.roomId).toBe("AB12");
    expect(state.snippet).toEqual(snippet);
    expect(state.startsAt).toBe(startsAt);
    expect(state.players).toEqual([
      { id: "ada", name: "Ada", position: 1, finished: false },
      { id: "bea", name: "Bea", position: 2, finished: true },
    ]);

    state = applyServerRoomMessage(state, playersFrame([ada]));
    expect(state.players).toEqual([{ id: "ada", name: "Ada", position: 1, finished: false }]);

    state = applyServerRoomMessage(state, playersFrame([ada, bea]));
    expect(state.players).toEqual([
      { id: "ada", name: "Ada", position: 1, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
  });

  it("follows the broadcast order and starts a new player at 0", () => {
    const moved = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const next = applyServerRoomMessage(moved, playersFrame([bea, { id: "cy", name: "Cy" }, ada]));

    expect(next.players).toEqual([
      { id: "bea", name: "Bea", position: 0, finished: false },
      { id: "cy", name: "Cy", position: 0, finished: false },
      { id: "ada", name: "Ada", position: 1, finished: false },
    ]);
  });

  it("keeps progress when a player is renamed", () => {
    const moved = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const renamed = applyServerRoomMessage(moved, playersFrame([{ id: "ada", name: "Augusta" }, bea]));

    expect(renamed.players).toEqual([
      { id: "ada", name: "Augusta", position: 1, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
  });

  it("resets progress when the race starts and ignores a start for another room", () => {
    const moved = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const restarted = applyServerRoomMessage(moved, raceStartFrame());

    expect(restarted.players).toEqual([
      { id: "ada", name: "Ada", position: 0, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
    expect(restarted.snippet).toEqual(snippet);
    expect(restarted.startsAt).toBe(startsAt);
    expect(applyServerRoomMessage(restarted, raceStartFrame("CD34"))).toBe(restarted);
  });

  it("clears the race when the room changes", () => {
    const moved = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const next = applyServerRoomMessage(moved, playersFrame([{ id: "cy", name: "Cy" }], "CD34"));

    expect(next).toEqual({
      roomId: "CD34",
      players: [{ id: "cy", name: "Cy", position: 0, finished: false }],
      snippet: undefined,
      startsAt: undefined,
    });
    expect(moved.players[0]).toEqual({ id: "ada", name: "Ada", position: 1, finished: false });
  });

  it("ignores a progress frame that does not belong to the current race", () => {
    const state = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const ignored = [
      progressFrame("cy", 1, false),
      progressFrame("ada", 1, false, "CD34"),
      progressFrame("ada", 0, false),
      progressFrame("ada", 3, true),
    ];

    for (const raw of ignored) {
      expect(applyServerRoomMessage(state, raw)).toBe(state);
    }
  });

  it("returns the same state when a frame changes nothing", () => {
    const open = racing();
    const moved = applyServerRoomMessage(open, progressFrame("ada", 1, false));

    expect(applyServerRoomMessage(open, playersFrame([ada, bea]))).toBe(open);
    expect(applyServerRoomMessage(open, raceStartFrame())).toBe(open);
    expect(applyServerRoomMessage(moved, progressFrame("ada", 1, false))).toBe(moved);
    expect(
      reduceRaceRoom(moved, {
        type: "error",
        code: "invalid-progress",
        message: "Progress cannot move backward",
      }),
    ).toBe(moved);
    expect(applyServerRoomMessage(moved, "{")).toBe(moved);
    expect(applyServerRoomMessage(moved, JSON.stringify({ type: "wave" }))).toBe(moved);
  });

  it("folds a late join into the snippet and the current standings", () => {
    let state = applyServerRoomMessage(
      createRaceRoomState(),
      playersFrame([ada, bea, { id: "cy", name: "Cy" }]),
    );
    state = applyServerRoomMessage(state, raceStartFrame());
    state = applyServerRoomMessage(state, progressFrame("ada", 1, false));
    state = applyServerRoomMessage(state, progressFrame("bea", 2, true));

    expect(state.roomId).toBe("AB12");
    expect(state.snippet).toEqual(snippet);
    expect(state.startsAt).toBe(startsAt);
    expect(state.players).toEqual([
      { id: "ada", name: "Ada", position: 1, finished: false },
      { id: "bea", name: "Bea", position: 2, finished: true },
      { id: "cy", name: "Cy", position: 0, finished: false },
    ]);
  });

  it("parses race results and returns the room to idle", () => {
    const raw = JSON.stringify({
      type: "race-results",
      roomId: " ab12 ",
      results: [
        { playerId: " bea ", name: "  Bea  ", place: 1, timeMs: 12_000, wpm: 40.5, extra: true },
        { playerId: "ada", name: "Ada", place: 2, timeMs: 0, wpm: 0 },
      ],
      extra: 1,
    });

    expect(parseServerRoomMessage(raw)).toEqual({
      type: "race-results",
      roomId: "AB12",
      results: [
        { playerId: "bea", name: "Bea", place: 1, timeMs: 12_000, wpm: 40.5 },
        { playerId: "ada", name: "Ada", place: 2, timeMs: 0, wpm: 0 },
      ],
    });

    let state = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    state = applyServerRoomMessage(state, progressFrame("bea", 2, true));
    const idle = applyServerRoomMessage(state, raw);

    expect(idle).toEqual({
      roomId: "AB12",
      players: [
        { id: "ada", name: "Ada", position: 0, finished: false },
        { id: "bea", name: "Bea", position: 0, finished: false },
      ],
      snippet: undefined,
      startsAt: undefined,
    });
    expect(applyServerRoomMessage(idle, raw)).toBe(idle);

    const again = applyServerRoomMessage(idle, raceStartFrame());
    expect(again.snippet).toEqual(snippet);
    expect(again.startsAt).toBe(startsAt);
    expect(again.players).toEqual([
      { id: "ada", name: "Ada", position: 0, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
  });

  it("ignores race results that do not belong to this room or cannot be read", () => {
    const moved = applyServerRoomMessage(racing(), progressFrame("ada", 1, false));
    const elsewhere = JSON.stringify({
      type: "race-results",
      roomId: "CD34",
      results: [{ playerId: "ada", name: "Ada", place: 1, timeMs: 1, wpm: 1 }],
    });
    expect(applyServerRoomMessage(moved, elsewhere)).toBe(moved);

    const bad = [
      { type: "race-results", roomId: "AB12" },
      { type: "race-results", roomId: "AB12", results: {} },
      {
        type: "race-results",
        roomId: "AB12",
        results: [{ playerId: "ada", name: "Ada", place: 0, timeMs: 1, wpm: 1 }],
      },
      {
        type: "race-results",
        roomId: "AB12",
        results: [{ playerId: "ada", name: "Ada", place: 1, timeMs: -1, wpm: 1 }],
      },
      {
        type: "race-results",
        roomId: "AB12",
        results: [{ playerId: "ada", name: "Ada", place: 1, timeMs: 1, wpm: Number.POSITIVE_INFINITY }],
      },
      {
        type: "race-results",
        roomId: "AB12",
        results: [{ playerId: "ada", name: " ", place: 1, timeMs: 1, wpm: 1 }],
      },
      {
        type: "race-results",
        roomId: "AB12",
        results: [
          { playerId: "ada", name: "Ada", place: 1, timeMs: 1, wpm: 1 },
          { playerId: "ada", name: "Ada", place: 2, timeMs: 2, wpm: 1 },
        ],
      },
      { type: "race-results", roomId: "ab-12", results: [] },
    ];
    for (const message of bad) {
      const raw = JSON.stringify(message);
      expect(parseServerRoomMessage(raw)).toBeUndefined();
      expect(applyServerRoomMessage(moved, raw)).toBe(moved);
    }

    const empty = applyServerRoomMessage(
      moved,
      JSON.stringify({ type: "race-results", roomId: "AB12", results: [] }),
    );
    expect(empty.snippet).toBeUndefined();
    expect(empty.startsAt).toBeUndefined();
    expect(empty.players).toEqual([
      { id: "ada", name: "Ada", position: 0, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
  });

  it("keeps a race that arrives before the roster", () => {
    const started = applyServerRoomMessage(createRaceRoomState(), raceStartFrame("ab12"));
    const seated = applyServerRoomMessage(started, playersFrame([ada, bea]));

    expect(started.players).toEqual([]);
    expect(seated.roomId).toBe("AB12");
    expect(seated.snippet).toEqual(snippet);
    expect(seated.startsAt).toBe(startsAt);
    expect(seated.players).toEqual([
      { id: "ada", name: "Ada", position: 0, finished: false },
      { id: "bea", name: "Bea", position: 0, finished: false },
    ]);
  });
});

function playersFrame(
  players: readonly { readonly id: string; readonly name: string }[],
  roomId = "AB12",
): string {
  return JSON.stringify({ type: "players", roomId, players });
}

function raceStartFrame(roomId = "AB12"): string {
  return JSON.stringify({ type: "race-start", roomId, snippet, startsAt, extra: true });
}

function progressFrame(
  playerId: string,
  position: number,
  finished: boolean,
  roomId = "ab12",
): string {
  return JSON.stringify({ type: "progress", roomId, playerId, position, finished });
}

function racing(): RaceRoomState {
  return applyServerRoomMessage(
    applyServerRoomMessage(createRaceRoomState(), playersFrame([ada, bea], "ab12")),
    raceStartFrame(),
  );
}
