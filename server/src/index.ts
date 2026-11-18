import { createApp } from "./app.js";
import { readPort } from "./port.js";

const port = readPort(process.env.PORT);
const server = createApp().listen(port, () => {
  console.log(`code-racer server listening on http://localhost:${port}`);
});

server.on("error", (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
