import { getSnippet, type Snippet } from "@code-racer/shared";
import { describe, expect, it } from "vitest";
import {
  MIN_RACE_PLAYERS,
  RACE_COUNTDOWN_MS,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Player,
  RoomRegistryError,
  createRoomRegistry,
  type RoomRegistry,
} from "./rooms.js";

const ada: Player = { id: "ada", name: "Ada" };
const bea: Player = { id: "bea", name: "Bea" };

describe("createRoomRegistry", () => {
  it("opens a room with a short code and the first player", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create({ id: "  ada  ", name: "  Ada Lovelace  " });

    expect(ROOM_CODE_ALPHABET).toBe("ABCDEFGHJKLMNPQRSTUVWXYZ23456789");
    expect(room.code).toBe("A".repeat(ROOM_CODE_LENGTH));
    expect(room.players).toEqual([{ id: "ada", name: "Ada Lovelace" }]);
    expect(registry.listPlayers(room.code)).toEqual(room.players);
  });

  it("draws every character from the unambiguous alphabet", () => {
    const registry = createRoomRegistry();
    const pattern = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

    for (let index = 0; index < 20; index += 1) {
      const room = registry.create({ id: `p${index}`, name: `Player ${index}` });
      expect(room.code).toMatch(pattern);
    }
  });

  it("uses the injected random source for each character", () => {
    const last = (ROOM_CODE_ALPHABET.length - 1) / ROOM_CODE_ALPHABET.length;
    const registry = createRoomRegistry({ random: () => last });
    const room = registry.create(ada);

    expect(room.code).toBe("9".repeat(ROOM_CODE_LENGTH));
  });

  it("rejects an empty id or name", () => {
    const registry = createRoomRegistry({ random: () => 0 });

    expect(() => registry.create({ id: " ", name: "Ada" })).toThrow(
      expect.objectContaining({ code: "invalid-player" }),
    );
    expect(() => registry.create({ id: "ada", name: "" })).toThrow(
      expect.objectContaining({ code: "invalid-player" }),
    );
    expect(() =>
      registry.create({ id: 1, name: "Ada" } as unknown as Player),
    ).toThrow(expect.objectContaining({ code: "invalid-player" }));
  });

  it("keeps each player in one room", () => {
    const registry = createRoomRegistry({
      random: sequence(0, 3 / ROOM_CODE_ALPHABET.length),
      codeLength: 1,
    });
    const first = registry.create(ada);
    const second = registry.create(bea);

    expect(first.code).toBe("A");
    expect(second.code).toBe("D");
    expect(() => registry.create({ id: "ada", name: "Ada Again" })).toThrow(
      expect.objectContaining({ code: "already-joined" }),
    );
    expect(() => registry.join(second.code, ada)).toThrow(
      expect.objectContaining({ code: "already-joined" }),
    );
    expect(registry.listPlayers(first.code)).toEqual([ada]);
  });

  it("gives up when every generated code is already taken", () => {
    const registry = createRoomRegistry({ random: () => 0, codeLength: 1 });
    registry.create(ada);

    expect(() => registry.create(bea)).toThrow(
      expect.objectContaining({ code: "code-exhausted" }),
    );
    expect(registry.listPlayers("A")).toEqual([ada]);
  });

  it("rejects a code length outside 1 to 8", () => {
    expect(() => createRoomRegistry({ codeLength: 0 })).toThrow(
      expect.objectContaining({ code: "invalid-code-length" }),
    );
    expect(() => createRoomRegistry({ codeLength: 1.5 })).toThrow(
      expect.objectContaining({ code: "invalid-code-length" }),
    );
    expect(() => createRoomRegistry({ codeLength: 9 })).toThrow(
      expect.objectContaining({ code: "invalid-code-length" }),
    );
  });

  it("rejects a random source that leaves the unit interval", () => {
    const registry = createRoomRegistry({ random: () => 1 });

    expect(() => registry.create(ada)).toThrow(
      expect.objectContaining({ code: "invalid-random" }),
    );
  });
});

