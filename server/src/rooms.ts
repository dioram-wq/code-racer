/**
 * In-memory rooms for a later multiplayer race.
 *
 * A room has a short code and the players who have joined, in join order.
 * Codes leave out characters that are easy to mix up when read aloud. This
 * module does not open a socket or read from the network.
 */

/** Characters used in room codes. Omits 0, O, 1, I, and L. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Length of a code from `create` when the caller does not pass `codeLength`. */
export const ROOM_CODE_LENGTH = 4;

const MAX_CODE_LENGTH = 8;
const MAX_ALLOCATION_ATTEMPTS = 32;

export interface Player {
  readonly id: string;
  readonly name: string;
}

export interface Room {
  readonly code: string;
  readonly players: readonly Player[];
}

export type RoomRegistryErrorCode =
  | "invalid-player"
  | "invalid-code-length"
  | "invalid-random"
  | "room-not-found"
  | "already-joined"
  | "not-in-room"
  | "code-exhausted";

/** Failure from creating, joining, leaving, or listing a room. */
export class RoomRegistryError extends Error {
  readonly code: RoomRegistryErrorCode;

  constructor(code: RoomRegistryErrorCode, message: string) {
    super(message);
    this.name = "RoomRegistryError";
    this.code = code;
  }
}

export interface CreateRoomRegistryOptions {
  /**
   * Returns a number in [0, 1), like `Math.random`. Tests pass a fixed
   * sequence so room codes do not depend on the clock.
   */
  readonly random?: () => number;
  /** Character count of a new room code. Defaults to `ROOM_CODE_LENGTH`. */
  readonly codeLength?: number;
}

export interface RoomRegistry {
  /** Opens a room and adds `player` as its first member. */
  create(player: Player): Room;
  /** Adds `player` to an existing room. Codes are matched without case. */
  join(code: string, player: Player): Room;
  /**
   * Removes `playerId`. Deletes the room when it becomes empty and returns
   * undefined. Returns the room when other players remain.
   */
  leave(code: string, playerId: string): Room | undefined;
  /** Players currently in the room, in join order. */
  listPlayers(code: string): readonly Player[];
}

interface MutableRoom {
  code: string;
  players: Player[];
}

/**
 * A new registry with no rooms. Each call has its own membership; nothing is
 * shared across registries.
 */
export function createRoomRegistry(options?: CreateRoomRegistryOptions): RoomRegistry {
  const random = options?.random ?? Math.random;
  const codeLength = readCodeLength(options?.codeLength ?? ROOM_CODE_LENGTH);
  const rooms = new Map<string, MutableRoom>();
  const roomByPlayer = new Map<string, string>();

  function snapshot(room: MutableRoom): Room {
    return {
      code: room.code,
      players: room.players.map((player) => ({ id: player.id, name: player.name })),
    };
  }

  function requireRoom(code: string): MutableRoom {
    const normalized = normalizeCode(code);
    const room = rooms.get(normalized);
    if (room === undefined) {
      const label = normalized === "" ? code : normalized;
      throw new RoomRegistryError("room-not-found", `Unknown room: ${label}`);
    }
    return room;
  }

  function drawCode(): string {
    let code = "";
    for (let index = 0; index < codeLength; index += 1) {
      code += characterAt(randomIndex(random));
    }
    return code;
  }

  function allocateCode(): string {
    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const code = drawCode();
      if (!rooms.has(code)) {
        return code;
      }
    }
    throw new RoomRegistryError("code-exhausted", "Could not allocate a room code");
  }

  function assertAvailable(playerId: string): void {
    const existing = roomByPlayer.get(playerId);
    if (existing !== undefined) {
      throw new RoomRegistryError(
        "already-joined",
        `Player ${playerId} is already in room ${existing}`,
      );
    }
  }

  return {
    create(player: Player): Room {
      const member = readPlayer(player);
      assertAvailable(member.id);
      const code = allocateCode();
      const room: MutableRoom = { code, players: [member] };
      rooms.set(code, room);
      roomByPlayer.set(member.id, code);
      return snapshot(room);
    },

    join(code: string, player: Player): Room {
      const member = readPlayer(player);
      const room = requireRoom(code);
      assertAvailable(member.id);
      room.players.push(member);
      roomByPlayer.set(member.id, room.code);
      return snapshot(room);
    },

    leave(code: string, playerId: string): Room | undefined {
      const room = requireRoom(code);
      if (typeof playerId !== "string" || playerId.trim() === "") {
        throw new RoomRegistryError("not-in-room", `Player is not in room ${room.code}`);
      }
      const id = playerId.trim();
      const index = room.players.findIndex((player) => player.id === id);
      if (index === -1) {
        throw new RoomRegistryError("not-in-room", `Player ${id} is not in room ${room.code}`);
      }
      room.players.splice(index, 1);
      roomByPlayer.delete(id);
      if (room.players.length === 0) {
        rooms.delete(room.code);
        return undefined;
      }
      return snapshot(room);
    },

    listPlayers(code: string): readonly Player[] {
      return snapshot(requireRoom(code)).players;
    },
  };
}

function readCodeLength(codeLength: number): number {
  if (!Number.isInteger(codeLength) || codeLength < 1 || codeLength > MAX_CODE_LENGTH) {
    throw new RoomRegistryError(
      "invalid-code-length",
      `codeLength must be an integer from 1 to ${MAX_CODE_LENGTH}`,
    );
  }
  return codeLength;
}

function readPlayer(player: Player): Player {
  if (typeof player !== "object" || player === null) {
    throw new RoomRegistryError("invalid-player", "Player must include an id and a name");
  }
  if (typeof player.id !== "string" || typeof player.name !== "string") {
    throw new RoomRegistryError("invalid-player", "Player id and name must be strings");
  }
  const id = player.id.trim();
  const name = player.name.trim();
  if (id.length === 0) {
    throw new RoomRegistryError("invalid-player", "Player id must not be empty");
  }
  if (name.length === 0) {
    throw new RoomRegistryError("invalid-player", "Player name must not be empty");
  }
  return { id, name };
}

function normalizeCode(code: string): string {
  if (typeof code !== "string") {
    return "";
  }
  return code.trim().toUpperCase();
}

function randomIndex(random: () => number): number {
  const sample = random();
  if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample >= 1) {
    throw new RoomRegistryError(
      "invalid-random",
      "random() must return a finite number in [0, 1)",
    );
  }
  return Math.floor(sample * ROOM_CODE_ALPHABET.length);
}

function characterAt(index: number): string {
  const character = ROOM_CODE_ALPHABET.charAt(index);
  if (character === "") {
    throw new RoomRegistryError("invalid-random", "Room code index is outside the alphabet");
  }
  return character;
}
