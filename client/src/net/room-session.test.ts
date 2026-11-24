import { describe, expect, it } from "vitest";
import { PLAYER_ID_PATTERN, playerNameErrorMessage, roomIdErrorMessage } from "@code-racer/shared";
import {
  createRoomSession,
  joinRoomFailure,
  joinRoomMessage,
  newPlayerId,
  roomJoinBlocker,
  roomJoinMode,
  roomSocketUrl,
  stepRoomSession,
  type KnownJoin,
  type RoomSessionEvent,
  type RoomSessionState,
} from "./room-session.js";

const join = mustJoin(" ab12 ", " Ada ", "  Ab-1  ");

describe("room socket address and join", () => {
  it("builds a websocket url from the page and a join from a room, a name, and an id", () => {
    expect(roomSocketUrl({ protocol: "http:", hostname: "localhost" })).toBe("ws://localhost:3001");
    expect(roomSocketUrl({ protocol: "https:", hostname: "game.example" })).toBe(
      "wss://game.example:3001",
    );
    expect(roomSocketUrl({ protocol: "http:", hostname: "  " })).toBe("ws://localhost:3001");

    expect(join).toEqual({ type: "join", roomId: "AB12", name: "Ada", playerId: "Ab-1" });
    expect(joinRoomMessage("ab12", "Ada", "a".repeat(64))?.playerId).toBe("a".repeat(64));
    expect(joinRoomFailure("Ada", "ab12")).toBeUndefined();
    expect(joinRoomFailure("   ", "ab12")).toBe(playerNameErrorMessage());
    expect(joinRoomFailure("Ada", "bad id")).toBe(roomIdErrorMessage());
  });

  it("rejects a join field that cannot go on the wire", () => {
    expect(joinRoomMessage("ab-12", "Ada", "Ab-1")).toBeUndefined();
    expect(joinRoomMessage("AB12", " ", "Ab-1")).toBeUndefined();
    expect(joinRoomMessage("AB12", "Ada", "bad id")).toBeUndefined();
    expect(joinRoomMessage("AB12", "Ada", "")).toBeUndefined();
  });

  it("accepts a generated player id and refuses an unusable one", () => {
    expect(newPlayerId(() => "  abc-1  ")).toBe("abc-1");
    expect(newPlayerId(() => "bad id")).toBeUndefined();
    expect(newPlayerId(() => "")).toBeUndefined();
    const generated = newPlayerId();
    expect(generated).toEqual(expect.any(String));
    expect(PLAYER_ID_PATTERN.test(generated ?? "")).toBe(true);
  });
});

describe("room join mode", () => {
  it("shows the form until a request is waiting, then the room once the list names us", () => {
    expect(roomJoinMode("idle", false, false)).toBe("form");
    expect(roomJoinMode("idle", true, false)).toBe("joining");
    expect(roomJoinMode("connecting", true, false)).toBe("joining");
    expect(roomJoinMode("open", true, false)).toBe("joining");
    expect(roomJoinMode("joined", false, true)).toBe("joined");
  });

  it("returns to the form when the wait is blocked or the socket is closed", () => {
    expect(roomJoinMode("open", true, true)).toBe("form");
    expect(roomJoinMode("closed", true, false)).toBe("form");
    expect(roomJoinMode("closed", false, true)).toBe("form");
    expect(roomJoinBlocker("joined", errorFrame(), "Disconnected")).toBeUndefined();
    expect(roomJoinBlocker("open", errorFrame(), "Disconnected")).toBe("Not in a room");
    expect(roomJoinBlocker("closed", undefined, "Disconnected")).toBe("Disconnected");
    expect(roomJoinBlocker("connecting", undefined, undefined)).toBeUndefined();
  });
});