describe("join, leave, and listPlayers", () => {
  it("adds players in join order and matches codes without case", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create(ada);

    const joined = registry.join(`  ${room.code.toLowerCase()}  `, {
      id: "bea",
      name: "Bea",
    });

    expect(joined.players).toEqual([ada, bea]);
    expect(registry.listPlayers("aaaa")).toEqual([ada, bea]);
  });

  it("allows two players to share a display name", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create(ada);

    registry.join(room.code, { id: "ada-2", name: "Ada" });

    expect(registry.listPlayers(room.code).map((player) => player.name)).toEqual([
      "Ada",
      "Ada",
    ]);
  });

  it("returns the room that remains after a player leaves", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create(ada);
    registry.join(room.code, bea);

    expect(registry.leave(room.code, "  bea  ")?.players).toEqual([ada]);
    expect(registry.listPlayers(room.code)).toEqual([ada]);
  });

  it("deletes the room when the last player leaves and frees the code", () => {
    const registry = createRoomRegistry({ random: () => 0, codeLength: 1 });
    const room = registry.create(ada);

    expect(registry.leave(room.code, ada.id)).toBeUndefined();
    expect(() => registry.listPlayers(room.code)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );

    const next = registry.create(bea);
    expect(next.code).toBe(room.code);
    expect(next.players).toEqual([bea]);
  });

  it("reports a missing room or a player who is not in it", () => {
    const registry = createRoomRegistry({
      random: sequence(0, 3 / ROOM_CODE_ALPHABET.length),
      codeLength: 1,
    });
    const room = registry.create(ada);
    registry.create(bea);

    expect(() => registry.join("ZZ", ada)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(() => registry.leave("missing", ada.id)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(() => registry.leave(room.code, bea.id)).toThrow(
      expect.objectContaining({ code: "not-in-room" }),
    );
    expect(() => registry.leave(room.code, " ")).toThrow(
      expect.objectContaining({ code: "not-in-room" }),
    );
    expect(registry.listPlayers(room.code)).toEqual([ada]);
  });

  it("does not let callers mutate the registry through a returned room", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create(ada);
    (room.players as Player[]).push(bea);
    const listed = registry.listPlayers(room.code);
    const first = listed[0];
    if (first === undefined) {
      throw new Error("expected the host to be listed");
    }
    (first as { name: string }).name = "Changed";

    expect(registry.listPlayers(room.code)).toEqual([ada]);
  });

  it("keeps registries independent", () => {
    const left = createRoomRegistry({ random: () => 0, codeLength: 1 });
    const right = createRoomRegistry({ random: () => 0, codeLength: 1 });

    expect(left.create(ada).code).toBe("A");
    expect(right.create(ada).code).toBe("A");
    expect(left.listPlayers("A")).toEqual([ada]);
    expect(right.listPlayers("A")).toEqual([ada]);
  });

  it("throws RoomRegistryError", () => {
    const registry = createRoomRegistry();

    expect(() => registry.listPlayers("missing")).toThrow(RoomRegistryError);
  });
});

describe("joinOrCreate", () => {
  it("opens a room with the supplied id and then adds players", () => {
    const registry = createRoomRegistry();
    const created = registry.joinOrCreate("  ab12  ", { id: "ada", name: "  Ada  " });
    const joined = registry.joinOrCreate("AB12", bea);

    expect(created).toEqual({ code: "AB12", players: [{ id: "ada", name: "Ada" }] });
    expect(joined.players).toEqual([{ id: "ada", name: "Ada" }, bea]);
    expect(registry.listPlayers("ab12")).toEqual(joined.players);
  });

  it("joins a room that create already opened", () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create(ada);

    expect(registry.joinOrCreate(room.code.toLowerCase(), bea).players).toEqual([ada, bea]);
  });

  it("rejects an id that is not 1 to 16 letters or digits", () => {
    const registry = createRoomRegistry();

    for (const code of ["", "   ", "AB-12", "A".repeat(17), "ÄBC", 12 as unknown as string]) {
      expect(() => registry.joinOrCreate(code, ada)).toThrow(
        expect.objectContaining({ code: "invalid-code" }),
      );
    }
    expect(registry.joinOrCreate("O0", ada).code).toBe("O0");
  });

  it("does not keep a player whose room id was rejected", () => {
    const registry = createRoomRegistry({ random: () => 0 });

    expect(() => registry.joinOrCreate("no-pe", ada)).toThrow(
      expect.objectContaining({ code: "invalid-code" }),
    );
    expect(registry.create(ada).players).toEqual([ada]);
  });

  it("rejects a name longer than 24 characters", () => {
    const registry = createRoomRegistry({ random: () => 0 });

    expect(() => registry.create({ id: "ada", name: "a".repeat(25) })).toThrow(
      expect.objectContaining({ code: "invalid-player" }),
    );
    expect(registry.joinOrCreate("AB", { id: "ada", name: `  ${"b".repeat(24)}  ` }).players).toEqual([
      { id: "ada", name: "b".repeat(24) },
    ]);
  });

  it("keeps a player in one room", () => {
    const registry = createRoomRegistry();
    registry.joinOrCreate("AAAA", ada);

    expect(() => registry.joinOrCreate("BBBB", ada)).toThrow(
      expect.objectContaining({ code: "already-joined" }),
    );
    expect(registry.listPlayers("AAAA")).toEqual([ada]);
    expect(() => registry.listPlayers("BBBB")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
  });

  it("deletes the room when its last player leaves and frees the id", () => {
    const registry = createRoomRegistry();
    registry.joinOrCreate("z9", ada);

    expect(registry.leave("Z9", ada.id)).toBeUndefined();
    expect(registry.joinOrCreate("z9", bea).players).toEqual([bea]);
  });
});

