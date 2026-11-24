/**
 * JSON messages for a multiplayer room.
 *
 * The client sends `join`, `leave`, `start`, and `progress`. A join may
 * include a player id the client already knows; otherwise the server assigns
 * one. The server broadcasts `players` to the sockets still in the room when
 * membership changes, and broadcasts `race-start` (a snippet and the instant
 * typing begins) when a race is started. While that race is running, each
 * accepted `progress` report is broadcast to the same sockets. The server
 * sends `error` only to the socket that sent a message it cannot apply.
 *
 * Room ids are 1 to 16 letters or digits, matched without case. Typed ids may
 * use every digit, including characters a generated room code leaves out.
 * Player names are trimmed and limited so a broadcast stays small. A supplied
 * player id is 1 to 64 letters, digits, or hyphens, with its case preserved.
 */

import type { Snippet } from "./snippets.js";

/** Longest room id accepted by `normalizeRoomId`, after trimming. */
export const MAX_ROOM_ID_LENGTH = 16;

/** Longest player name accepted by `normalizePlayerName`, after trimming. */
export const MAX_PLAYER_NAME_LENGTH = 24;

/** Longest player id accepted by `normalizePlayerId`, after trimming. A UUID fits. */
export const MAX_PLAYER_ID_LENGTH = 64;

/** Canonical room id: uppercase letters and digits, within the length cap. */
export const ROOM_ID_PATTERN = new RegExp(`^[A-Z0-9]{1,${MAX_ROOM_ID_LENGTH}}$`);

/** Player id a client may send with a join. Case is preserved. */
export const PLAYER_ID_PATTERN = new RegExp(`^[A-Za-z0-9-]{1,${MAX_PLAYER_ID_LENGTH}}$`);

/** Client → server. */
export type ClientRoomMessage =
  | JoinRoomMessage
  | LeaveRoomMessage
  | StartRaceMessage
  | ReportProgressMessage;

export interface JoinRoomMessage {
  readonly type: "join";
  /** Canonical room id from `normalizeRoomId`. */
  readonly roomId: string;
  /** Display name from `normalizePlayerName`. */
  readonly name: string;
  /**
   * Id from `normalizePlayerId` when the client supplied one.
   * Absent when the server should assign an id.
   */
  readonly playerId?: string;
}

export interface LeaveRoomMessage {
  readonly type: "leave";
}

/** Asks the server to start a race in the socket's current room. */
export interface StartRaceMessage {
  readonly type: "start";
}

/**
 * How far this player has typed. `position` counts characters in the snippet,
 * from 0 through `snippet.code.length`.
 */
export interface ReportProgressMessage {
  readonly type: "progress";
  readonly position: number;
}

/** One player in a `players` broadcast. The server assigns `id`. */
export interface RoomPlayer {
  readonly id: string;
  readonly name: string;
}

/** Server → client. */
export type ServerRoomMessage =
  | PlayersRoomMessage
  | RaceStartRoomMessage
  | ProgressRoomMessage
  | ErrorRoomMessage;

export interface PlayersRoomMessage {
  readonly type: "players";
  readonly roomId: string;
  readonly players: readonly RoomPlayer[];
}

/**
 * Sent to every socket in the room when a race starts.
 * `startsAt` is Unix time in milliseconds. Typing begins at that instant.
 */
export interface RaceStartRoomMessage {
  readonly type: "race-start";
  readonly roomId: string;
  readonly snippet: Snippet;
  readonly startsAt: number;
}

/**
 * Sent to every socket in the room when one player's position is accepted.
 * `finished` is true when `position` is the length of the race snippet.
 */
export interface ProgressRoomMessage {
  readonly type: "progress";
  readonly roomId: string;
  readonly playerId: string;
  readonly position: number;
  readonly finished: boolean;
}

export type RoomErrorCode =
  | "malformed"
  | "invalid-room"
  | "invalid-player"
  | "already-joined"
  | "not-in-room"
  | "not-enough-players"
  | "race-in-progress"
  | "race-not-running"
  | "invalid-progress";

export interface ErrorRoomMessage {
  readonly type: "error";
  readonly code: RoomErrorCode;
  readonly message: string;
}

export type ParseClientRoomMessageResult =
  | { readonly ok: true; readonly message: ClientRoomMessage }
  | { readonly ok: false; readonly error: ErrorRoomMessage };

/** Why a room id was rejected. Shared by the registry and the socket. */
export function roomIdErrorMessage(): string {
  return `Room id must be 1 to ${MAX_ROOM_ID_LENGTH} letters or digits`;
}

