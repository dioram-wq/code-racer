import { createServer } from "node:http";
import { createApp } from "./app.js";
import { readPort } from "./port.js";
import { attachRoomServer } from "./rooms-socket.js";

const port = readPort(process.env.PORT);
const server = createServer(createApp());
attachRoomServer(server);

server.listen(port, () => {
  console.log(`code-racer server listening on http://localhost:${port}`);
});

server.on("error", (error: Error) => {
  console.error(error.message);
  process.exit(1);
});
