import {
  calculateWpm,
  isLanguage,
  normalizePlayerName,
  normalizeRoomId,
  pickSnippet as pickCatalogSnippet,
  playerNameErrorMessage,
  roomIdErrorMessage,
  type RaceResultEntry,
  type Snippet,
} from "@code-racer/shared";

/**
 * In-memory rooms for a multiplayer race.
 *
 * A room has a code and the players who have joined, in join order. Generated
 * codes leave out characters that are easy to mix up when read aloud. A caller
 * can also open a room with a chosen id of 1 to 16 letters or digits. A room
 * with at least `MIN_RACE_PLAYERS` can start one race: the registry picks a
 * snippet, stores a countdown, and then reports that race as racing once
 * `startsAt` is reached. While the race is racing, a player can report how
 * many characters they have typed. That position cannot pass the snippet or
 * move backward, and reaching the end marks the player finished.
 * `listProgress` returns those accepted positions in join order, so a player
 * who arrives during the countdown or the race can be shown the current
 * standings. `concludeRace` ends that race once every player still in the
 * room has finished, or once it has run for `RACE_LIMIT_MS` after typing
 * begins. The standings use the shared words-per-minute formula on the
 * whole snippet and the finish time. The room is then waiting, so another
 * race can start. This module does not open a socket or read from the network.
 */

/** Characters used in room codes. Omits 0, O, 1, I, and L. */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Length of a code from `create` when the caller does not pass `codeLength`. */
export const ROOM_CODE_LENGTH = 4;

/** A race will not start with fewer players than this. */
export const MIN_RACE_PLAYERS = 2;

/** Milliseconds between a successful start and the instant typing begins. */
export const RACE_COUNTDOWN_MS = 3000;

/**
 * How long a race may run after typing begins.
 *
 * A player who never finishes would otherwise hold the room. At this age
 * `concludeRace` ends it and keeps whoever has already finished.
 */
export const RACE_LIMIT_MS = 5 * 60 * 1000;

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

/** Waiting has no race. Countdown and racing both keep the race that started. */
export type RoomPhase = "waiting" | "countdown" | "racing";

export interface RoomRace {
  readonly snippet: Snippet;
  /** Unix time in milliseconds when typing begins. */
  readonly startsAt: number;
}

/** One player's accepted position in the current race. */
export interface PlayerProgress {
  readonly playerId: string;
  /** Characters typed, from 0 through the snippet length. */
  readonly position: number;
  /** True when `position` is the length of the race snippet. */
  readonly finished: boolean;
}

export type RoomRaceState =
  | { readonly phase: "waiting" }
  | { readonly phase: "countdown" | "racing"; readonly race: RoomRace };

export type RoomRegistryErrorCode =
  | "invalid-player"
  | "invalid-code-length"
  | "invalid-random"
  | "invalid-code"
  | "room-not-found"
  | "already-joined"
  | "not-in-room"
  | "code-exhausted"
  | "not-enough-players"
  | "race-in-progress"
  | "race-not-running"
  | "invalid-progress"
  | "invalid-clock"
  | "invalid-snippet";

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
  /** Passage for `startRace`. Defaults to `pickSnippet` from the shared catalog. */
  readonly pickSnippet?: () => Snippet;
  /** Unix time in milliseconds. Defaults to `Date.now`. */
  readonly now?: () => number;
}

export interface RoomRegistry {
  /** Opens a room and adds `player` as its first member. */
  create(player: Player): Room;
  /** Adds `player` to an existing room. Codes are matched without case. */
  join(code: string, player: Player): Room;
  /**
   * Adds `player` to the room `code`, creating that room when it is missing.
   * Codes are matched without case. A supplied code is 1 to 16 letters or digits.
   */
  joinOrCreate(code: string, player: Player): Room;
  /**
   * Removes `playerId`. Deletes the room when it becomes empty and returns
   * undefined. Returns the room when other players remain.
   */
  leave(code: string, playerId: string): Room | undefined;
  /** Players currently in the room, in join order. */
  listPlayers(code: string): readonly Player[];
  /**
   * Picks a snippet and stores a countdown on the room. Rejects when a race
   * is already stored or the room has fewer than `MIN_RACE_PLAYERS`.
   */
  startRace(code: string): RoomRace;
  /**
   * Waiting when no race is stored. Countdown until `startsAt`, then racing.
   * Both of those phases still hold the race, so `startRace` keeps rejecting.
   */
  raceState(code: string): RoomRaceState;
  /**
   * Records how far `playerId` has typed. The race must be racing. `position`
   * counts characters from 0 through the snippet length and cannot move
   * backward. The player is finished when it reaches the end of the snippet.
   */
  reportProgress(code: string, playerId: string, position: number): PlayerProgress;
  /**
   * Accepted positions in the current race, in join order. A player who has
   * not reported is omitted. Empty when no race is stored or nobody has
   * reported. `finished` is true when the position is the length of the snippet.
   */
  listProgress(code: string): readonly PlayerProgress[];
  /**
   * Ends the race when every player still in the room has finished, or when
   * it has run for `RACE_LIMIT_MS` after `startsAt`. Returns those finishers
   * in finishing order and leaves the room waiting. A player who left is
   * omitted, and so is anyone still typing when the limit ends the race.
   * Returns undefined when the race should keep going, or when no race is
   * stored. An empty list means the race ended and nobody finished.
   */
  concludeRace(code: string): readonly RaceResultEntry[] | undefined;
}

