import express, { type Express } from "express";

/**
 * HTTP application for code-racer.
 *
 * `GET /health` reports that this process is up. Room membership lives in
 * memory (`rooms.ts`) and is not served over HTTP yet. WebSocket rooms are
 * a later step.
 */
export function createApp(): Express {
  const app = express();

  app.get("/health", (_request, response) => {
    response.json({ ok: true });
  });

  return app;
}
