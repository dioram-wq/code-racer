/**
 * Opens the room socket for the race screen.
 *
 * While `request` is set, this hook connects to `url`, sends the join from
 * `stepRoomSession`, and keeps every server frame. The link passed to
 * `useRaceProgress` appears once the player list includes this socket's id.
 * Clearing `request`, or `leave`, closes the socket. A socket that drops
 * after it opened sets `notice` to "Disconnected". One that never opened
 * says it could not reach the server. Neither reconnects by itself.
 */

import type { ErrorRoomMessage, ReportProgressMessage } from "@code-racer/shared";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  createRoomSession,
  joinRoomMessage,
  stepRoomSession,
  type KnownJoin,
  type RoomSessionEvent,
  type RoomSessionPhase,
  type RoomSessionState,
} from "./room-session.js";
import type { RaceRoomLink } from "./use-race-progress.js";

export interface RoomJoinRequest {
  readonly url: string;
  readonly roomId: string;
  readonly name: string;
  /** Player id this client already knows. Sent on the join. */
  readonly selfId: string;
}

export interface RoomConnection {
  readonly phase: RoomSessionPhase | "idle";
  readonly selfId: string | undefined;
  readonly roomId: string | undefined;
  readonly name: string | undefined;
  readonly error: ErrorRoomMessage | undefined;
  readonly notice: string | undefined;
  /** Present only after the server has listed this socket. */
  readonly link: RaceRoomLink | undefined;
  readonly start: () => void;
  readonly leave: () => void;
}

/** No request, no socket. A request opens one WebSocket and joins. */
export function useRoomConnection(request: RoomJoinRequest | undefined): RoomConnection {
  const [state, setState] = useState<RoomSessionState | undefined>(undefined);
  const stateRef = useRef<RoomSessionState | undefined>(undefined);
  const socketRef = useRef<WebSocket | null>(null);
  const joinRef = useRef<KnownJoin | undefined>(undefined);

  const applyStep = useCallback((socket: WebSocket, event: RoomSessionEvent): void => {
    const current = stateRef.current;
    const join = joinRef.current;
    if (current === undefined || join === undefined) {
      return;
    }
    const step = stepRoomSession(current, event, join);
    stateRef.current = step.state;
    setState(step.state);
    for (const frame of step.send) {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(frame);
      }
    }
    if (event.type === "leave") {
      socket.close();
    }
  }, []);

  const url = request?.url;
  const roomId = request?.roomId;
  const name = request?.name;
  const selfId = request?.selfId;

  useEffect(() => {
    if (url === undefined || roomId === undefined || name === undefined || selfId === undefined) {
      joinRef.current = undefined;
      stateRef.current = undefined;
      setState(undefined);
      return;
    }
    const join = joinRoomMessage(roomId, name, selfId);
    if (join === undefined) {
      joinRef.current = undefined;
      stateRef.current = undefined;
      setState(undefined);
      return;
    }

    joinRef.current = join;
    const initial = createRoomSession(join.playerId);
    stateRef.current = initial;
    setState(initial);

    let alive = true;
    let socket: WebSocket;
    try {
      socket = new WebSocket(url);
    } catch {
      const failed = {
        ...initial,
        phase: "closed" as const,
        notice: "Could not reach the room server",
      };
      socketRef.current = null;
      stateRef.current = failed;
      setState(failed);
      return;
    }
    socketRef.current = socket;

    const dispatch = (event: RoomSessionEvent): void => {
      if (!alive) {
        return;
      }
      applyStep(socket, event);
    };

    socket.addEventListener("open", () => {
      if (!alive) {
        socket.close();
        return;
      }
      dispatch({ type: "open" });
    });
    socket.addEventListener("message", (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        return;
      }
      dispatch({ type: "message", raw: event.data });
    });
    socket.addEventListener("close", () => {
      dispatch({ type: "close" });
    });
    socket.addEventListener("error", () => undefined);

    return () => {
      alive = false;
      joinRef.current = undefined;
      if (socketRef.current === socket) {
        socketRef.current = null;
      }
      socket.close();
    };
  }, [url, roomId, name, selfId, applyStep]);

  const start = useCallback(() => {
    const socket = socketRef.current;
    if (socket !== null) {
      applyStep(socket, { type: "start" });
    }
  }, [applyStep]);

  const leave = useCallback(() => {
    const socket = socketRef.current;
    if (socket !== null) {
      applyStep(socket, { type: "leave" });
    }
  }, [applyStep]);

  const link = useMemo<RaceRoomLink | undefined>(() => {
    if (state === undefined || state.phase !== "joined") {
      return undefined;
    }
    const playerId = state.selfId;
    const frames = state.frames;
    return {
      selfId: playerId,
      frames,
      send(message: ReportProgressMessage) {
        const socket = socketRef.current;
        if (socket !== null) {
          applyStep(socket, { type: "progress", position: message.position });
        }
      },
    };
  }, [state, applyStep]);

  return {
    phase: state?.phase ?? "idle",
    selfId: state?.selfId,
    roomId: state?.roomId,
    name: state?.name,
    error: state?.error,
    notice: state?.notice,
    link,
    start,
    leave,
  };
}
