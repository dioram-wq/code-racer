import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { type WebSocketServer } from "ws";
import { createApp } from "./app.js";
import { attachRoomServer } from "./rooms-socket.js";
import { createRoomRegistry, type RoomRegistry } from "./rooms.js";

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
      message: "Expected type join or leave",
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
