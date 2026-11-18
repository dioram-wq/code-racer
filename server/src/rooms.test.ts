import { describe, expect, it } from "vitest";
import {
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  type Player,
  RoomRegistryError,
  createRoomRegistry,
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

/** Values consumed in order. `Math.floor(sample * 32)` picks the alphabet index. */
function sequence(...samples: number[]): () => number {
  let index = 0;
  return () => {
    const sample = samples[index] ?? 0;
    index += 1;
    return sample;
  };
}
