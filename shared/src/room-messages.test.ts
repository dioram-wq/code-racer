import { describe, expect, it } from "vitest";
import {
  MAX_PLAYER_ID_LENGTH,
  MAX_PLAYER_NAME_LENGTH,
  MAX_ROOM_ID_LENGTH,
  PLAYER_ID_PATTERN,
  ROOM_ID_PATTERN,
  normalizePlayerId,
  normalizePlayerName,
  normalizeRoomId,
  parseClientRoomMessage,
  playerIdErrorMessage,
  playerNameErrorMessage,
  roomIdErrorMessage,
} from "./index.js";

describe("parseClientRoomMessage", () => {
  it("normalizes a join and ignores extra fields", () => {
    expect(MAX_ROOM_ID_LENGTH).toBe(16);
    expect(MAX_PLAYER_NAME_LENGTH).toBe(24);
    expect(ROOM_ID_PATTERN.test("O0")).toBe(true);
    expect(ROOM_ID_PATTERN.test("ab12")).toBe(false);

    expect(
      parseClientRoomMessage(
        JSON.stringify({ type: "join", roomId: "  ab12 ", name: "  José  ", extra: true }),
      ),
    ).toEqual({
      ok: true,
      message: { type: "join", roomId: "AB12", name: "José" },
    });
    expect(normalizeRoomId("o0")).toBe("O0");
    expect(normalizePlayerName("  Ada  ")).toBe("Ada");
  });

  it("accepts a room id and name at the length limits", () => {
    expect(
      parseClientRoomMessage(
        JSON.stringify({ type: "join", roomId: "a".repeat(16), name: "b".repeat(24) }),
      ),
    ).toEqual({
      ok: true,
      message: { type: "join", roomId: "A".repeat(16), name: "b".repeat(24) },
    });
  });

  it("parses leave and ignores extra fields", () => {
    expect(parseClientRoomMessage(JSON.stringify({ type: "leave", roomId: "AB" }))).toEqual({
      ok: true,
      message: { type: "leave" },
    });
  });

  it("parses start and ignores extra fields", () => {
    expect(
      parseClientRoomMessage(JSON.stringify({ type: "start", roomId: 12, language: "rust" })),
    ).toEqual({
      ok: true,
      message: { type: "start" },
    });
  });

  it("parses progress and ignores extra fields", () => {
    expect(
      parseClientRoomMessage(JSON.stringify({ type: "progress", position: 12, roomId: "AB" })),
    ).toEqual({
      ok: true,
      message: { type: "progress", position: 12 },
    });
    expect(parseClientRoomMessage(JSON.stringify({ type: "progress", position: 0 }))).toEqual({
      ok: true,
      message: { type: "progress", position: 0 },
    });
    expect(
      parseClientRoomMessage(
        JSON.stringify({ type: "progress", position: Number.MAX_SAFE_INTEGER }),
      ),
    ).toEqual({
      ok: true,
      message: { type: "progress", position: Number.MAX_SAFE_INTEGER },
    });
  });

  it("rejects a progress position that is not a non-negative integer", () => {
    const error = {
      type: "error",
      code: "malformed",
      message: "Progress requires a non-negative integer position",
    };
    for (const position of [-1, 1.5, "4", null, true, Number.MAX_SAFE_INTEGER + 1]) {
      expect(parseClientRoomMessage(JSON.stringify({ type: "progress", position }))).toEqual({
        ok: false,
        error,
      });
    }
    expect(parseClientRoomMessage(JSON.stringify({ type: "progress" }))).toEqual({
      ok: false,
      error,
    });
  });

  it("rejects malformed payloads", () => {
    expect(parseClientRoomMessage("")).toEqual({
      ok: false,
      error: { type: "error", code: "malformed", message: "Expected JSON" },
    });
    expect(parseClientRoomMessage("{")).toMatchObject({
      ok: false,
      error: { code: "malformed", message: "Expected JSON" },
    });
    for (const raw of ["null", "[]", "42", JSON.stringify("hi")]) {
      expect(parseClientRoomMessage(raw)).toMatchObject({
        ok: false,
        error: { code: "malformed", message: "Expected a JSON object" },
      });
    }
    expect(parseClientRoomMessage(JSON.stringify({ type: "wave" }))).toEqual({
      ok: false,
      error: {
        type: "error",
        code: "malformed",
        message: "Expected type join, leave, start, or progress",
      },
    });
    expect(parseClientRoomMessage(JSON.stringify({ type: "join", name: "Ada" }))).toEqual({
      ok: false,
      error: {
        type: "error",
        code: "malformed",
        message: "Join requires roomId and name strings",
      },
    });
    expect(parseClientRoomMessage(JSON.stringify({ type: "join", roomId: 12, name: "Ada" }))).toMatchObject(
      { ok: false, error: { code: "malformed", message: "Join requires roomId and name strings" } },
    );
  });

  it("rejects a bad room id or name", () => {
    expect(parseClientRoomMessage(JSON.stringify({ type: "join", roomId: "ab-12", name: "Ada" }))).toEqual({
      ok: false,
      error: { type: "error", code: "invalid-room", message: roomIdErrorMessage() },
    });
    expect(parseClientRoomMessage(JSON.stringify({ type: "join", roomId: "AB", name: "   " }))).toEqual({
      ok: false,
      error: { type: "error", code: "invalid-player", message: playerNameErrorMessage() },
    });
    expect(
      parseClientRoomMessage(JSON.stringify({ type: "join", roomId: "AB", name: "a".repeat(25) })),
    ).toMatchObject({ ok: false, error: { code: "invalid-player" } });
    expect(normalizeRoomId("")).toBeUndefined();
    expect(normalizePlayerName("")).toBeUndefined();
  });

  it("keeps a supplied player id and ignores other extra fields", () => {
    expect(MAX_PLAYER_ID_LENGTH).toBe(64);
    expect(PLAYER_ID_PATTERN.test("Ab-1")).toBe(true);
    expect(normalizePlayerId("  Ab-1  ")).toBe("Ab-1");

    expect(
      parseClientRoomMessage(
        JSON.stringify({
          type: "join",
          roomId: " ab12 ",
          name: " Ada ",
          playerId: "  Ab-1  ",
          extra: true,
        }),
      ),
    ).toEqual({
      ok: true,
      message: { type: "join", roomId: "AB12", name: "Ada", playerId: "Ab-1" },
    });
    expect(
      parseClientRoomMessage(
        JSON.stringify({ type: "join", roomId: "AB", name: "Ada", playerId: "a".repeat(64) }),
      ),
    ).toEqual({
      ok: true,
      message: { type: "join", roomId: "AB", name: "Ada", playerId: "a".repeat(64) },
    });
  });

  it("rejects a player id that is not a string or not an id", () => {
    const malformedId = {
      ok: false,
      error: { type: "error", code: "malformed", message: "Join playerId must be a string" },
    };
    const invalidId = {
      ok: false,
      error: { type: "error", code: "invalid-player", message: playerIdErrorMessage() },
    };
    for (const playerId of [12, null, true, { id: "ada" }]) {
      expect(
        parseClientRoomMessage(JSON.stringify({ type: "join", roomId: "AB", name: "Ada", playerId })),
      ).toEqual(malformedId);
    }
    for (const playerId of ["", "   ", "bad id", "ada_1", "a".repeat(65), "Ada.1"]) {
      expect(
        parseClientRoomMessage(JSON.stringify({ type: "join", roomId: "AB", name: "Ada", playerId })),
      ).toEqual(invalidId);
      expect(normalizePlayerId(playerId)).toBeUndefined();
    }
    expect(normalizePlayerId(12 as unknown as string)).toBeUndefined();
  });
});
