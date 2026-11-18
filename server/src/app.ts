import express, { type Express } from "express";

/**
 * HTTP application for code-racer.
 *
 * `GET /health` reports that this process is up. Room membership is not an
 * HTTP route. The process attaches a WebSocket server to this app's HTTP
 * server (`rooms-socket.ts`) and keeps the rooms in memory.
 */
export function createApp(): Express {
  const app = express();

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}
