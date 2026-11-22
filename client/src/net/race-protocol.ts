/**
 * Pure client view of a multiplayer race.
 *
 * `progressMessage` turns the typing cursor into the progress report the
 * server accepts. `applyServerRoomMessage` folds a server frame into the
 * players still in the room, the race snippet, and each player's position
 * and finished flag. A frame that is not valid JSON, or not a players,
 * race-start, progress, or error message, is ignored.
 *
 * This module does not open a socket and does not know about React. The race
 * screen does not send or render this state yet.
 */

import {
  isLanguage,
  normalizePlayerName,
  normalizeRoomId,
  type ReportProgressMessage,
  type RoomErrorCode,
  type RoomPlayer,
  type ServerRoomMessage,
  type Snippet,
  type TypingState,
} from "@code-racer/shared";

/** One player still in the room, and how far they are in the current race. */
export interface RacePlayerProgress {
  readonly id: string;
  readonly name: string;
  /** Characters typed, from 0 through the snippet length. */
  readonly position: number;
  /** The `finished` flag from the latest accepted progress broadcast. */
  readonly finished: boolean;
}

/**
 * What the client has learned from room broadcasts.
 *
 * `snippet` and `startsAt` stay unset until a race-start frame arrives.
 * Players who have not reported progress are at position 0.
 */
export interface RaceRoomState {
  readonly roomId: string | undefined;
  readonly players: readonly RacePlayerProgress[];
  readonly snippet: Snippet | undefined;
  readonly startsAt: number | undefined;
}

const ROOM_ERROR_CODES: Record<RoomErrorCode, true> = {
  malformed: true,
  "invalid-room": true,
  "invalid-player": true,
  "already-joined": true,
  "not-in-room": true,
  "not-enough-players": true,
  "race-in-progress": true,
  "race-not-running": true,
  "invalid-progress": true,
};

/** A room the client has not heard about yet. */
export function createRaceRoomState(): RaceRoomState {
  return {
    roomId: undefined,
    players: [],
    snippet: undefined,
    startsAt: undefined,
  };
}

/**
 * The progress report for this typing snapshot.
 *
 * `position` is the cursor: how many characters of the target are in the
 * buffer, including mistakes, newlines, and tabs. Backspace moves it
 * backward. The server rejects a position behind the last one it accepted,
 * and this function does not hide that.
 */
export function progressMessage(state: TypingState): ReportProgressMessage {
  return { type: "progress", position: state.cursor };
}

/**
 * Reads one server frame.
 *
 * Returns undefined for invalid JSON, a non-object, an unknown type, or a
 * known type with fields this client cannot use. Extra fields are dropped.
 * A successful `players` or `race-start` carries the canonical room id.
 */
export function parseServerRoomMessage(raw: string): ServerRoomMessage | undefined {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!isRecord(value) || typeof value.type !== "string") {
    return undefined;
  }
  switch (value.type) {
    case "players":
      return parsePlayers(value);
    case "race-start":
      return parseRaceStart(value);
    case "progress":
      return parseProgress(value);
    case "error":
      return parseError(value);
    default:
      return undefined;
  }
}

/**
 * Folds one parsed server message into the room.
 *
 * A `players` frame replaces the roster in broadcast order. Someone who is
 * gone loses their progress. Someone new starts at 0. A `race-start` stores
 * the snippet and sets every remaining player back to 0. A `progress` frame
 * stores that player's position and finished flag when they are still in the
 * room, the room matches, and the position does not move backward or run
 * past the snippet. An `error` is for the socket that sent a bad report, so
 * it leaves this state unchanged. The same state is returned when nothing
 * changes.
 */
export function reduceRaceRoom(state: RaceRoomState, message: ServerRoomMessage): RaceRoomState {
  switch (message.type) {
    case "players":
      return applyPlayers(state, message.roomId, message.players);
    case "race-start":
      return applyRaceStart(state, message.roomId, message.snippet, message.startsAt);
    case "progress":
      return applyProgress(state, message);
    case "error":
      return state;
  }
}

/**
 * Parses `raw` and folds it into `state`.
 *
 * A frame `parseServerRoomMessage` ignores leaves `state` as it was.
 */
export function applyServerRoomMessage(state: RaceRoomState, raw: string): RaceRoomState {
  const message = parseServerRoomMessage(raw);
  if (message === undefined) {
    return state;
  }
  return reduceRaceRoom(state, message);
}

function applyPlayers(
  state: RaceRoomState,
  roomId: string,
  announced: readonly RoomPlayer[],
): RaceRoomState {
  const roomChanged = state.roomId !== undefined && state.roomId !== roomId;
  const previous = new Map(state.players.map((player) => [player.id, player]));
  const players = announced.map((player) => {
    if (roomChanged) {
      return atStart(player.id, player.name);
    }
    return keptPlayer(player, previous.get(player.id));
  });
  if (!roomChanged && samePlayers(state.players, players) && state.roomId === roomId) {
    return state;
  }
  if (roomChanged) {
    return { roomId, players, snippet: undefined, startsAt: undefined };
  }
  return { roomId, players, snippet: state.snippet, startsAt: state.startsAt };
}

