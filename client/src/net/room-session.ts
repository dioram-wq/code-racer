/**
 * Pure session for one room socket.
 *
 * `joinRoomMessage` builds the join the race screen sends, including a player
 * id this client already knows so it can tell its row from the others. The
 * server assigns an id only when that field is absent. `stepRoomSession`
 * turns socket events and local commands into the next session and the frames
 * to write. It does not open a socket. `useRoomConnection` does that.
 */

import {
  normalizePlayerId,
  normalizePlayerName,
  normalizeRoomId,
  playerNameErrorMessage,
  roomIdErrorMessage,
  type ErrorRoomMessage,
  type JoinRoomMessage,
} from "@code-racer/shared";
import { parseServerRoomMessage } from "./race-protocol.js";

/** Port of `npm start -w @code-racer/server`. */
export const ROOM_SOCKET_PORT = 3001;

/** A join this client can recognize, because it chose the player id. */
export interface KnownJoin extends JoinRoomMessage {
  readonly playerId: string;
}

export type RoomSessionPhase = "connecting" | "open" | "joined" | "closed";

export interface RoomSessionState {
  readonly phase: RoomSessionPhase;
  readonly selfId: string;
  readonly roomId: string | undefined;
  readonly name: string | undefined;
  readonly frames: readonly string[];
  readonly error: ErrorRoomMessage | undefined;
  /** Local note, such as a dropped socket. Not a server error code. */
  readonly notice: string | undefined;
}

export type RoomSessionEvent =
  | { readonly type: "open" }
  | { readonly type: "message"; readonly raw: string }
  | { readonly type: "close" }
  | { readonly type: "leave" }
  | { readonly type: "start" }
  | { readonly type: "progress"; readonly position: number };

export interface RoomSessionStep {
  readonly state: RoomSessionState;
  /** Text frames to write, in order. Empty when the socket should stay quiet. */
  readonly send: readonly string[];
}

const QUIET: readonly string[] = [];

/** `ws://hostname:3001`, or `wss` when the page is https. An empty host is localhost. */
export function roomSocketUrl(location: {
  readonly protocol: string;
  readonly hostname: string;
}): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  const hostname = location.hostname.trim();
  const host = hostname.length === 0 ? "localhost" : hostname;
  return `${scheme}//${host}:${ROOM_SOCKET_PORT}`;
}

/**
 * Why a join should not be attempted.
 *
 * Undefined when both fields normalize. The name is checked first.
 */
export function joinRoomFailure(name: string, roomId: string): string | undefined {
  if (normalizePlayerName(name) === undefined) {
    return playerNameErrorMessage();
  }
  if (normalizeRoomId(roomId) === undefined) {
    return roomIdErrorMessage();
  }
  return undefined;
}

/**
 * The join frame for a room, a name, and a player id this client generated.
 *
 * Returns undefined when any of the three is rejected. The room id is
 * canonical. The player id keeps its case.
 */
export function joinRoomMessage(roomId: string, name: string, playerId: string): KnownJoin | undefined {
  const canonicalRoom = normalizeRoomId(roomId);
  const canonicalName = normalizePlayerName(name);
  const canonicalId = normalizePlayerId(playerId);
  if (canonicalRoom === undefined || canonicalName === undefined || canonicalId === undefined) {
    return undefined;
  }
  return { type: "join", roomId: canonicalRoom, name: canonicalName, playerId: canonicalId };
}

/** A player id from `randomUUID`, or undefined when that source returns an unusable id. */
export function newPlayerId(randomUUID: () => string = () => crypto.randomUUID()): string | undefined {
  return normalizePlayerId(randomUUID());
}

/** A socket that has not opened yet. `selfId` is the id the join will send. */
export function createRoomSession(selfId: string): RoomSessionState {
  return {
    phase: "connecting",
    selfId,
    roomId: undefined,
    name: undefined,
    frames: [],
    error: undefined,
    notice: undefined,
  };
}

/**
 * One socket event or local command.
 *
 * `open` sends `join` once. A `players` frame that lists `selfId` in this
 * room marks the session joined and clears an error. A later list that drops
 * this id leaves the socket open but no longer joined. `start` and `progress`
 * are sent only after that. `leave` sends `leave` once the socket is open and
 * then closes the session. `close` records a disconnect unless the session
 * was already closed. The same state is returned when nothing changes.
 */
