/**
 * The room row on the race screen: a name and a room id, then the joined
 * room. The socket lives in `useRoomConnection`. This component only renders.
 */

import type { MouseEvent } from "react";
import { normalizeRoomId } from "@code-racer/shared";

export type RoomJoinMode = "form" | "joining" | "joined";

export function RoomJoin({
  mode,
  roomId,
  name,
  pendingRoom,
  error,
  draftName,
  draftRoom,
  canStart,
  onDraftName,
  onDraftRoom,
  onJoin,
  onStart,
  onLeave,
}: {
  readonly mode: RoomJoinMode;
  readonly roomId: string | undefined;
  readonly name: string | undefined;
  readonly pendingRoom: string;
  readonly error: string | undefined;
  readonly draftName: string;
  readonly draftRoom: string;
  readonly canStart: boolean;
  readonly onDraftName: (value: string) => void;
  readonly onDraftRoom: (value: string) => void;
  readonly onJoin: () => void;
  readonly onStart: () => void;
  readonly onLeave: () => void;
}) {
  const joining = normalizeRoomId(pendingRoom) ?? pendingRoom.trim();
  return (
    <div className="room-panel">
      {mode === "joined" ? (
        <div className="room-row" aria-label="Room">
          <span className="room-label">room</span>
          <span className="room-status">
            {roomId} · {name}
          </span>
          {canStart ? (
            <button type="button" className="room-action" onMouseDown={keepFocus} onClick={onStart}>
              start
            </button>
          ) : null}
          <button type="button" className="room-action" onMouseDown={keepFocus} onClick={onLeave}>
            leave
          </button>
        </div>
      ) : null}
      {mode === "joining" ? (
        <div className="room-row" aria-label="Joining a room">
          <span className="room-label">room</span>
          <span className="room-status">joining {joining}…</span>
          <button type="button" className="room-action" onMouseDown={keepFocus} onClick={onLeave}>
            cancel
          </button>
        </div>
      ) : null}
      {mode === "form" ? (
        <form
          className="room-row"
          aria-label="Join a room"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            onJoin();
          }}
        >
          <span className="room-label">room</span>
          <input
            className="room-field room-name"
            aria-label="Name"
            name="name"
            value={draftName}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={24}
            onChange={(event) => {
              onDraftName(event.target.value);
            }}
          />
          <input
            className="room-field"
            aria-label="Room"
            name="room"
            value={draftRoom}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            maxLength={16}
            onChange={(event) => {
              onDraftRoom(event.target.value);
            }}
          />
          <button type="submit" className="room-action">
            join
          </button>
        </form>
      ) : null}
      {error !== undefined ? (
        <p className="room-error" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function keepFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}