/** The instant a player first reached the end of the snippet, and the order that happened. */
interface FinishMark {
  readonly at: number;
  readonly seq: number;
}

interface MutableRoom {
  code: string;
  players: Player[];
  race: RoomRace | undefined;
  /** Accepted character position for each player who has reported one. */
  progress: Map<string, number>;
  /** First finish for each player still in the room. Cleared with the race. */
  finishes: Map<string, FinishMark>;
  /** Next `FinishMark.seq`. Earlier reports rank ahead when the clock matches. */
  nextFinish: number;
}

/**
 * A new registry with no rooms. Each call has its own membership; nothing is
 * shared across registries.
 */
export function createRoomRegistry(options?: CreateRoomRegistryOptions): RoomRegistry {
  const random = options?.random ?? Math.random;
  const codeLength = readCodeLength(options?.codeLength ?? ROOM_CODE_LENGTH);
  const pickSnippet = options?.pickSnippet ?? (() => pickCatalogSnippet());
  const now = options?.now ?? Date.now;
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
      const room: MutableRoom = emptyRoom(code, [member]);
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

    joinOrCreate(code: string, player: Player): Room {
      const roomId = readSuppliedCode(code);
      const member = readPlayer(player);
      assertAvailable(member.id);
      const existing = rooms.get(roomId);
      if (existing !== undefined) {
        existing.players.push(member);
        roomByPlayer.set(member.id, existing.code);
        return snapshot(existing);
      }
      const room: MutableRoom = emptyRoom(roomId, [member]);
      rooms.set(roomId, room);
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
      room.progress.delete(id);
      room.finishes.delete(id);
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

    startRace(code: string): RoomRace {
      const room = requireRoom(code);
      if (room.race !== undefined) {
        throw new RoomRegistryError(
          "race-in-progress",
          "A race has already started in this room",
        );
      }
      if (room.players.length < MIN_RACE_PLAYERS) {
        throw new RoomRegistryError(
          "not-enough-players",
          `A race needs at least ${MIN_RACE_PLAYERS} players`,
        );
      }
      const startsAt = readNow(now) + RACE_COUNTDOWN_MS;
      const race: RoomRace = { snippet: readSnippet(pickSnippet()), startsAt };
      room.race = race;
      return copyRace(race);
    },

    raceState(code: string): RoomRaceState {
      const room = requireRoom(code);
      if (room.race === undefined) {
        return { phase: "waiting" };
      }
      const race = copyRace(room.race);
      const phase = readNow(now) < race.startsAt ? "countdown" : "racing";
      return { phase, race };
    },

    reportProgress(code: string, playerId: string, position: number): PlayerProgress {
      const room = requireRoom(code);
      const id = readMemberId(room, playerId);
      const cursor = readProgressPosition(position);
      if (cursor === undefined) {
        throw new RoomRegistryError(
          "invalid-progress",
          "Progress must be a non-negative integer",
        );
      }
      const instant = readNow(now);
      if (room.race === undefined || instant < room.race.startsAt) {
        throw new RoomRegistryError("race-not-running", "No race is running in this room");
      }
      const length = room.race.snippet.code.length;
      if (cursor > length) {
        throw new RoomRegistryError("invalid-progress", "Progress is past the end of the snippet");
      }
      const previous = room.progress.get(id) ?? 0;
      if (cursor < previous) {
        throw new RoomRegistryError("invalid-progress", "Progress cannot move backward");
      }
      room.progress.set(id, cursor);
      if (cursor === length && !room.finishes.has(id)) {
        room.finishes.set(id, { at: instant, seq: room.nextFinish });
        room.nextFinish += 1;
      }
      return { playerId: id, position: cursor, finished: cursor === length };
    },

    listProgress(code: string): readonly PlayerProgress[] {
      const room = requireRoom(code);
      if (room.race === undefined) {
        return [];
      }
      const length = room.race.snippet.code.length;
      const listed: PlayerProgress[] = [];
      for (const player of room.players) {
        const position = room.progress.get(player.id);
        if (position === undefined) {
          continue;
        }
        listed.push({ playerId: player.id, position, finished: position === length });
      }
      return listed;
    },

    concludeRace(code: string): readonly RaceResultEntry[] | undefined {
      const room = requireRoom(code);
      if (room.race === undefined) {
        return undefined;
      }
      const instant = readNow(now);
      if (instant < room.race.startsAt) {
        return undefined;
      }
      const everyoneFinished =
        room.players.length > 0 &&
        room.players.every((player) => room.finishes.has(player.id));
      const capped = instant >= room.race.startsAt + RACE_LIMIT_MS;
      if (!everyoneFinished && !capped) {
        return undefined;
      }
      const results = standings(room);
      clearRace(room);
      return results;
    },
  };
}

