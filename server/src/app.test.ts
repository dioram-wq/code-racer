import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "./app.js";

const servers: Server[] = [];

afterEach(async () => {
  const open = servers.splice(0);
  await Promise.all(open.map(closeServer));
});

describe("GET /health", () => {
  it("returns ok", async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/health`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect(await response.json()).toEqual({ ok: true });
  });

  it("does not serve other routes", async () => {
    const baseUrl = await listen();
    const response = await fetch(`${baseUrl}/rooms`);

    expect(response.status).toBe(404);
  });
});

async function listen(): Promise<string> {
  const server = createServer(createApp());
  servers.push(server);
  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error): void => {
      reject(error);
    };
    server.once("error", onError);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", onError);
      resolve();
    });
  });
  const address: AddressInfo | string | null = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected the test server to listen on a TCP port");
  }
  return `http://127.0.0.1:${address.port}`;
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