export function stepRoomSession(
  state: RoomSessionState,
  event: RoomSessionEvent,
  join: KnownJoin,
): RoomSessionStep {
  switch (event.type) {
    case "open":
      return openSocket(state, join);
    case "message":
      return noteFrame(state, event.raw, join);
    case "close":
      return closeSocket(state);
    case "leave":
      return leaveRoom(state);
    case "start":
      return sendStart(state);
    case "progress":
      return sendProgress(state, event.position);
  }
}

/**
 * Which room row to show.
 *
 * `joined` wins even when a start was rejected. A request that is still
 * waiting, including the render before the socket exists, is `joining`.
 * A blocker (a server error before membership, or a disconnect) shows the
 * form again.
 */
export function roomJoinMode(
  phase: RoomSessionPhase | "idle",
  requested: boolean,
  blocked: boolean,
): "form" | "joining" | "joined" {
  if (phase === "joined") {
    return "joined";
  }
  if (!requested || blocked || phase === "closed") {
    return "form";
  }
  return "joining";
}

function openSocket(state: RoomSessionState, join: KnownJoin): RoomSessionStep {
  if (state.phase !== "connecting") {
    return quiet(state);
  }
  return {
    state: { ...state, phase: "open" },
    send: [JSON.stringify(join)],
  };
}

function noteFrame(state: RoomSessionState, raw: string, join: KnownJoin): RoomSessionStep {
  const frames = state.frames.concat(raw);
  const message = parseServerRoomMessage(raw);
  if (message === undefined) {
    return { state: { ...state, frames }, send: QUIET };
  }
  if (message.type === "error") {
    return { state: { ...state, frames, error: message }, send: QUIET };
  }
  if (message.roomId !== join.roomId) {
    return { state: { ...state, frames }, send: QUIET };
  }
  if (message.type === "players") {
    return notePlayers(state, frames, message.roomId, message.players);
  }
  return {
    state: { ...state, frames, error: undefined, notice: undefined },
    send: QUIET,
  };
}

function notePlayers(
  state: RoomSessionState,
  frames: readonly string[],
  roomId: string,
  players: readonly { readonly id: string; readonly name: string }[],
): RoomSessionStep {
  const me = players.find((player) => player.id === state.selfId);
  if (me === undefined) {
    if (state.phase !== "joined") {
      return { state: { ...state, frames }, send: QUIET };
    }
    return {
      state: {
        ...state,
        phase: "open",
        frames,
        roomId: undefined,
        name: undefined,
      },
      send: QUIET,
    };
  }
  return {
    state: {
      ...state,
      phase: "joined",
      frames,
      roomId,
      name: me.name,
      error: undefined,
      notice: undefined,
    },
    send: QUIET,
  };
}

function closeSocket(state: RoomSessionState): RoomSessionStep {
  if (state.phase === "closed") {
    return quiet(state);
  }
  const notice =
    state.phase === "connecting" ? "Could not reach the room server" : "Disconnected";
  return {
    state: { ...state, phase: "closed", notice },
    send: QUIET,
  };
}

function leaveRoom(state: RoomSessionState): RoomSessionStep {
  if (state.phase === "closed") {
    return quiet(state);
  }
  const send =
    state.phase === "open" || state.phase === "joined"
      ? [JSON.stringify({ type: "leave" })]
      : QUIET;
  return {
    state: {
      ...state,
      phase: "closed",
      frames: [],
      roomId: undefined,
      name: undefined,
      error: undefined,
      notice: undefined,
    },
    send,
  };
}

function sendStart(state: RoomSessionState): RoomSessionStep {
  if (state.phase !== "joined") {
    return quiet(state);
  }
  return { state, send: [JSON.stringify({ type: "start" })] };
}

function sendProgress(state: RoomSessionState, position: number): RoomSessionStep {
  if (state.phase !== "joined" || !Number.isSafeInteger(position) || position < 0) {
    return quiet(state);
  }
  return { state, send: [JSON.stringify({ type: "progress", position })] };
}

function quiet(state: RoomSessionState): RoomSessionStep {
  return { state, send: QUIET };
}

/** The failure text for a join that should stay on the form. Undefined while waiting or joined. */
export function roomJoinBlocker(
  phase: RoomSessionPhase | "idle",
  error: ErrorRoomMessage | undefined,
  notice: string | undefined,
): string | undefined {
  if (phase === "joined") {
    return undefined;
  }
  return error?.message ?? notice;
}