describe("startRace", () => {
  const chosen = passage("js-sum");

  it("stores a countdown and returns the catalog snippet", () => {
    const startedAt = 1_700_000_000_000;
    const registry = createRoomRegistry({
      now: () => startedAt,
      pickSnippet: () => chosen,
    });
    const code = twoPlayers(registry);

    const race = registry.startRace(`  ${code.toLowerCase()}  `);

    expect(MIN_RACE_PLAYERS).toBe(2);
    expect(race).toEqual({ snippet: chosen, startsAt: startedAt + RACE_COUNTDOWN_MS });
    expect(registry.raceState(code)).toEqual({ phase: "countdown", race });
    expect(registry.listPlayers(code)).toEqual([ada, bea]);
  });

  it("uses the shared catalog and the real clock when neither is injected", () => {
    const registry = createRoomRegistry();
    const code = twoPlayers(registry);
    const before = Date.now();
    const race = registry.startRace(code);
    const after = Date.now();

    expect(getSnippet(race.snippet.id)).toEqual(race.snippet);
    expect(race.startsAt).toBeGreaterThanOrEqual(before + RACE_COUNTDOWN_MS);
    expect(race.startsAt).toBeLessThanOrEqual(after + RACE_COUNTDOWN_MS);
    expect(registry.raceState(code).phase).toBe("countdown");
  });

  it("becomes racing at the start time and still rejects another start", () => {
    let time = 5_000;
    const registry = createRoomRegistry({
      now: () => time,
      pickSnippet: () => chosen,
    });
    const code = twoPlayers(registry);
    registry.startRace(code);

    expect(registry.raceState(code).phase).toBe("countdown");
    time = 5_000 + RACE_COUNTDOWN_MS - 1;
    expect(registry.raceState(code).phase).toBe("countdown");
    expect(() => registry.startRace(code)).toThrow(
      expect.objectContaining({
        code: "race-in-progress",
        message: "A race has already started in this room",
      }),
    );

    time = 5_000 + RACE_COUNTDOWN_MS;
    expect(registry.raceState(code).phase).toBe("racing");
    expect(() => registry.startRace(code)).toThrow(
      expect.objectContaining({ code: "race-in-progress" }),
    );
  });

  it("rejects a room with fewer than two players and leaves it waiting", () => {
    const registry = createRoomRegistry({ now: () => 0, pickSnippet: () => chosen });
    const code = registry.joinOrCreate("AB12", ada).code;

    expect(() => registry.startRace(code)).toThrow(
      expect.objectContaining({
        code: "not-enough-players",
        message: `A race needs at least ${MIN_RACE_PLAYERS} players`,
      }),
    );
    expect(registry.raceState(code)).toEqual({ phase: "waiting" });
  });

  it("keeps a race that already started after the room drops below two players", () => {
    const registry = createRoomRegistry({ now: () => 0, pickSnippet: () => chosen });
    const code = twoPlayers(registry);
    registry.startRace(code);
    registry.leave(code, bea.id);

    expect(() => registry.startRace(code)).toThrow(
      expect.objectContaining({ code: "race-in-progress" }),
    );
    expect(registry.raceState(code).phase).toBe("countdown");
    expect(registry.listPlayers(code)).toEqual([ada]);
  });

  it("drops the race when the room is deleted and allows a new one on the same id", () => {
    const registry = createRoomRegistry({ now: () => 20, pickSnippet: () => chosen });
    const code = twoPlayers(registry);
    registry.startRace(code);
    registry.leave(code, ada.id);
    expect(registry.leave(code, bea.id)).toBeUndefined();
    expect(() => registry.raceState(code)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );

    twoPlayers(registry);
    expect(registry.raceState(code)).toEqual({ phase: "waiting" });
    expect(registry.startRace(code).snippet).toEqual(chosen);
  });

  it("does not let a caller change the stored snippet", () => {
    const registry = createRoomRegistry({ now: () => 0, pickSnippet: () => chosen });
    const code = twoPlayers(registry);
    const race = registry.startRace(code);
    (race.snippet as { title: string }).title = "Changed";

    const state = registry.raceState(code);
    if (state.phase === "waiting") {
      throw new Error("expected the race to be stored");
    }
    expect(state.race.snippet).toEqual(chosen);
  });

  it("does not store a race when the clock or the snippet is unusable", () => {
    const nanClock = createRoomRegistry({ now: () => Number.NaN, pickSnippet: () => chosen });
    twoPlayers(nanClock);
    expect(() => nanClock.startRace("AB12")).toThrow(
      expect.objectContaining({ code: "invalid-clock" }),
    );
    expect(nanClock.raceState("AB12")).toEqual({ phase: "waiting" });

    const infiniteClock = createRoomRegistry({
      now: () => Number.POSITIVE_INFINITY,
      pickSnippet: () => chosen,
    });
    twoPlayers(infiniteClock);
    expect(() => infiniteClock.startRace("AB12")).toThrow(
      expect.objectContaining({ code: "invalid-clock" }),
    );
    expect(infiniteClock.raceState("AB12")).toEqual({ phase: "waiting" });

    const blank = createRoomRegistry({
      now: () => 1,
      pickSnippet: () => ({ ...chosen, id: "" }),
    });
    twoPlayers(blank);
    expect(() => blank.startRace("AB12")).toThrow(
      expect.objectContaining({ code: "invalid-snippet" }),
    );
    expect(blank.raceState("AB12")).toEqual({ phase: "waiting" });

    const unknownLanguage = createRoomRegistry({
      now: () => 1,
      pickSnippet: () => ({ ...chosen, language: "ruby" as Snippet["language"] }),
    });
    twoPlayers(unknownLanguage);
    expect(() => unknownLanguage.startRace("AB12")).toThrow(
      expect.objectContaining({ code: "invalid-snippet" }),
    );
  });

  it("reports a missing room", () => {
    const registry = createRoomRegistry();

    expect(() => registry.startRace("missing")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
    expect(() => registry.raceState("missing")).toThrow(RoomRegistryError);
  });
});

describe("reportProgress", () => {
  const snippet = passage("js-sum");

  it("records a forward position while racing and finishes at the end", () => {
    let time = 1_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);
    registry.startRace(code);
    time = 1_000 + RACE_COUNTDOWN_MS;

    expect(registry.reportProgress(`  ${code.toLowerCase()}  `, "  ada  ", 0)).toEqual({
      playerId: "ada",
      position: 0,
      finished: false,
    });
    expect(registry.reportProgress(code, ada.id, 4)).toEqual({
      playerId: "ada",
      position: 4,
      finished: false,
    });
    expect(registry.reportProgress(code, bea.id, snippet.code.length)).toEqual({
      playerId: "bea",
      position: snippet.code.length,
      finished: true,
    });
    expect(registry.reportProgress(code, ada.id, snippet.code.length)).toEqual({
      playerId: "ada",
      position: snippet.code.length,
      finished: true,
    });
    expect(registry.reportProgress(code, ada.id, snippet.code.length).finished).toBe(true);
  });

  it("rejects progress while the room is waiting or counting down", () => {
    let time = 1_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);

    expect(() => registry.reportProgress(code, ada.id, 1)).toThrow(
      expect.objectContaining({
        code: "race-not-running",
        message: "No race is running in this room",
      }),
    );

    registry.startRace(code);
    expect(registry.raceState(code).phase).toBe("countdown");
    expect(() => registry.reportProgress(code, ada.id, 1)).toThrow(
      expect.objectContaining({ code: "race-not-running" }),
    );
    time = 1_000 + RACE_COUNTDOWN_MS - 1;
    expect(() => registry.reportProgress(code, ada.id, 3)).toThrow(
      expect.objectContaining({ code: "race-not-running" }),
    );

    time = 1_000 + RACE_COUNTDOWN_MS;
    expect(registry.reportProgress(code, ada.id, 2)).toEqual({
      playerId: "ada",
      position: 2,
      finished: false,
    });
  });

  it("rejects a position past the snippet or behind the last report", () => {
    let time = 1_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);
    registry.startRace(code);
    time = 1_000 + RACE_COUNTDOWN_MS;

    expect(() => registry.reportProgress(code, ada.id, snippet.code.length + 1)).toThrow(
      expect.objectContaining({
        code: "invalid-progress",
        message: "Progress is past the end of the snippet",
      }),
    );
    expect(registry.reportProgress(code, ada.id, 5).position).toBe(5);
    expect(() => registry.reportProgress(code, ada.id, 4)).toThrow(
      expect.objectContaining({
        code: "invalid-progress",
        message: "Progress cannot move backward",
      }),
    );
    expect(() => registry.reportProgress(code, ada.id, 1.5)).toThrow(
      expect.objectContaining({
        code: "invalid-progress",
        message: "Progress must be a non-negative integer",
      }),
    );
    expect(() => registry.reportProgress(code, ada.id, -1)).toThrow(
      expect.objectContaining({
        code: "invalid-progress",
        message: "Progress must be a non-negative integer",
      }),
    );
    expect(() => registry.reportProgress(code, ada.id, "3" as unknown as number)).toThrow(
      expect.objectContaining({ code: "invalid-progress" }),
    );
    expect(registry.reportProgress(code, ada.id, 6)).toEqual({
      playerId: "ada",
      position: 6,
      finished: false,
    });
    expect(registry.reportProgress(code, bea.id, 1).position).toBe(1);
  });

  it("rejects a missing room or a player who is not in it", () => {
    const registry = createRoomRegistry({ now: () => 0, pickSnippet: () => snippet });

    expect(() => registry.reportProgress("missing", ada.id, 1)).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );

    const code = registry.joinOrCreate("AB12", ada).code;
    expect(() => registry.reportProgress(code, bea.id, 0)).toThrow(
      expect.objectContaining({
        code: "not-in-room",
        message: "Player bea is not in room AB12",
      }),
    );
    expect(() => registry.reportProgress(code, " ", 0)).toThrow(
      expect.objectContaining({
        code: "not-in-room",
        message: "Player is not in room AB12",
      }),
    );
  });

  it("forgets progress when the player leaves and lets them start again", () => {
    let time = 8_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);
    registry.startRace(code);
    time = 8_000 + RACE_COUNTDOWN_MS;
    registry.reportProgress(code, ada.id, snippet.code.length);

    registry.leave(code, ada.id);
    expect(registry.reportProgress(code, bea.id, 2)).toEqual({
      playerId: "bea",
      position: 2,
      finished: false,
    });

    registry.join(code, ada);
    expect(registry.reportProgress(code, ada.id, 1)).toEqual({
      playerId: "ada",
      position: 1,
      finished: false,
    });
  });
});