function applyRaceStart(
  state: RaceRoomState,
  roomId: string,
  snippet: Snippet,
  startsAt: number,
): RaceRoomState {
  if (state.roomId !== undefined && state.roomId !== roomId) {
    return state;
  }
  const players = state.players.map((player) =>
    player.position === 0 && !player.finished ? player : atStart(player.id, player.name),
  );
  if (
    state.roomId === roomId &&
    state.startsAt === startsAt &&
    sameSnippet(state.snippet, snippet) &&
    samePlayers(state.players, players)
  ) {
    return state;
  }
  return { roomId, players, snippet, startsAt };
}

function applyProgress(state: RaceRoomState, message: ProgressFields): RaceRoomState {
  if (state.roomId !== undefined && state.roomId !== message.roomId) {
    return state;
  }
  if (state.snippet !== undefined && message.position > state.snippet.code.length) {
    return state;
  }
  const index = state.players.findIndex((player) => player.id === message.playerId);
  const current = state.players[index];
  if (current === undefined || message.position < current.position) {
    return state;
  }
  if (current.position === message.position && current.finished === message.finished) {
    return state;
  }
  const players = state.players.map((player, playerIndex) =>
    playerIndex === index
      ? {
          id: current.id,
          name: current.name,
          position: message.position,
          finished: message.finished,
        }
      : player,
  );
  return { roomId: state.roomId, players, snippet: state.snippet, startsAt: state.startsAt };
}

interface ProgressFields {
  readonly roomId: string;
  readonly playerId: string;
  readonly position: number;
  readonly finished: boolean;
}

function keptPlayer(
  player: RoomPlayer,
  existing: RacePlayerProgress | undefined,
): RacePlayerProgress {
  if (existing === undefined) {
    return atStart(player.id, player.name);
  }
  if (existing.name === player.name) {
    return existing;
  }
  return {
    id: player.id,
    name: player.name,
    position: existing.position,
    finished: existing.finished,
  };
}

function atStart(id: string, name: string): RacePlayerProgress {
  return { id, name, position: 0, finished: false };
}

function samePlayers(
  left: readonly RacePlayerProgress[],
  right: readonly RacePlayerProgress[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) {
      return false;
    }
  }
  return true;
}

function sameSnippet(left: Snippet | undefined, right: Snippet): boolean {
  return (
    left !== undefined &&
    left.id === right.id &&
    left.language === right.language &&
    left.title === right.title &&
    left.code === right.code
  );
}

function parsePlayers(record: Record<string, unknown>): ServerRoomMessage | undefined {
  const roomId = readRoomId(record.roomId);
  const players = readPlayers(record.players);
  if (roomId === undefined || players === undefined) {
    return undefined;
  }
  return { type: "players", roomId, players };
}

function parseRaceStart(record: Record<string, unknown>): ServerRoomMessage | undefined {
  const roomId = readRoomId(record.roomId);
  const snippet = readSnippet(record.snippet);
  const startsAt = readNonNegativeInteger(record.startsAt);
  if (roomId === undefined || snippet === undefined || startsAt === undefined) {
    return undefined;
  }
  return { type: "race-start", roomId, snippet, startsAt };
}

function parseProgress(record: Record<string, unknown>): ServerRoomMessage | undefined {
  const roomId = readRoomId(record.roomId);
  const playerId = readPlayerId(record.playerId);
  const position = readNonNegativeInteger(record.position);
  if (roomId === undefined || playerId === undefined || position === undefined) {
    return undefined;
  }
  if (typeof record.finished !== "boolean") {
    return undefined;
  }
  return { type: "progress", roomId, playerId, position, finished: record.finished };
}

function parseError(record: Record<string, unknown>): ServerRoomMessage | undefined {
  if (!isRoomErrorCode(record.code) || typeof record.message !== "string") {
    return undefined;
  }
  return { type: "error", code: record.code, message: record.message };
}

function readPlayers(value: unknown): readonly RoomPlayer[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const players: RoomPlayer[] = [];
  const seen = new Set<string>();
  for (const entry of value) {
    const player = readPlayer(entry);
    if (player === undefined || seen.has(player.id)) {
      return undefined;
    }
    seen.add(player.id);
    players.push(player);
  }
  return players;
}

function readPlayer(value: unknown): RoomPlayer | undefined {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") {
    return undefined;
  }
  const id = value.id.trim();
  const name = normalizePlayerName(value.name);
  if (id.length === 0 || name === undefined) {
    return undefined;
  }
  return { id, name };
}

function readSnippet(value: unknown): Snippet | undefined {
  if (!isRecord(value)) {
    return undefined;
  }
  const { id, language, title, code } = value;
  if (typeof id !== "string" || id.length === 0) {
    return undefined;
  }
  if (typeof language !== "string" || !isLanguage(language)) {
    return undefined;
  }
  if (typeof title !== "string" || title.length === 0) {
    return undefined;
  }
  if (typeof code !== "string" || code.length === 0) {
    return undefined;
  }
  return { id, language, title, code };
}

function readRoomId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  return normalizeRoomId(value);
}

function readPlayerId(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const id = value.trim();
  if (id.length === 0) {
    return undefined;
  }
  return id;
}

function readNonNegativeInteger(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    return undefined;
  }
  return value;
}

function isRoomErrorCode(value: unknown): value is RoomErrorCode {
  return typeof value === "string" && Object.hasOwn(ROOM_ERROR_CODES, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