/** Why a player name was rejected. Shared by the registry and the socket. */
export function playerNameErrorMessage(): string {
  return `Player name must be 1 to ${MAX_PLAYER_NAME_LENGTH} characters`;
}

/** Why a client-supplied player id was rejected. */
export function playerIdErrorMessage(): string {
  return `Player id must be 1 to ${MAX_PLAYER_ID_LENGTH} letters, digits, or hyphens`;
}

/**
 * Trims and uppercases a room id. Returns undefined when the id is missing
 * or not 1 to 16 letters or digits.
 */
export function normalizeRoomId(roomId: string): string | undefined {
  if (typeof roomId !== "string") {
    return undefined;
  }
  const normalized = roomId.trim().toUpperCase();
  if (!ROOM_ID_PATTERN.test(normalized)) {
    return undefined;
  }
  return normalized;
}

/**
 * Trims a display name. Returns undefined when it is missing, empty, or
 * longer than `MAX_PLAYER_NAME_LENGTH`.
 */
export function normalizePlayerName(name: string): string | undefined {
  if (typeof name !== "string") {
    return undefined;
  }
  const trimmed = name.trim();
  if (trimmed.length === 0 || trimmed.length > MAX_PLAYER_NAME_LENGTH) {
    return undefined;
  }
  return trimmed;
}

/**
 * Trims a client-supplied player id. Returns undefined when it is missing
 * or not 1 to 64 letters, digits, or hyphens. Case is preserved.
 */
export function normalizePlayerId(playerId: string): string | undefined {
  if (typeof playerId !== "string") {
    return undefined;
  }
  const trimmed = playerId.trim();
  if (!PLAYER_ID_PATTERN.test(trimmed)) {
    return undefined;
  }
  return trimmed;
}

/**
 * Reads one client payload. A successful `join` carries the canonical room
 * id and the trimmed name, plus a player id when the client sent one that
 * `normalizePlayerId` accepts. A successful `progress` carries a non-negative
 * integer position. Extra fields are ignored.
 */
export function parseClientRoomMessage(raw: string): ParseClientRoomMessageResult {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return malformed("Expected JSON");
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return malformed("Expected a JSON object");
  }

  const record = value as Record<string, unknown>;
  if (record.type === "leave") {
    return { ok: true, message: { type: "leave" } };
  }
  if (record.type === "start") {
    return { ok: true, message: { type: "start" } };
  }
  if (record.type === "progress") {
    return parseProgress(record);
  }
  if (record.type !== "join") {
    return malformed("Expected type join, leave, start, or progress");
  }
  if (typeof record.roomId !== "string" || typeof record.name !== "string") {
    return malformed("Join requires roomId and name strings");
  }

  const roomId = normalizeRoomId(record.roomId);
  if (roomId === undefined) {
    return {
      ok: false,
      error: { type: "error", code: "invalid-room", message: roomIdErrorMessage() },
    };
  }
  const name = normalizePlayerName(record.name);
  if (name === undefined) {
    return {
      ok: false,
      error: { type: "error", code: "invalid-player", message: playerNameErrorMessage() },
    };
  }
  const playerId = readJoinPlayerId(record.playerId);
  if (!playerId.ok) {
    return playerId.failure;
  }
  if (playerId.value === undefined) {
    return { ok: true, message: { type: "join", roomId, name } };
  }
  return { ok: true, message: { type: "join", roomId, name, playerId: playerId.value } };
}

type JoinPlayerIdResult =
  | { readonly ok: true; readonly value: string | undefined }
  | { readonly ok: false; readonly failure: ParseClientRoomMessageResult };

function readJoinPlayerId(value: unknown): JoinPlayerIdResult {
  if (value === undefined) {
    return { ok: true, value: undefined };
  }
  if (typeof value !== "string") {
    return { ok: false, failure: malformed("Join playerId must be a string") };
  }
  const playerId = normalizePlayerId(value);
  if (playerId === undefined) {
    return {
      ok: false,
      failure: { ok: false, error: { type: "error", code: "invalid-player", message: playerIdErrorMessage() } },
    };
  }
  return { ok: true, value: playerId };
}

function parseProgress(record: Record<string, unknown>): ParseClientRoomMessageResult {
  const position = record.position;
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) {
    return malformed("Progress requires a non-negative integer position");
  }
  return { ok: true, message: { type: "progress", position } };
}

function malformed(message: string): ParseClientRoomMessageResult {
  return { ok: false, error: { type: "error", code: "malformed", message } };
}