describe("stepRoomSession", () => {
  it("sends one join when the socket opens and ignores a second open", () => {
    const opened = stepRoomSession(createRoomSession(join.playerId), { type: "open" }, join);

    expect(opened.state.phase).toBe("open");
    expect(opened.send.map(parse)).toEqual([join]);
    expect(stepRoomSession(opened.state, { type: "open" }, join)).toEqual({
      state: opened.state,
      send: [],
    });
  });

  it("joins when the player list names this id and ignores a different room", () => {
    const opened = open();
    const other = apply(opened, frame("players", { roomId: "OTHER", players: [member("Ab-1", "Ada")] }));

    expect(other.phase).toBe("open");
    expect(other.roomId).toBeUndefined();
    expect(other.frames).toHaveLength(1);

    const joined = apply(other, players("AB12", [member("Ab-1", "Ada"), member("bea", "Bea")]));

    expect(joined.phase).toBe("joined");
    expect(joined.roomId).toBe("AB12");
    expect(joined.name).toBe("Ada");
    expect(joined.frames).toHaveLength(2);
  });

  it("keeps a bad frame, stores an error, and clears that error when the race starts", () => {
    const joined = joinRoom();
    const bad = apply(joined, "not json");
    expect(bad.phase).toBe("joined");
    expect(bad.error).toBeUndefined();
    expect(bad.frames).toHaveLength(joined.frames.length + 1);

    const rejected = apply(bad, JSON.stringify(errorFrame()));
    expect(rejected.error).toEqual(errorFrame());

    const elsewhere = apply(
      rejected,
      frame("race-start", { roomId: "OTHER", snippet: snippet(), startsAt: 10 }),
    );
    expect(elsewhere.error).toEqual(errorFrame());

    const started = apply(
      elsewhere,
      frame("race-start", { roomId: "AB12", snippet: snippet(), startsAt: 30 }),
    );
    expect(started.error).toBeUndefined();
    expect(started.notice).toBeUndefined();
    expect(started.phase).toBe("joined");
  });

  it("sends start and progress only after the join is acknowledged", () => {
    const opened = open();
    expect(quiet(opened, { type: "start" })).toBe(true);
    expect(quiet(opened, { type: "progress", position: 1 })).toBe(true);

    const joined = apply(opened, players("AB12", [member("Ab-1", "Ada")]));
    const start = stepRoomSession(joined, { type: "start" }, join);
    expect(start.state).toBe(joined);
    expect(start.send.map(parse)).toEqual([{ type: "start" }]);

    const progress = stepRoomSession(joined, { type: "progress", position: 0 }, join);
    expect(progress.send.map(parse)).toEqual([{ type: "progress", position: 0 }]);
    expect(stepRoomSession(joined, { type: "progress", position: 4 }, join).send.map(parse)).toEqual([
      { type: "progress", position: 4 },
    ]);
    for (const position of [-1, 1.5, Number.NaN]) {
      expect(quiet(joined, { type: "progress", position })).toBe(true);
    }
  });

  it("drops this socket when a later player list leaves it out", () => {
    const joined = joinRoom();
    const dropped = apply(joined, players("AB12", [member("bea", "Bea")]));

    expect(dropped.phase).toBe("open");
    expect(dropped.roomId).toBeUndefined();
    expect(dropped.name).toBeUndefined();
    expect(dropped.frames).toHaveLength(joined.frames.length + 1);
    expect(quiet(dropped, { type: "start" })).toBe(true);
  });

  it("leaves without a frame before the socket is open, and with a frame after", () => {
    const connecting = createRoomSession(join.playerId);
    const cancelled = stepRoomSession(connecting, { type: "leave" }, join);

    expect(cancelled.send).toEqual([]);
    expect(cancelled.state.phase).toBe("closed");
    expect(cancelled.state.frames).toEqual([]);
    expect(cancelled.state.notice).toBeUndefined();
    expect(stepRoomSession(cancelled.state, { type: "leave" }, join).state).toBe(cancelled.state);

    const left = stepRoomSession(joinRoom(), { type: "leave" }, join);
    expect(left.send.map(parse)).toEqual([{ type: "leave" }]);
    expect(left.state.phase).toBe("closed");
    expect(left.state.roomId).toBeUndefined();
    expect(left.state.frames).toEqual([]);
    expect(stepRoomSession(left.state, { type: "close" }, join).state).toBe(left.state);
  });

  it("records a disconnect, and a socket that never opened as unreachable", () => {
    const dropped = stepRoomSession(joinRoom(), { type: "close" }, join);
    expect(dropped.state.phase).toBe("closed");
    expect(dropped.state.notice).toBe("Disconnected");
    expect(dropped.send).toEqual([]);
    expect(stepRoomSession(dropped.state, { type: "close" }, join).state).toBe(dropped.state);

    const unreachable = stepRoomSession(createRoomSession(join.playerId), { type: "close" }, join);
    expect(unreachable.state.notice).toBe("Could not reach the room server");

    const opened = stepRoomSession(open(), { type: "close" }, join);
    expect(opened.state.notice).toBe("Disconnected");
  });

  it("can mark the session joined from a player list that arrives before open", () => {
    const early = apply(
      createRoomSession(join.playerId),
      players("AB12", [member("Ab-1", "Ada")]),
    );
    expect(early.phase).toBe("joined");
    expect(stepRoomSession(early, { type: "open" }, join).send).toEqual([]);
  });
});

function mustJoin(roomId: string, name: string, playerId: string): KnownJoin {
  const message = joinRoomMessage(roomId, name, playerId);
  if (message === undefined) {
    throw new Error("expected a join");
  }
  return message;
}

function open(): RoomSessionState {
  return stepRoomSession(createRoomSession(join.playerId), { type: "open" }, join).state;
}

function joinRoom(): RoomSessionState {
  return apply(open(), players("AB12", [member("Ab-1", "Ada")]));
}

function apply(state: RoomSessionState, raw: string): RoomSessionState {
  return stepRoomSession(state, { type: "message", raw }, join).state;
}

function quiet(state: RoomSessionState, event: RoomSessionEvent): boolean {
  const step = stepRoomSession(state, event, join);
  return step.state === state && step.send.length === 0;
}

function players(roomId: string, members: readonly { id: string; name: string }[]): string {
  return frame("players", { roomId, players: members });
}

function member(id: string, name: string): { id: string; name: string } {
  return { id, name };
}

function frame(type: string, fields: Record<string, unknown>): string {
  return JSON.stringify({ type, ...fields });
}

function snippet(): { id: string; language: string; title: string; code: string } {
  return { id: "ts-clamp", language: "typescript", title: "Clamp", code: "const n = 1;\n" };
}

function errorFrame(): { type: "error"; code: "not-in-room"; message: string } {
  return { type: "error", code: "not-in-room", message: "Not in a room" };
}

function parse(raw: string): unknown {
  return JSON.parse(raw);
}
