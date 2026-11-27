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
- [x] Express server and WebSocket rooms (join, leave, player list, race start, and progress)
- [x] Client progress protocol (build a progress message from the typing cursor, and fold room broadcasts into per-player progress)
- [x] Send typing progress from the race screen and show the other players
- [x] Send the race in progress to a player who joins late
- [x] Race results when everyone still in the room has finished, or the time limit is reached, then the room can start again
- [x] Show that finishing order on the race screen, and clear it when the next race starts
- [x] Typecheck and test in GitHub Actions
- [x] Lint in GitHub Actions

The server accepts WebSocket room membership. A client joins a room by id with a player name, leaves, or disconnects, and the server broadcasts that room's player list. Any player in a room of at least two can start a race. The server picks a snippet, counts down for three seconds, and broadcasts the snippet and the start time. Once the race is running, a player can report a character position and the server broadcasts it. The client builds that report from the typing cursor and folds the player list, the race start, and those broadcasts into a position and finished flag for each player who is still in the room. While a room link is connected, and the passage on screen is that race's snippet, the race screen sends a cursor that has moved forward. The first one goes out immediately. Another one inside the next tenth of a second is held, and the newest is what goes out when that interval ends. Reaching the end of the snippet is sent at once. A cursor that does not move forward is not sent. Under the passage, the screen lists every other player with a terminal bar. A room row on the screen opens the socket: a name and a room id join `ws://<page-host>:3001` (or `wss` when the page is https), the join carries a player id the screen generated, and start asks the server to begin. The race-start frame replaces the passage with that snippet. Until the passage is finished, the language buttons do not load a different one. Leave closes the socket. A player who joins while a race is counting down or running receives that race's snippet and start time, and the current position of anyone who has already reported, so the passage and the other players' bars are on screen. When every player still in the room has finished, or five minutes have passed since typing began, the server broadcasts the finishing order and the room is waiting again. The race screen clears that race, so start is offered again, and lists those places under the passage. The local player's row is marked. The list is cleared when the next race starts.

## Develop

Node.js 20 or newer.

```bash
npm install
npm test
npm run lint
npm run dev -w @code-racer/client
npm start -w @code-racer/server
```

`npm test` and `npm run typecheck` run in every workspace. The dev script starts the Vite client at <http://localhost:5173>. It starts on a TypeScript snippet, with a language row for JavaScript, TypeScript, Python, Go, Rust, or any. Choosing a language loads a fresh passage from that set and resets the typing state and the clock. Any uses the whole catalog. The screen colors each character as you type, and shows elapsed time, words per minute, and accuracy. The current language is shown next to the snippet title. The clock starts on the first keystroke and stops when the passage is finished. The finished line shows the final words per minute, accuracy, and time. Next snippet, Enter, or Tab loads a different passage in the chosen language and resets the typing state and the clock. The room row under the prompt joins a room on the server. The name defaults to guest. An empty or invalid room id is rejected before a socket opens. After the join, the row shows the room and a start button, and anyone else in the room is listed under the passage. Start is rejected while the room has fewer than two players. When the race begins, the passage becomes the server's snippet. When the race ends, the start button comes back and the places are listed under the passage until the next race starts. Leave returns to the form. If the socket never opens, or drops, the row says so and the form comes back.

`npm start -w @code-racer/server` listens on port 3001, or on `PORT` when that variable is set. `GET http://localhost:3001/health` returns `{ "ok": true }`. A WebSocket on the same port speaks the room protocol below. Rooms stay in memory inside that process.

## Rooms

The socket URL is `ws://localhost:3001` (or whatever `PORT` is). The race screen uses the page host with that port, and `wss` when the page is https. Each message is one JSON object. Room ids are 1 to 16 letters or digits, matched without case, so `ab12` and `AB12` are the same room. A typed id can use any letter or digit, including 0, O, 1, I, and L, which generated room codes leave out. The first join creates the room. Player names are trimmed and must be 1 to 24 characters. A join may include a player id of 1 to 64 letters, digits, or hyphens; the server uses it when it is present and still free, and assigns one when it is absent. A connection is in one room at a time, and a player id can be in only one room.

A client joins:

```json
{ "type": "join", "roomId": "ab12", "name": "Ada" }
```

The same join can name the player id. The race screen always does, so it can tell its own row from the others. The id is trimmed and keeps its case. Extra fields are ignored:

