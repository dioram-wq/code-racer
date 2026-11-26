import { createServer, type Server } from "node:http";
import { calculateWpm, getSnippet, playerIdErrorMessage, type Snippet } from "@code-racer/shared";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { attachRoomServer } from "./rooms-socket.js";
import { RACE_COUNTDOWN_MS, createRoomRegistry, type RoomRegistry } from "./rooms.js";

interface Running {
  server: Server;
  socketServer: WebSocketServer;
  port: number;
  registry: RoomRegistry;
  clients: WebSocket[];
}

const runningServers: Running[] = [];

afterEach(async () => {
  const open = runningServers.splice(0);
  await Promise.all(open.map(stop));
});

describe("room sockets", () => {
  it("joins a room by id and lists the player", async () => {
    const running = await start();
    const socket = await connect(running);
    const inbox = new Inbox(socket);

    socket.send(json({ type: "join", roomId: "  ab12 ", name: "  Ada  " }));

    expect(JSON.parse(await inbox.next())).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p1", name: "Ada" }],
    });
    expect(running.registry.listPlayers("ab12")).toEqual([{ id: "p1", name: "Ada" }]);

    const health = await fetch(`http://127.0.0.1:${running.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
  });

  it("broadcasts the player list to everyone in the room, in join order", async () => {
    const running = await start();
    const ada = await connect(running);
    const bea = await connect(running);
    const cam = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    const camInbox = new Inbox(cam);

    ada.send(json({ type: "join", roomId: "ab12", name: "Ada" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p1", name: "Ada" }],
    });

    const adaSeesBea = adaInbox.next();
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea" }));
    const withBea = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
      ],
    };
    expect(JSON.parse(await adaSeesBea)).toEqual(withBea);
    expect(JSON.parse(await beaInbox.next())).toEqual(withBea);

    const adaSeesCam = adaInbox.next();
    const beaSeesCam = beaInbox.next();
    cam.send(json({ type: "join", roomId: "ab12", name: "Cam" }));
    const withCam = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Cam" },
      ],
    };
    expect(JSON.parse(await adaSeesCam)).toEqual(withCam);
    expect(JSON.parse(await beaSeesCam)).toEqual(withCam);
    expect(JSON.parse(await camInbox.next())).toEqual(withCam);
  });

  it("removes a player who leaves and tells whoever remains", async () => {
    const running = await start();
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const beaSeesLeave = beaInbox.next();
    ada.send(json({ type: "leave" }));

    expect(JSON.parse(await beaSeesLeave)).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p2", name: "Bea" }],
    });
    expect(running.registry.listPlayers("AB12")).toEqual([{ id: "p2", name: "Bea" }]);

    const adaReturns = adaInbox.next();
    const beaSeesReturn = beaInbox.next();
    ada.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
    const rejoined = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Ada" },
      ],
    };
    expect(JSON.parse(await adaReturns)).toEqual(rejoined);
    expect(JSON.parse(await beaSeesReturn)).toEqual(rejoined);
  });

  it("removes a player who disconnects and deletes an empty room", async () => {
    const running = await start();
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const beaSeesDisconnect = beaInbox.next();
    await closeSocket(ada);

    expect(JSON.parse(await beaSeesDisconnect)).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p2", name: "Bea" }],
    });
    expect(running.registry.listPlayers("AB12")).toEqual([{ id: "p2", name: "Bea" }]);

    await closeSocket(bea);
    expect(() => running.registry.listPlayers("AB12")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
  });

  it("ignores a disconnect from a socket that never joined", async () => {
    const running = await start();
    const idle = await connect(running);
    await closeSocket(idle);

    const socket = await connect(running);
    const inbox = new Inbox(socket);
    socket.send(json({ type: "join", roomId: "AB12", name: "Ada" }));

    expect(JSON.parse(await inbox.next())).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p1", name: "Ada" }],
    });
  });

  it("rejects malformed messages without joining, then accepts a valid join", async () => {
    const running = await start();
    const socket = await connect(running);
    const inbox = new Inbox(socket);

    socket.send("not json");
    expect(JSON.parse(await inbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected JSON",
    });

    socket.send(json([]));
    expect(JSON.parse(await inbox.next())).toMatchObject({
      type: "error",
      code: "malformed",
      message: "Expected a JSON object",
    });

    socket.send(json({ type: "join", roomId: 12, name: "Ada" }));
    expect(JSON.parse(await inbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Join requires roomId and name strings",
    });

    socket.send(json({ type: "wave" }));
    expect(JSON.parse(await inbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected type join, leave, start, or progress",
    });

    socket.send(Buffer.from([0, 1, 2]));
    expect(JSON.parse(await inbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected a JSON text message",
    });

    socket.send(json({ type: "join", roomId: "bad id", name: "Ada" }));
    expect(JSON.parse(await inbox.next())).toMatchObject({ type: "error", code: "invalid-room" });

    socket.send(json({ type: "join", roomId: "AB12", name: "   " }));
    expect(JSON.parse(await inbox.next())).toMatchObject({ type: "error", code: "invalid-player" });

    expect(() => running.registry.listPlayers("AB12")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );

    socket.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
    expect(JSON.parse(await inbox.next())).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p1", name: "Ada" }],
    });
  });

  it("rejects a second join and a leave from a socket that is outside a room", async () => {
    const running = await start();
    const ada = await connect(running);
    const adaInbox = new Inbox(ada);

    ada.send(json({ type: "leave" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "not-in-room",
      message: "Not in a room",
    });

    ada.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
    await adaInbox.next();
    ada.send(json({ type: "join", roomId: "OTHER", name: "Ada Again" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "already-joined",
      message: "Already in room AB12",
    });

    const bea = await connect(running);
    const beaInbox = new Inbox(bea);
    const adaSeesBea = adaInbox.next();
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea" }));

    const players = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
      ],
    };
    expect(JSON.parse(await adaSeesBea)).toEqual(players);
    expect(JSON.parse(await beaInbox.next())).toEqual(players);
    expect(() => running.registry.listPlayers("OTHER")).toThrow(
      expect.objectContaining({ code: "room-not-found" }),
    );
  });

  it("broadcasts a race start to the room and not to anyone else", async () => {
    const chosen = passage("go-sum");
    const now = 1_700_000_000_000;
    const running = await start({
      registry: createRoomRegistry({ now: () => now, pickSnippet: () => chosen }),
    });
    const ada = await connect(running);
    const bea = await connect(running);
    const cam = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    const camInbox = new Inbox(cam);
    await joinBoth(ada, adaInbox, bea, beaInbox);
    cam.send(json({ type: "join", roomId: "other", name: "Cam" }));
    await camInbox.next();

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    bea.send(json({ type: "start", language: "rust" }));

    const race = {
      type: "race-start",
      roomId: "AB12",
      snippet: chosen,
      startsAt: now + RACE_COUNTDOWN_MS,
    };
    expect(JSON.parse(await adaSeesRace)).toEqual(race);
    expect(JSON.parse(await beaSeesRace)).toEqual(race);
    expect(running.registry.raceState("AB12")).toEqual({
      phase: "countdown",
      race: { snippet: chosen, startsAt: race.startsAt },
    });

    const dee = await connect(running);
    const deeInbox = new Inbox(dee);
    const camSeesDee = camInbox.next();
    dee.send(json({ type: "join", roomId: "OTHER", name: "Dee" }));
    const others = {
      type: "players",
      roomId: "OTHER",
      players: [
        { id: "p3", name: "Cam" },
        { id: "p4", name: "Dee" },
      ],
    };
    expect(JSON.parse(await camSeesDee)).toEqual(others);
    expect(JSON.parse(await deeInbox.next())).toEqual(others);
  });

  it("sends the countdown race to a player who joins later", async () => {
    const chosen = passage("ts-clamp");
    const now = 10_000;
    const running = await start({ registry: fixedRegistry() });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);
    const adaSeesRace = adaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaInbox.next();

    const cam = await connect(running);
    const camInbox = new Inbox(cam);
    const adaSeesCam = adaInbox.next();
    const beaSeesCam = beaInbox.next();
    cam.send(json({ type: "join", roomId: "AB12", name: "Cam" }));

    const players = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Cam" },
      ],
    };
    expect(JSON.parse(await camInbox.next())).toEqual(players);
    expect(JSON.parse(await camInbox.next())).toEqual({
      type: "race-start",
      roomId: "AB12",
      snippet: chosen,
      startsAt: now + RACE_COUNTDOWN_MS,
    });
    expect(JSON.parse(await adaSeesCam)).toEqual(players);
    expect(JSON.parse(await beaSeesCam)).toEqual(players);

    const adaSeesLeave = adaInbox.next();
    const camSeesLeave = camInbox.next();
    bea.send(json({ type: "leave" }));
    const withoutBea = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p3", name: "Cam" },
      ],
    };
    expect(JSON.parse(await adaSeesLeave)).toEqual(withoutBea);
    expect(JSON.parse(await camSeesLeave)).toEqual(withoutBea);
  });

  it("sends the snippet and current progress to a player who joins mid-race", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const dee = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    const deeInbox = new Inbox(dee);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const adaSeesDee = adaInbox.next();
    const beaSeesDee = beaInbox.next();
    dee.send(json({ type: "join", roomId: "AB12", name: "Dee" }));
    const three = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Dee" },
      ],
    };
    expect(JSON.parse(await adaSeesDee)).toEqual(three);
    expect(JSON.parse(await beaSeesDee)).toEqual(three);
    expect(JSON.parse(await deeInbox.next())).toEqual(three);

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    const deeSeesRace = deeInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaSeesRace;
    await deeSeesRace;
    clock.startTyping();

    const length = clock.snippet.code.length;
    const adaMoves = adaInbox.next();
    const beaSeesAda = beaInbox.next();
    const deeSeesAda = deeInbox.next();
    ada.send(json({ type: "progress", position: 4 }));
    await adaMoves;
    await beaSeesAda;
    await deeSeesAda;
    const beaFinishes = beaInbox.next();
    const adaSeesBea = adaInbox.next();
    const deeSeesBea = deeInbox.next();
    bea.send(json({ type: "progress", position: length }));
    await beaFinishes;
    await adaSeesBea;
    await deeSeesBea;

    const cam = await connect(running);
    const camInbox = new Inbox(cam);
    const adaSeesCam = adaInbox.next();
    const beaSeesCam = beaInbox.next();
    const deeSeesCam = deeInbox.next();
    cam.send(json({ type: "join", roomId: "ab12", name: "Cam" }));

    const players = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p1", name: "Ada" },
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Dee" },
        { id: "p4", name: "Cam" },
      ],
    };
    expect(JSON.parse(await camInbox.next())).toEqual(players);
    expect(JSON.parse(await camInbox.next())).toEqual({
      type: "race-start",
      roomId: "AB12",
      snippet: clock.snippet,
      startsAt: 20_000 + RACE_COUNTDOWN_MS,
    });
    expect(JSON.parse(await camInbox.next())).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 4,
      finished: false,
    });
    expect(JSON.parse(await camInbox.next())).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "p2",
      position: length,
      finished: true,
    });
    expect(JSON.parse(await adaSeesCam)).toEqual(players);
    expect(JSON.parse(await beaSeesCam)).toEqual(players);
    expect(JSON.parse(await deeSeesCam)).toEqual(players);

    const camSeesLive = camInbox.next();
    ada.send(json({ type: "progress", position: 6 }));
    expect(JSON.parse(await camSeesLive)).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 6,
      finished: false,
    });
  });

  it("sends the race to a player who rejoins without their old position", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaSeesRace;
    clock.startTyping();

    const length = clock.snippet.code.length;
    ada.send(json({ type: "progress", position: length }));
    await adaInbox.next();
    await beaInbox.next();
    bea.send(json({ type: "progress", position: 2 }));
    await adaInbox.next();
    await beaInbox.next();

    const beaSeesLeave = beaInbox.next();
    ada.send(json({ type: "leave" }));
    expect(JSON.parse(await beaSeesLeave)).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p2", name: "Bea" }],
    });

    const again = await connect(running);
    const againInbox = new Inbox(again);
    const beaSeesReturn = beaInbox.next();
    again.send(json({ type: "join", roomId: "AB12", name: "Ada" }));

    const players = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "p2", name: "Bea" },
        { id: "p3", name: "Ada" },
      ],
    };
    expect(JSON.parse(await againInbox.next())).toEqual(players);
    expect(JSON.parse(await againInbox.next())).toEqual({
      type: "race-start",
      roomId: "AB12",
      snippet: clock.snippet,
      startsAt: 20_000 + RACE_COUNTDOWN_MS,
    });
    expect(JSON.parse(await againInbox.next())).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "p2",
      position: 2,
      finished: false,
    });
    expect(JSON.parse(await beaSeesReturn)).toEqual(players);

    const againSeesLive = againInbox.next();
    const beaSeesLive = beaInbox.next();
    bea.send(json({ type: "progress", position: 3 }));
    const live = {
      type: "progress",
      roomId: "AB12",
      playerId: "p2",
      position: 3,
      finished: false,
    };
    expect(JSON.parse(await againSeesLive)).toEqual(live);
    expect(JSON.parse(await beaSeesLive)).toEqual(live);
  });

  it("rejects a start when the socket is outside a room or the room has one player", async () => {
    const running = await start({ registry: fixedRegistry() });
    const ada = await connect(running);
    const adaInbox = new Inbox(ada);

    ada.send(json({ type: "start" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "not-in-room",
      message: "Not in a room",
    });

    ada.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
    await adaInbox.next();
    ada.send(json({ type: "start" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "not-enough-players",
      message: "A race needs at least 2 players",
    });
    expect(running.registry.raceState("AB12")).toEqual({ phase: "waiting" });
  });

  it("rejects a second start without telling the rest of the room", async () => {
    const running = await start({ registry: fixedRegistry() });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const adaSeesRace = adaInbox.next();
    bea.send(json({ type: "start" }));
    await adaSeesRace;
    await beaInbox.next();

    ada.send(json({ type: "start" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "race-in-progress",
      message: "A race has already started in this room",
    });

    const beaSeesLeave = beaInbox.next();
    ada.send(json({ type: "leave" }));
    expect(JSON.parse(await beaSeesLeave)).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p2", name: "Bea" }],
    });
    expect(running.registry.raceState("AB12").phase).toBe("countdown");
  });

  it("ignores malformed frames and still starts on a later valid message", async () => {
    const chosen = passage("js-sum");
    const now = 50_000;
    const running = await start({
      registry: createRoomRegistry({ now: () => now, pickSnippet: () => chosen }),
    });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    ada.send("not json");
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected JSON",
    });
    ada.send(json({ type: "go" }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected type join, leave, start, or progress",
    });
    ada.send(Buffer.from([9]));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Expected a JSON text message",
    });
    expect(running.registry.raceState("AB12")).toEqual({ phase: "waiting" });

    const beaSeesRace = beaInbox.next();
    ada.send(json({ type: "start" }));
    const race = {
      type: "race-start",
      roomId: "AB12",
      snippet: chosen,
      startsAt: now + RACE_COUNTDOWN_MS,
    };
    expect(JSON.parse(await adaInbox.next())).toEqual(race);
    expect(JSON.parse(await beaSeesRace)).toEqual(race);
  });

  it("broadcasts progress to the room and marks a player finished at the end", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const cam = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    const camInbox = new Inbox(cam);
    await joinBoth(ada, adaInbox, bea, beaInbox);
    cam.send(json({ type: "join", roomId: "other", name: "Cam" }));
    await camInbox.next();

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaSeesRace;
    clock.startTyping();

    const adaSeesProgress = adaInbox.next();
    const beaSeesProgress = beaInbox.next();
    ada.send(json({ type: "progress", position: 4, extra: true }));
    const typed = {
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 4,
      finished: false,
    };
    expect(JSON.parse(await adaSeesProgress)).toEqual(typed);
    expect(JSON.parse(await beaSeesProgress)).toEqual(typed);

    const adaSeesFinish = adaInbox.next();
    const beaSeesFinish = beaInbox.next();
    bea.send(json({ type: "progress", position: clock.snippet.code.length }));
    const finished = {
      type: "progress",
      roomId: "AB12",
      playerId: "p2",
      position: clock.snippet.code.length,
      finished: true,
    };
    expect(JSON.parse(await adaSeesFinish)).toEqual(finished);
    expect(JSON.parse(await beaSeesFinish)).toEqual(finished);

    const dee = await connect(running);
    const deeInbox = new Inbox(dee);
    const camSeesDee = camInbox.next();
    dee.send(json({ type: "join", roomId: "OTHER", name: "Dee" }));
    expect(JSON.parse(await camSeesDee)).toEqual({
      type: "players",
      roomId: "OTHER",
      players: [
        { id: "p3", name: "Cam" },
        { id: "p4", name: "Dee" },
      ],
    });
    await deeInbox.next();
  });

  it("rejects progress when no race is running", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const adaInbox = new Inbox(ada);

    ada.send(json({ type: "progress", position: 1 }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "not-in-room",
      message: "Not in a room",
    });

    ada.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
    await adaInbox.next();
    ada.send(json({ type: "progress", position: 1 }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "race-not-running",
      message: "No race is running in this room",
    });

    const bea = await connect(running);
    const beaInbox = new Inbox(bea);
    const adaSeesBea = adaInbox.next();
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea" }));
    await adaSeesBea;
    await beaInbox.next();

    const adaSeesRace = adaInbox.next();
    bea.send(json({ type: "start" }));
    await adaSeesRace;
    await beaInbox.next();
    expect(running.registry.raceState("AB12").phase).toBe("countdown");

    ada.send(json({ type: "progress", position: 5 }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "race-not-running",
      message: "No race is running in this room",
    });

    clock.startTyping();
    const beaSeesProgress = beaInbox.next();
    ada.send(json({ type: "progress", position: 2 }));
    const progress = {
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 2,
      finished: false,
    };
    expect(JSON.parse(await adaInbox.next())).toEqual(progress);
    expect(JSON.parse(await beaSeesProgress)).toEqual(progress);
  });

  it("rejects a malformed progress frame", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);
    const adaSeesRace = adaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaInbox.next();
    clock.startTyping();

    const error = {
      type: "error",
      code: "malformed",
      message: "Progress requires a non-negative integer position",
    };
    for (const position of [-1, 1.5, "4", null, true]) {
      ada.send(json({ type: "progress", position }));
      expect(JSON.parse(await adaInbox.next())).toEqual(error);
    }
    ada.send(json({ type: "progress" }));
    expect(JSON.parse(await adaInbox.next())).toEqual(error);

    const beaSeesProgress = beaInbox.next();
    ada.send(json({ type: "progress", position: 3 }));
    const progress = {
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 3,
      finished: false,
    };
    expect(JSON.parse(await adaInbox.next())).toEqual(progress);
    expect(JSON.parse(await beaSeesProgress)).toEqual(progress);
  });

  it("rejects a progress position past the snippet or behind the last report", async () => {
    const clock = clockedRace();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);
    const adaSeesRace = adaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaInbox.next();
    clock.startTyping();

    ada.send(json({ type: "progress", position: clock.snippet.code.length + 1 }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "invalid-progress",
      message: "Progress is past the end of the snippet",
    });

    const adaSeesProgress = adaInbox.next();
    const beaSeesProgress = beaInbox.next();
    ada.send(json({ type: "progress", position: 4 }));
    const typed = {
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: 4,
      finished: false,
    };
    expect(JSON.parse(await adaSeesProgress)).toEqual(typed);
    expect(JSON.parse(await beaSeesProgress)).toEqual(typed);

    ada.send(json({ type: "progress", position: 2 }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "error",
      code: "invalid-progress",
      message: "Progress cannot move backward",
    });

    const beaSeesRepeat = beaInbox.next();
    ada.send(json({ type: "progress", position: 4 }));
    expect(JSON.parse(await adaInbox.next())).toEqual(typed);
    expect(JSON.parse(await beaSeesRepeat)).toEqual(typed);
  });

  it("joins a room the registry already created", async () => {
    const registry = createRoomRegistry({ random: () => 0 });
    const room = registry.create({ id: "host", name: "Host" });
    const running = await start({ registry, ids: ["ada"] });
    const socket = await connect(running);
    const inbox = new Inbox(socket);

    socket.send(json({ type: "join", roomId: room.code.toLowerCase(), name: "Ada" }));

    expect(JSON.parse(await inbox.next())).toEqual({
      type: "players",
      roomId: room.code,
      players: [
        { id: "host", name: "Host" },
        { id: "ada", name: "Ada" },
      ],
    });
  });

  it("uses a supplied player id and still assigns one when it is omitted", async () => {
    const running = await start();
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);

    ada.send(json({ type: "join", roomId: " ab12 ", name: "Ada", playerId: "  Ab-1  " }));
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "Ab-1", name: "Ada" }],
    });

    const adaSeesBea = adaInbox.next();
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea" }));
    const both = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "Ab-1", name: "Ada" },
        { id: "p1", name: "Bea" },
      ],
    };
    expect(JSON.parse(await adaSeesBea)).toEqual(both);
    expect(JSON.parse(await beaInbox.next())).toEqual(both);
    expect(running.registry.listPlayers("AB12")).toEqual(both.players);
  });

  it("rejects a duplicate player id and a player id the protocol will not accept", async () => {
    const running = await start();
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);

    ada.send(json({ type: "join", roomId: "AB12", name: "Ada", playerId: "ada-1" }));
    await adaInbox.next();

    bea.send(json({ type: "join", roomId: "AB12", name: "Bea", playerId: "ada-1" }));
    expect(JSON.parse(await beaInbox.next())).toEqual({
      type: "error",
      code: "already-joined",
      message: "Player ada-1 is already in room AB12",
    });
    expect(running.registry.listPlayers("AB12")).toEqual([{ id: "ada-1", name: "Ada" }]);

    bea.send(json({ type: "join", roomId: "AB12", name: "Bea", playerId: "bad id" }));
    expect(JSON.parse(await beaInbox.next())).toEqual({
      type: "error",
      code: "invalid-player",
      message: playerIdErrorMessage(),
    });
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea", playerId: 4 }));
    expect(JSON.parse(await beaInbox.next())).toEqual({
      type: "error",
      code: "malformed",
      message: "Join playerId must be a string",
    });
    expect(running.registry.listPlayers("AB12")).toEqual([{ id: "ada-1", name: "Ada" }]);

    const adaSeesBea = adaInbox.next();
    bea.send(json({ type: "join", roomId: "AB12", name: "Bea", playerId: "bea-2" }));
    const both = {
      type: "players",
      roomId: "AB12",
      players: [
        { id: "ada-1", name: "Ada" },
        { id: "bea-2", name: "Bea" },
      ],
    };
    expect(JSON.parse(await adaSeesBea)).toEqual(both);
    expect(JSON.parse(await beaInbox.next())).toEqual(both);
  });

  it("broadcasts results in finishing order and then accepts another start", async () => {
    const clock = movableClock();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaSeesRace;

    const length = clock.snippet.code.length;
    const startsAt = 20_000 + RACE_COUNTDOWN_MS;
    clock.at(startsAt + 12_000);
    const adaSeesBea = adaInbox.next();
    const beaSeesFinish = beaInbox.next();
    bea.send(json({ type: "progress", position: length }));
    const beaFinished = {
      type: "progress",
      roomId: "AB12",
      playerId: "p2",
      position: length,
      finished: true,
    };
    expect(JSON.parse(await adaSeesBea)).toEqual(beaFinished);
    expect(JSON.parse(await beaSeesFinish)).toEqual(beaFinished);
    expect(running.registry.raceState("AB12").phase).toBe("racing");

    clock.at(startsAt + 18_000);
    const adaSeesFinish = adaInbox.next();
    const beaSeesAda = beaInbox.next();
    ada.send(json({ type: "progress", position: length }));
    const adaFinished = {
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: length,
      finished: true,
    };
    expect(JSON.parse(await adaSeesFinish)).toEqual(adaFinished);
    expect(JSON.parse(await beaSeesAda)).toEqual(adaFinished);

    const results = {
      type: "race-results",
      roomId: "AB12",
      results: [
        {
          playerId: "p2",
          name: "Bea",
          place: 1,
          timeMs: 12_000,
          wpm: calculateWpm(length, 12_000),
        },
        {
          playerId: "p1",
          name: "Ada",
          place: 2,
          timeMs: 18_000,
          wpm: calculateWpm(length, 18_000),
        },
      ],
    };
    expect(JSON.parse(await adaInbox.next())).toEqual(results);
    expect(JSON.parse(await beaInbox.next())).toEqual(results);
    expect(running.registry.raceState("AB12")).toEqual({ phase: "waiting" });
    expect(running.registry.listProgress("AB12")).toEqual([]);

    const againAt = clock.time() + RACE_COUNTDOWN_MS;
    const adaSeesNext = adaInbox.next();
    const beaSeesNext = beaInbox.next();
    bea.send(json({ type: "start" }));
    const next = {
      type: "race-start",
      roomId: "AB12",
      snippet: clock.snippet,
      startsAt: againAt,
    };
    expect(JSON.parse(await adaSeesNext)).toEqual(next);
    expect(JSON.parse(await beaSeesNext)).toEqual(next);
    expect(running.registry.raceState("AB12")).toEqual({
      phase: "countdown",
      race: { snippet: clock.snippet, startsAt: againAt },
    });
  });

  it("broadcasts results when a player leaves and everyone remaining has finished", async () => {
    const clock = movableClock();
    const running = await start({ registry: clock.registry });
    const ada = await connect(running);
    const bea = await connect(running);
    const adaInbox = new Inbox(ada);
    const beaInbox = new Inbox(bea);
    await joinBoth(ada, adaInbox, bea, beaInbox);

    const adaSeesRace = adaInbox.next();
    const beaSeesRace = beaInbox.next();
    ada.send(json({ type: "start" }));
    await adaSeesRace;
    await beaSeesRace;

    const length = clock.snippet.code.length;
    const startsAt = 20_000 + RACE_COUNTDOWN_MS;
    clock.at(startsAt + 9_000);
    const beaSeesAda = beaInbox.next();
    ada.send(json({ type: "progress", position: length }));
    await adaInbox.next();
    expect(JSON.parse(await beaSeesAda)).toEqual({
      type: "progress",
      roomId: "AB12",
      playerId: "p1",
      position: length,
      finished: true,
    });

    const adaSeesLeave = adaInbox.next();
    bea.send(json({ type: "leave" }));
    expect(JSON.parse(await adaSeesLeave)).toEqual({
      type: "players",
      roomId: "AB12",
      players: [{ id: "p1", name: "Ada" }],
    });
    expect(JSON.parse(await adaInbox.next())).toEqual({
      type: "race-results",
      roomId: "AB12",
      results: [
        {
          playerId: "p1",
          name: "Ada",
          place: 1,
          timeMs: 9_000,
          wpm: calculateWpm(length, 9_000),
        },
      ],
    });
    expect(running.registry.raceState("AB12")).toEqual({ phase: "waiting" });
    expect(running.registry.listPlayers("AB12")).toEqual([{ id: "p1", name: "Ada" }]);
    expect(running.registry.concludeRace("AB12")).toBeUndefined();
  });
});

async function joinBoth(
  ada: WebSocket,
  adaInbox: Inbox,
  bea: WebSocket,
  beaInbox: Inbox,
): Promise<void> {
  ada.send(json({ type: "join", roomId: "AB12", name: "Ada" }));
  await adaInbox.next();
  const adaSeesBea = adaInbox.next();
  bea.send(json({ type: "join", roomId: "AB12", name: "Bea" }));
  await adaSeesBea;
  await beaInbox.next();
}

async function start(options?: { registry?: RoomRegistry; ids?: string[] }): Promise<Running> {
  const registry = options?.registry ?? createRoomRegistry();
  const ids = [...(options?.ids ?? ["p1", "p2", "p3", "p4"])];
  const server = createServer(createApp());
  const socketServer = attachRoomServer(server, {
    registry,
    createPlayerId: () => {
      const id = ids.shift();
      if (id === undefined) {
        throw new Error("ran out of player ids");
      }
      return id;
    },
  });
  const running: Running = { server, socketServer, port: 0, registry, clients: [] };
  runningServers.push(running);
  await listen(server);
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port");
  }
  running.port = address.port;
  return running;
}

function listen(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
}

async function connect(running: Running): Promise<WebSocket> {
  const socket = new WebSocket(`ws://127.0.0.1:${running.port}`);
  running.clients.push(socket);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };
    const onOpen = (): void => {
      cleanup();
      socket.on("error", () => undefined);
      resolve();
    };
    const cleanup = (): void => {
      socket.off("error", onError);
      socket.off("open", onOpen);
    };
    socket.once("error", onError);
    socket.once("open", onOpen);
  });
  return socket;
}

