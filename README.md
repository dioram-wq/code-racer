# code-racer

[![CI](https://github.com/dioram-wq/code-racer/actions/workflows/ci.yml/badge.svg)](https://github.com/dioram-wq/code-racer/actions/workflows/ci.yml)

Type real code against the clock. code-racer is a TypeRacer-style game with a terminal look: you type generated snippets, and it tracks words per minute and accuracy. The aim is a small, well-tested way to practice typing speed and syntax.

## Roadmap

The project grows in small steps.

- [x] Monorepo scaffold (`shared` workspace, TypeScript)
- [x] WPM and accuracy calculation
- [x] Snippet generator (JavaScript, TypeScript, Python, Go, and Rust)
- [x] Typing engine (per-character correctness, backspace, finish detection)
- [ ] Single-player race screen (in progress: the client shows one snippet and styles each character from the typing engine)
- [ ] Express server and WebSocket rooms for live multiplayer
- [x] Typecheck and test in GitHub Actions
- [x] Lint in GitHub Actions

## Develop

Node.js 20 or newer.

```bash
npm install
npm test
npm run lint
npm run dev -w @code-racer/client
```

`npm test` and `npm run typecheck` run in every workspace. The dev script starts the Vite client at <http://localhost:5173>. It loads one snippet and colors each character as you type. A clock, words per minute, and a way to start another passage are still to come.

## Layout

| Path | Role |
| --- | --- |
| `shared/` | Pure TypeScript game logic (stats, snippet selection, and the typing engine), shared by the client and the future server |
| `shared/src/typing.ts` | Keystrokes, per-character correctness, cursor, errors, and finish |
| `client/` | React and Vite race screen. Renders a shared snippet with pending, correct, incorrect, and cursor styles |
| `client/src/race-characters.ts` | Maps typing-engine state onto those character styles |

## Credit

code-racer is built with AI pair programming. Cursor agents write the increments under Diogo's direction.

## License

[MIT](./LICENSE)
