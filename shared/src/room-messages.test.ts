import { describe, expect, it } from "vitest";
import {
  MAX_PLAYER_NAME_LENGTH,
  MAX_ROOM_ID_LENGTH,
  ROOM_ID_PATTERN,
  normalizePlayerName,
  normalizeRoomId,
  parseClientRoomMessage,
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
});
