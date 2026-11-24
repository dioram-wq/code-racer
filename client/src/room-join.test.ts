import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RoomJoin } from "./room-join.js";

const quiet = {
  roomId: undefined,
  name: undefined,
  pendingRoom: "",
  error: undefined,
  draftName: "guest",
  draftRoom: "",
  canStart: false,
  onDraftName: () => undefined,
  onDraftRoom: () => undefined,
  onJoin: () => undefined,
  onStart: () => undefined,
  onLeave: () => undefined,
};

describe("RoomJoin", () => {
  it("renders a name, a room, and join while the screen is not connected", () => {
    const html = render(createElement(RoomJoin, { ...quiet, mode: "form", draftRoom: "ab" }));

    expect(html).toContain('aria-label="Join a room"');
    expect(html).toContain('aria-label="Name"');
    expect(html).toContain('value="guest"');
    expect(html).toContain('aria-label="Room"');
    expect(html).toContain('value="ab"');
    expect(html).toContain("join");
    expect(html).not.toContain("start");
    expect(html).not.toContain("role=\"alert\"");
  });

  it("renders the room once joined, and start only before a snippet is known", () => {
    const html = render(
      createElement(RoomJoin, {
        ...quiet,
        mode: "joined",
        roomId: "AB12",
        name: "Ada",
        canStart: true,
      }),
    );

    expect(html).toContain("AB12 · Ada");
    expect(html).toContain("start");
    expect(html).toContain("leave");
    expect(html).not.toContain("join");

    const racing = render(
      createElement(RoomJoin, {
        ...quiet,
        mode: "joined",
        roomId: "AB12",
        name: "Ada",
        canStart: false,
        error: "A race has already started in this room",
      }),
    );
    expect(racing).not.toContain(">start<");
    expect(racing).toContain("leave");
    expect(racing).toContain('role="alert"');
    expect(racing).toContain("A race has already started in this room");
  });

  it("renders a joining line and a validation error on the form", () => {
    const joining = render(
      createElement(RoomJoin, { ...quiet, mode: "joining", pendingRoom: " ab12 " }),
    );
    expect(joining).toContain("joining AB12…");
    expect(joining).toContain("cancel");
    expect(joining).not.toContain(">join<");

    const invalid = render(
      createElement(RoomJoin, {
        ...quiet,
        mode: "form",
        error: "Room id must be 1 to 16 letters or digits",
      }),
    );
    expect(invalid).toContain('role="alert"');
    expect(invalid).toContain("Room id must be 1 to 16 letters or digits");
  });
});

function render(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(element);
}
