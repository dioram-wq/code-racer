# code-racer

Type real code against the clock. code-racer is a TypeRacer-style game with a terminal look: you type generated snippets, and it tracks words per minute and accuracy. The aim is a small, well-tested way to practice typing speed and syntax.

## Roadmap

The project grows in small steps.

- [x] Monorepo scaffold (`shared` workspace, TypeScript)
- [x] WPM and accuracy calculation
- [x] Snippet generator (JavaScript, TypeScript, Python, Go, and Rust)
- [ ] Typing engine (per-character correctness, backspace, finish detection)
- [ ] Single-player race screen
- [ ] Express server and WebSocket rooms for live multiplayer
- [ ] Lint, typecheck, and test in GitHub Actions

## Develop

Node.js 20 or newer.

```bash
npm install
npm test
```

## Layout

| Path | Role |
| --- | --- |
| `shared/` | Pure TypeScript game logic (stats and snippet selection), shared by the future client and server |

## License

[MIT](./LICENSE)