describe("listProgress", () => {
  const snippet = passage("js-sum");

  it("is empty while the room is waiting or counting down", () => {
    let time = 1_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);

    expect(registry.listProgress(code)).toEqual([]);
    registry.startRace(code);
    expect(registry.raceState(code).phase).toBe("countdown");
    expect(registry.listProgress(`  ${code.toLowerCase()}  `)).toEqual([]);

    time = 1_000 + RACE_COUNTDOWN_MS;
    expect(registry.listProgress(code)).toEqual([]);
  });

  it("lists accepted positions in join order with finished flags", () => {
    let time = 1_000;
    const registry = createRoomRegistry({ now: () => time, pickSnippet: () => snippet });
    const code = twoPlayers(registry);
    registry.join(code, { id: "cy", name: "Cy" });
    registry.startRace(code);
    time = 1_000 + RACE_COUNTDOWN_MS;

    registry.reportProgress(code, bea.id, snippet.code.length);
    registry.reportProgress(code, ada.id, 0);
    registry.reportProgress(code, ada.id, 3);

    const listed = registry.listProgress(code);
    expect(listed).toEqual([
      { playerId: "ada", position: 3, finished: false },
      { playerId: "bea", position: snippet.code.length, finished: true },
    ]);
    const first = listed[0];
    if (first === undefined) {
      throw new Error("expected Ada's progress");
    }
    (first as { position: number }).position = 9;
    expect(registry.listProgress(code)[0]).toEqual({
      playerId: "ada",
      position: 3,
      finished: false,
    });

    registry.leave(code, ada.id);
    expect(registry.listProgress(code)).toEqual([
      { playerId: "bea", position: snippet.code.length, finished: true },
    ]);
  });

  it("reports a missing room", () => {
    const registry = createRoomRegistry();

    expect(() => registry.listProgress("missing")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
  });
});

function passage(id: string): Snippet {
  const snippet = getSnippet(id);
  if (snippet === undefined) {
    throw new Error(`missing snippet ${id}`);
  }
  return snippet;
}

function twoPlayers(registry: RoomRegistry): string {
  const room = registry.joinOrCreate("AB12", ada);
  registry.join(room.code, bea);
  return room.code;
}

/** Values consumed in order. `Math.floor(sample * 32)` picks the alphabet index. */
function sequence(...samples: number[]): () => number {
  let index = 0;
  return () => {
    const sample = samples[index] ?? 0;
    index += 1;
    return sample;
  };
}
