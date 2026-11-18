import { randomUUID } from "node:crypto";
import type { Server as HttpServer } from "node:http";
import {
  parseClientRoomMessage,
  type ErrorRoomMessage,
  type PlayersRoomMessage,
  type ServerRoomMessage,
} from "@code-racer/shared";
import WebSocket, { WebSocketServer } from "ws";
import { RoomRegistryError, createRoomRegistry, type Player, type RoomRegistry } from "./rooms.js";

/**
 * WebSocket rooms on the HTTP server.
 *
 * A client joins with `{ "type": "join", "roomId", "name" }` and leaves with
 * `{ "type": "leave" }`. Closing the socket leaves too. The first join for an
 * id creates the room in the in-memory registry. Every membership change is
 * broadcast as `{ "type": "players", "roomId", "players" }` to the sockets
 * still in that room, in join order. A message that cannot be applied is
 * answered with `{ "type": "error", "code", "message" }` on that socket only.
 *
 * The server assigns the player id. Race start and progress are not part of
 * this protocol.
 */

/** Largest accepted frame. A join or leave is a few dozen bytes. */
const MAX_MESSAGE_BYTES = 16 * 1024;

export interface AttachRoomServerOptions {
  /** Membership store. Defaults to a registry private to this socket server. */
  readonly registry?: RoomRegistry;
  /** Assigns a player id for each successful join. Defaults to `randomUUID`. */
  readonly createPlayerId?: () => string;
}

interface Membership {
  readonly playerId: string;
  readonly roomId: string;
}

/**
 * Accepts room connections on `server`. Call this before `listen`. Returns the
 * socket server so tests can close it.
 */
export function attachRoomServer(
  server: HttpServer,
  options?: AttachRoomServerOptions,
): WebSocketServer {
  const registry = options?.registry ?? createRoomRegistry();
  const createPlayerId = options?.createPlayerId ?? randomUUID;
  const membership = new WeakMap<WebSocket, Membership>();
  const socketsByRoom = new Map<string, Set<WebSocket>>();
  const wss = new WebSocketServer({ server, maxPayload: MAX_MESSAGE_BYTES });

  wss.on("connection", (socket) => {
    socket.on("message", (data, isBinary) => {
      try {
        handleMessage(socket, data, isBinary);
      } catch (error: unknown) {
        console.error(error instanceof Error ? error.message : "Unknown socket error");
        send(socket, { type: "error", code: "malformed", message: "Could not handle the message" });
      }
    });

    socket.on("close", () => {
      const current = membership.get(socket);
      if (current === undefined) {
        return;
      }
      forget(socket, current);
      broadcastPlayers(current.roomId);
    });

    // One bad client socket must not crash the process. Close removes the player.
    socket.on("error", () => undefined);
  });

  wss.on("error", (error: Error) => {
    console.error(error.message);
  });

  return wss;

  function handleMessage(socket: WebSocket, data: WebSocket.RawData, isBinary: boolean): void {
    if (isBinary) {
      send(socket, { type: "error", code: "malformed", message: "Expected a JSON text message" });
      return;
    }
    const parsed = parseClientRoomMessage(readText(data));
    if (!parsed.ok) {
      send(socket, parsed.error);
      return;
    }
    if (parsed.message.type === "leave") {
      leave(socket);
      return;
    }
    join(socket, parsed.message.roomId, parsed.message.name);
  }

  function join(socket: WebSocket, roomId: string, name: string): void {
    const current = membership.get(socket);
    if (current !== undefined) {
      send(socket, {
        type: "error",
        code: "already-joined",
        message: `Already in room ${current.roomId}`,
      });
      return;
    }

    const playerId = readPlayerId(createPlayerId);
    let room: { code: string };
    try {
      room = registry.joinOrCreate(roomId, { id: playerId, name });
    } catch (error: unknown) {
      if (error instanceof RoomRegistryError) {
        send(socket, registryError(error));
        return;
      }
      throw error;
    }

    remember(socket, room.code, playerId);
    broadcastPlayers(room.code);
  }

  function leave(socket: WebSocket): void {
    const current = membership.get(socket);
    if (current === undefined) {
      send(socket, { type: "error", code: "not-in-room", message: "Not in a room" });
      return;
    }
    forget(socket, current);
    broadcastPlayers(current.roomId);
  }

  function remember(socket: WebSocket, roomId: string, playerId: string): void {
    membership.set(socket, { playerId, roomId });
    let sockets = socketsByRoom.get(roomId);
    if (sockets === undefined) {
      sockets = new Set();
      socketsByRoom.set(roomId, sockets);
    }
    sockets.add(socket);
  }

  function forget(socket: WebSocket, current: Membership): void {
    membership.delete(socket);
    const sockets = socketsByRoom.get(current.roomId);
    if (sockets !== undefined) {
      sockets.delete(socket);
      if (sockets.size === 0) {
        socketsByRoom.delete(current.roomId);
      }
    }
    try {
      registry.leave(current.roomId, current.playerId);
    } catch (error: unknown) {
      if (!(error instanceof RoomRegistryError)) {
        throw error;
      }
    }
  }

  function broadcastPlayers(roomId: string): void {
    const sockets = socketsByRoom.get(roomId);
    if (sockets === undefined) {
      return;
    }
    let players: readonly Player[];
    try {
      players = registry.listPlayers(roomId);
    } catch (error: unknown) {
      if (error instanceof RoomRegistryError) {
        return;
      }
      throw error;
    }
    const message: PlayersRoomMessage = { type: "players", roomId, players };
    const payload = JSON.stringify(message);
    for (const member of sockets) {
      if (member.readyState === WebSocket.OPEN) {
        member.send(payload);
      }
    }
  }
}

function readPlayerId(createPlayerId: () => string): string {
  const id = createPlayerId();
  if (typeof id !== "string") {
    throw new Error("createPlayerId must return a string");
  }
  const trimmed = id.trim();
  if (trimmed.length === 0) {
    throw new Error("createPlayerId must return a non-empty string");
  }
  return trimmed;
}

function readText(data: WebSocket.RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

function registryError(error: RoomRegistryError): ErrorRoomMessage {
  if (error.code === "invalid-code") {
    return { type: "error", code: "invalid-room", message: error.message };
  }
  if (error.code === "invalid-player" || error.code === "already-joined" || error.code === "not-in-room") {
    return { type: "error", code: error.code, message: error.message };
  }
  return { type: "error", code: "malformed", message: error.message };
}

function send(socket: WebSocket, message: ServerRoomMessage): void {
  if (socket.readyState !== WebSocket.OPEN) {
    return;
  }
  socket.send(JSON.stringify(message));
}
