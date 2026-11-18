# code-racer

[![CI](https://github.com/dioram-wq/code-racer/actions/workflows/ci.yml/badge.svg)](https://github.com/dioram-wq/code-racer/actions/workflows/ci.yml)

Type real code against the clock. code-racer is a TypeRacer-style game with a terminal look: you type generated snippets, and it tracks words per minute and accuracy. The aim is a small, well-tested way to practice typing speed and syntax.

## Roadmap

The project grows in small steps.

- [x] Monorepo scaffold (`shared` workspace, TypeScript)
- [x] WPM and accuracy calculation
- [x] Snippet generator (JavaScript, TypeScript, Python, Go, and Rust)
- [x] Typing engine (per-character correctness, backspace, finish detection)
- [x] Single-player race screen (snippet, character styles, live stats, result, next snippet, and language choice)
- [ ] Express server and WebSocket rooms for live multiplayer
- [x] Typecheck and test in GitHub Actions
- [x] Lint in GitHub Actions

The server scaffold is in place: an Express app with `GET /health`, and an in-memory room registry. WebSocket rooms are the next step.

## Develop

Node.js 20 or newer.

```bash
npm install
npm test
npm run lint
npm run dev -w @code-racer/client
npm start -w @code-racer/server
```

`npm test` and `npm run typecheck` run in every workspace. The dev script starts the Vite client at <http://localhost:5173>. It starts on a TypeScript snippet, with a language row for JavaScript, TypeScript, Python, Go, Rust, or any. Choosing a language loads a fresh passage from that set and resets the typing state and the clock. Any uses the whole catalog. The screen colors each character as you type, and shows elapsed time, words per minute, and accuracy. The current language is shown next to the snippet title. The clock starts on the first keystroke and stops when the passage is finished. The finished line shows the final words per minute, accuracy, and time. Next snippet, Enter, or Tab loads a different passage in the chosen language and resets the typing state and the clock.

`npm start -w @code-racer/server` listens on port 3001, or on `PORT` when that variable is set. `GET http://localhost:3001/health` returns `{ "ok": true }`. Rooms stay in memory inside that process. Nothing is broadcast over a socket yet.

## Layout

| Path | Role |
| --- | --- |
| `shared/` | Pure TypeScript game logic (stats, snippet selection, and the typing engine), shared by the client and the server |
| `shared/src/typing.ts` | Keystrokes, per-character correctness, cursor, errors, and finish |
| `server/` | Express app. `createApp()` serves `GET /health`. The start script listens on `PORT` (default 3001) |
| `server/src/rooms.ts` | In-memory rooms: create a short code, join, leave, and list players. No WebSocket transport yet |
| `client/` | React and Vite race screen. Renders a shared snippet with pending, correct, incorrect, and cursor styles, plus a live clock, WPM, and accuracy. A language row filters the catalog. A finished passage shows the result and can load another snippet in the chosen language |
| `client/src/race-characters.ts` | Maps typing-engine state onto those character styles |
| `client/src/race-stats.ts` | Starts and stops the race clock, and formats WPM, accuracy, and elapsed time from the shared stats functions |
| `client/src/race-passage.ts` | Picks the next snippet without an immediate repeat, resets the typing state and clock, and formats the finished result |
| `client/src/race-language.ts` | Picks the next snippet for JavaScript, TypeScript, Python, Go, Rust, or any, without an immediate repeat, and resets the passage when the language changes |

## Credit

code-racer is built with AI pair programming. Cursor agents write the increments under Diogo's direction.

## License

[MIT](./LICENSE)