function emptyRoom(code: string, players: Player[]): MutableRoom {
  return {
    code,
    players,
    race: undefined,
    progress: new Map(),
    finishes: new Map(),
    nextFinish: 0,
  };
}

function clearRace(room: MutableRoom): void {
  room.race = undefined;
  room.progress.clear();
  room.finishes.clear();
  room.nextFinish = 0;
}

/**
 * Finishers still in the room, fastest first.
 *
 * The same finish time keeps the order the finishes were accepted. Words per
 * minute treat the whole snippet as correct, because a finish is the cursor
 * at the end of that snippet. The figure is not rounded.
 */
function standings(room: MutableRoom): RaceResultEntry[] {
  const race = room.race;
  if (race === undefined) {
    return [];
  }
  const length = race.snippet.code.length;
  const ranked: { player: Player; mark: FinishMark }[] = [];
  for (const player of room.players) {
    const mark = room.finishes.get(player.id);
    if (mark === undefined) {
      continue;
    }
    ranked.push({ player, mark });
  }
  ranked.sort((left, right) => {
    if (left.mark.at !== right.mark.at) {
      return left.mark.at - right.mark.at;
    }
    return left.mark.seq - right.mark.seq;
  });
  const results: RaceResultEntry[] = [];
  for (let index = 0; index < ranked.length; index += 1) {
    const entry = ranked[index];
    if (entry === undefined) {
      continue;
    }
    const timeMs = entry.mark.at - race.startsAt;
    results.push({
      playerId: entry.player.id,
      name: entry.player.name,
      place: index + 1,
      timeMs,
      wpm: calculateWpm(length, timeMs),
    });
  }
  return results;
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
  if (id.length === 0) {
    throw new RoomRegistryError("invalid-player", "Player id must not be empty");
  }
  const name = normalizePlayerName(player.name);
  if (name === undefined) {
    throw new RoomRegistryError("invalid-player", playerNameErrorMessage());
  }
  return { id, name };
}

function readMemberId(room: MutableRoom, playerId: string): string {
  if (typeof playerId !== "string" || playerId.trim() === "") {
    throw new RoomRegistryError("not-in-room", `Player is not in room ${room.code}`);
  }
  const id = playerId.trim();
  if (!room.players.some((player) => player.id === id)) {
    throw new RoomRegistryError("not-in-room", `Player ${id} is not in room ${room.code}`);
  }
  return id;
}

function readProgressPosition(position: number): number | undefined {
  if (typeof position !== "number" || !Number.isSafeInteger(position) || position < 0) {
    return undefined;
  }
  return position;
}

function readSuppliedCode(code: string): string {
  const roomId = normalizeRoomId(code);
  if (roomId === undefined) {
    throw new RoomRegistryError("invalid-code", roomIdErrorMessage());
  }
  return roomId;
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

function readNow(now: () => number): number {
  const value = now();
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new RoomRegistryError("invalid-clock", "now() must return a finite number");
  }
  return value;
}

function readSnippet(value: Snippet): Snippet {
  if (typeof value !== "object" || value === null) {
    throw new RoomRegistryError(
      "invalid-snippet",
      "Snippet must include id, language, title, and code",
    );
  }
  const id = value.id;
  const language = value.language;
  const title = value.title;
  const code = value.code;
  if (
    typeof id !== "string" ||
    id.length === 0 ||
    typeof language !== "string" ||
    !isLanguage(language) ||
    typeof title !== "string" ||
    title.trim().length === 0 ||
    typeof code !== "string" ||
    code.length === 0
  ) {
    throw new RoomRegistryError(
      "invalid-snippet",
      "Snippet must include id, language, title, and code",
    );
  }
  return { id, language, title, code };
}

function copyRace(race: RoomRace): RoomRace {
  return {
    snippet: {
      id: race.snippet.id,
      language: race.snippet.language,
      title: race.snippet.title,
      code: race.snippet.code,
    },
    startsAt: race.startsAt,
  };
}