function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    socket.once("close", () => {
      resolve();
    });
    socket.close();
  });
}

async function stop(running: Running): Promise<void> {
  await Promise.all(running.clients.map(closeSocket));
  await new Promise<void>((resolve, reject) => {
    running.socketServer.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
  await closeServer(running.server);
}

function closeServer(server: Server): Promise<void> {
  if (!server.listening) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error !== undefined) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

class Inbox {
  readonly messages: string[] = [];
  private readonly waiters: ((message: string) => void)[] = [];

  constructor(socket: WebSocket) {
    socket.on("message", (data, isBinary) => {
      const text = isBinary ? "" : data.toString();
      const waiter = this.waiters.shift();
      if (waiter !== undefined) {
        waiter(text);
        return;
      }
      this.messages.push(text);
    });
  }

  next(): Promise<string> {
    const queued = this.messages.shift();
    if (queued !== undefined) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve) => {
      this.waiters.push(resolve);
    });
  }
}

function json(value: unknown): string {
  return JSON.stringify(value);
}

function passage(id: string): Snippet {
  const snippet = getSnippet(id);
  if (snippet === undefined) {
    throw new Error(`missing snippet ${id}`);
  }
  return snippet;
}

function fixedRegistry(): RoomRegistry {
  const chosen = passage("ts-clamp");
  return createRoomRegistry({
    now: () => 10_000,
    pickSnippet: () => chosen,
  });
}

interface ClockedRace {
  registry: RoomRegistry;
  snippet: Snippet;
  /** Moves the clock from the countdown to the instant typing begins. */
  startTyping: () => void;
}

function movableClock(start = 20_000): {
  registry: RoomRegistry;
  snippet: Snippet;
  at: (time: number) => void;
  time: () => number;
} {
  const snippet = passage("js-sum");
  let time = start;
  const registry = createRoomRegistry({
    now: () => time,
    pickSnippet: () => snippet,
  });
  return {
    registry,
    snippet,
    at(next: number) {
      time = next;
    },
    time() {
      return time;
    },
  };
}

function clockedRace(): ClockedRace {
  const snippet = passage("js-sum");
  let time = 20_000;
  const registry = createRoomRegistry({
    now: () => time,
    pickSnippet: () => snippet,
  });
  return {
    registry,
    snippet,
    startTyping() {
      time = 20_000 + RACE_COUNTDOWN_MS;
    },
  };
}
