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
- [x] Express server and WebSocket rooms (join, leave, player list, and race start)
- [ ] Sync typing progress during a race
- [x] Typecheck and test in GitHub Actions
- [x] Lint in GitHub Actions

The server accepts WebSocket room membership. A client joins a room by id with a player name, leaves, or disconnects, and the server broadcasts that room's player list. Any player in a room of at least two can start a race. The server picks a snippet, counts down for three seconds, and broadcasts the snippet and the start time. Once the race is running, a player can report a character position and the server broadcasts it. The client does not send progress yet.

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

`npm start -w @code-racer/server` listens on port 3001, or on `PORT` when that variable is set. `GET http://localhost:3001/health` returns `{ "ok": true }`. A WebSocket on the same port speaks the room protocol below. Rooms stay in memory inside that process.

## Rooms

The socket URL is `ws://localhost:3001` (or whatever `PORT` is). Each message is one JSON object. Room ids are 1 to 16 letters or digits, matched without case, so `ab12` and `AB12` are the same room. A typed id can use any letter or digit, including 0, O, 1, I, and L, which generated room codes leave out. The first join creates the room. Player names are trimmed and must be 1 to 24 characters. The server assigns each connection a player id. A connection is in one room at a time.

A client joins:

```json
{ "type": "join", "roomId": "ab12", "name": "Ada" }
```

A client leaves:

```json
{ "type": "leave" }
```

Closing the socket leaves the room too. Whenever the player list changes, everyone still in the room receives the list in join order:

```json
{
  "type": "players",
  "roomId": "AB12",
  "players": [{ "id": "…", "name": "Ada" }]
}
```

Any player in the room can start a race. The room is the socket's current room. Extra fields are ignored:

```json
{ "type": "start" }
```

The room needs at least two players, and it holds one race at a time. The server picks a snippet from the shared catalog, counts down for three seconds, and broadcasts this to everyone still in the room:

```json
{
  "type": "race-start",
  "roomId": "AB12",
  "snippet": {
    "id": "ts-clamp",
    "language": "typescript",
    "title": "Clamp a number",
    "code": "function clamp(value: number, min: number, max: number): number {\n  return Math.min(Math.max(value, min), max);\n}"
  },
  "startsAt": 1700000003000
}
```

`snippet` is a catalog passage: `id`, `language`, `title`, and the exact `code`. `startsAt` is Unix time in milliseconds. Until that instant the race is counting down. At that instant it is racing. A player who joins after this broadcast does not receive it again.

While the race is running, a player reports how many characters they have typed. `position` counts characters in `snippet.code`, from 0 through that code's length. Extra fields are ignored:

```json
{ "type": "progress", "position": 12 }
```

The server accepts this only once `startsAt` has been reached. A report while the room is waiting, or still counting down, is rejected. `position` has to be a non-negative integer no greater than the snippet length, and it cannot move backward from that player's last accepted report. The same position may be sent again. Reaching the snippet length marks that player finished. Everyone still in the room receives:

```json
{
  "type": "progress",
  "roomId": "AB12",
  "playerId": "…",
  "position": 12,
  "finished": false
}
```

`finished` is true when `position` equals the length of `snippet.code`. The server does not resend earlier progress to a player who joins later. A player who leaves and joins again starts back at position 0.

A message the server cannot apply is answered on that socket only:

```json
{ "type": "error", "code": "malformed", "message": "Expected JSON" }
```

`code` is `malformed`, `invalid-room`, `invalid-player`, `already-joined`, `not-in-room`, `not-enough-players`, `race-in-progress`, `race-not-running`, or `invalid-progress`. `malformed` covers a frame that is not a join, leave, start, or progress object, including binary frames and a progress position that is not a non-negative integer. `not-enough-players` means the room has fewer than two players. `race-in-progress` means this room already has a countdown or a race. `race-not-running` means a progress report arrived while the room was waiting or still counting down. `invalid-progress` means the position is past the end of the snippet or behind that player's last report.

## Layout

| Path | Role |
| --- | --- |
| `shared/` | Pure TypeScript game logic (stats, snippet selection, and the typing engine) and the room message types, shared by the client and the server |
| `shared/src/typing.ts` | Keystrokes, per-character correctness, cursor, errors, and finish |
| `shared/src/room-messages.ts` | JSON room protocol: join, leave, start, progress, the player-list broadcast, the race-start broadcast, the progress broadcast, and error codes |
| `server/` | Express app and WebSocket rooms. `createApp()` serves `GET /health`. The start script listens on `PORT` (default 3001) and attaches the room socket to that HTTP server |
| `server/src/rooms.ts` | In-memory rooms: create a short code, join an existing code, open a room by id, leave, list players, start a race, and record each player's progress while it is running |
| `server/src/rooms-socket.ts` | WebSocket transport: join, leave, disconnect, start a race, report progress, and broadcast the player list, race start, and progress |
| `client/` | React and Vite race screen. Renders a shared snippet with pending, correct, incorrect, and cursor styles, plus a live clock, WPM, and accuracy. A language row filters the catalog. A finished passage shows the result and can load another snippet in the chosen language |
| `client/src/race-characters.ts` | Maps typing-engine state onto those character styles |
| `client/src/race-stats.ts` | Starts and stops the race clock, and formats WPM, accuracy, and elapsed time from the shared stats functions |
| `client/src/race-passage.ts` | Picks the next snippet without an immediate repeat, resets the typing state and clock, and formats the finished result |
| `client/src/race-language.ts` | Picks the next snippet for JavaScript, TypeScript, Python, Go, Rust, or any, without an immediate repeat, and resets the passage when the language changes |

## Credit

code-racer is built with AI pair programming. Cursor agents write the increments under Diogo's direction.

## License

[MIT](./LICENSE)