```json
{ "type": "join", "roomId": "ab12", "name": "Ada", "playerId": "6f0c8c3a-1b2e-4d5f-9a6b-7c8d9e0f1a2b" }
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

`snippet` is a catalog passage: `id`, `language`, `title`, and the exact `code`. `startsAt` is Unix time in milliseconds. Until that instant the race is counting down. At that instant it is racing. A player who joins while the race is counting down or racing receives this same frame on their socket, with the snippet and `startsAt` already chosen. The other players are not sent it again.

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

`finished` is true when `position` equals the length of `snippet.code`. A player who joins during the race also receives one `progress` frame for each player who already has an accepted position, in join order, with that position and finished flag. Someone who has not reported is left at 0. Those frames go to the joining socket only. A player who leaves and joins again starts back at position 0, and still receives the current race and the other players' positions.

The race ends when every player still in the room has finished, or when five minutes have passed since `startsAt`. The server broadcasts the finishers and the room is waiting, so a later `start` can begin another race. A player who left is left out. Someone still typing when the time limit ends the race is left out too. If nobody finished, `results` is empty and the room is still waiting. A progress report after that is `race-not-running`.

```json
{
  "type": "race-results",
  "roomId": "AB12",
  "results": [
    { "playerId": "…", "name": "Bea", "place": 1, "timeMs": 15000, "wpm": 48 }
  ]
}
```

`results` is finishing order. `place` starts at 1. `timeMs` is how long after `startsAt` that finish was accepted. Two finishes in the same millisecond keep the order they were accepted. `wpm` is the shared words-per-minute figure for the whole snippet over `timeMs`. It is not rounded. A finish at `startsAt` is 0 words per minute, which is what that formula returns when no time has elapsed. The sockets still in the room receive this after the progress or player-list frame that ended the race.

The client keeps a view of these broadcasts in `client/src/net/race-protocol.ts`. `progressMessage` builds the outgoing report from the typing cursor. `applyServerRoomMessage` folds a `players`, `race-start`, or `progress` frame into a position and `finished` flag for each player still in the room. A `race-results` frame stores that finishing order, clears the snippet, and sets every remaining player back to the start, so start is offered again. `client/src/race-results.tsx` draws those places under the passage: place, name, finish time, and words per minute. Time is floored to a tenth of a second, and words per minute are rounded to the nearest integer, matching the live readout. The row for this socket's player id is marked. An empty list says nobody finished. A later race-start, or a player list for a different room, clears the places. The race-start a late joiner receives is folded before the progress frames that follow it, so the passage and the bars show the race already in progress. An `error`, or a frame the module cannot read, leaves that view unchanged. `client/src/net/progress-report.ts` decides which of those cursors to send. `client/src/net/room-session.ts` builds the join, including the player id, and decides which frames to write. `client/src/net/use-room-connection.ts` opens the socket. `client/src/net/use-race-progress.ts` folds the frames from that link and sends them while the passage on screen is the race snippet. `client/src/race-room.ts` swaps the passage for the race snippet. `client/src/room-join.tsx` is the room row. `client/src/race-standings.tsx` renders the other players under the passage. The local player is left out of that list because the join named this socket's id.

A message the server cannot apply is answered on that socket only:

```json
{ "type": "error", "code": "malformed", "message": "Expected JSON" }
```

`code` is `malformed`, `invalid-room`, `invalid-player`, `already-joined`, `not-in-room`, `not-enough-players`, `race-in-progress`, `race-not-running`, or `invalid-progress`. `malformed` covers a frame that is not a join, leave, start, or progress object, including binary frames, a progress position that is not a non-negative integer, and a `playerId` that is not a string. `invalid-player` is a name or a supplied player id that fails its length and character rules. `already-joined` means this socket is already in a room, or the supplied player id is already in one. `not-enough-players` means the room has fewer than two players. `race-in-progress` means this room already has a countdown or a race. `race-not-running` means a progress report arrived while the room was waiting or still counting down. `invalid-progress` means the position is past the end of the snippet or behind that player's last report.

## Layout

| Path | Role |
| --- | --- |
| `shared/` | Pure TypeScript game logic (stats, snippet selection, and the typing engine) and the room message types, shared by the client and the server |
| `shared/src/typing.ts` | Keystrokes, per-character correctness, cursor, errors, and finish |
| `shared/src/room-messages.ts` | JSON room protocol: join (with an optional player id), leave, start, progress, the player-list broadcast, the race-start broadcast, the progress broadcast, the race-results broadcast, and error codes |
| `server/` | Express app and WebSocket rooms. `createApp()` serves `GET /health`. The start script listens on `PORT` (default 3001) and attaches the room socket to that HTTP server |
| `server/src/rooms.ts` | In-memory rooms: create a short code, join an existing code, open a room by id, leave, list players, start a race, record each player's progress while it is running, list those positions, and end the race with finishing order, time, and words per minute |
| `server/src/rooms-socket.ts` | WebSocket transport: join, leave, disconnect, start a race, report progress, broadcast the player list, race start, progress, and race results, and send the current race to a player who joins during it |
| `client/` | React and Vite race screen. Renders a shared snippet with pending, correct, incorrect, and cursor styles, plus a live clock, WPM, and accuracy. A language row filters the catalog. A finished passage shows the result and can load another snippet in the chosen language. A room row joins a server room, starts the race, loads that snippet, lists the other players under the passage, and shows the finishing order when the race ends |
| `client/src/net/race-protocol.ts` | Builds the outgoing progress message from the typing cursor, folds player, race-start, and progress broadcasts into a per-player position and finished flag, and stores the finishing order when results arrive |
| `client/src/net/progress-report.ts` | Decides which cursors are worth a progress report: ahead of the last send, held for a tenth of a second, then flushed. The finish is sent at once |
| `client/src/net/use-race-progress.ts` | While a room link is connected, folds server frames and sends the throttled cursor for the snippet on screen |
| `client/src/net/room-session.ts` | Join message, socket URL, and the pure session that decides what to send |
| `client/src/net/use-room-connection.ts` | Opens the WebSocket, joins, and exposes the room link once the player list names this socket |
| `client/src/race-room.ts` | Replaces the passage with the race snippet and keeps the language row on it until the buffer is finished |
| `client/src/room-join.tsx` | Room row: name, room id, join, start, and leave |
| `client/src/race-standings.tsx` | Terminal bars for every player except the local one |
| `client/src/race-results.tsx` | Terminal table of place, name, finish time, and words per minute after a race, with the local row marked |
| `client/src/race-characters.ts` | Maps typing-engine state onto those character styles |
| `client/src/race-stats.ts` | Starts and stops the race clock, and formats WPM, accuracy, and elapsed time from the shared stats functions |
| `client/src/race-passage.ts` | Picks the next snippet without an immediate repeat, resets the typing state and clock, and formats the finished result |
| `client/src/race-language.ts` | Picks the next snippet for JavaScript, TypeScript, Python, Go, Rust, or any, without an immediate repeat, and resets the passage when the language changes |

## Credit

code-racer is built with AI pair programming. Cursor agents write the increments under Diogo's direction.

## License

[MIT](./LICENSE)
