/**
 * Folds a room link into per-player progress and sends the local cursor.
 *
 * `link` comes from `useRoomConnection` once that socket has joined. While it
 * is present, `frames` are folded with `applyServerRoomMessage` and a cursor
 * that moves forward is reported through `link.send`. Reports wait until the
 * passage on screen is that race's snippet and the countdown has finished.
 * The finish itself is sent at once. This hook does not open a socket, and
 * it does not retry a report the server rejects.
 */

import type { ReportProgressMessage } from "@code-racer/shared";
import { useEffect, useRef, useState } from "react";
import { otherPlayerRows, type OtherPlayerRow } from "../race-standings.js";
import {
  createProgressReporter,
  flushProgressReport,
  observeProgressCursor,
  PROGRESS_REPORT_INTERVAL_MS,
  progressSendGate,
  type ProgressRace,
  type ProgressReporter,
} from "./progress-report.js";
import { applyServerRoomMessage, createRaceRoomState, type RaceRoomState } from "./race-protocol.js";

export interface RaceRoomLink {
  /**
   * Server id of this socket, once known. That player is left off the list.
   * Pass undefined until a join tells the client who it is.
   */
  readonly selfId: string | undefined;
  /**
   * Server frames in arrival order. Keep the same array until a frame
   * arrives, then pass a new one. The hook folds the whole list.
   */
  readonly frames: readonly string[];
  readonly send: (message: ReportProgressMessage) => void;
}

export interface RaceProgressOptions {
  /** Absent, or explicitly undefined, while the screen is not in a room. */
  readonly link?: RaceRoomLink | undefined;
  /** Local typing cursor. */
  readonly cursor: number;
  /** Id of the snippet on screen. */
  readonly passageId: string;
}

export interface RaceProgress {
  readonly room: RaceRoomState;
  readonly others: readonly OtherPlayerRow[];
}

/** Fold `frames` and report `cursor` while `link` is connected. */
export function useRaceProgress(options: RaceProgressOptions): RaceProgress {
  const { link, cursor, passageId } = options;
  const [room, setRoom] = useState(createRaceRoomState);
  const frames = link?.frames;
  const sendRef = useRef(link?.send);
  sendRef.current = link?.send;

  useEffect(() => {
    setRoom((current) => foldFrames(current, frames));
  }, [frames]);

  const racePassageId = room.snippet?.id;
  const raceLength = room.snippet?.code.length;
  const startsAt = room.startsAt;
  const raceKey = `${room.roomId ?? ""}\n${racePassageId ?? ""}\n${startsAt ?? ""}`;
  const connected = link !== undefined;
  const reporter = useRef<ProgressReporter>(createProgressReporter());
  const seenRace = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (!connected) {
      if (
        seenRace.current !== undefined ||
        reporter.current.sent !== undefined ||
        reporter.current.held !== undefined
      ) {
        seenRace.current = undefined;
        reporter.current = createProgressReporter();
      }
      return;
    }
    if (seenRace.current !== raceKey) {
      seenRace.current = raceKey;
      reporter.current = createProgressReporter();
    }

    const race = raceFrom(racePassageId, raceLength, startsAt);
    let timer: number | undefined;
    const clearTimer = () => {
      if (timer !== undefined) {
        window.clearTimeout(timer);
        timer = undefined;
      }
    };
    const schedule = (delayMs: number, run: () => void) => {
      clearTimer();
      timer = window.setTimeout(run, delayMs);
    };

    const flushHeld = () => {
      const flushed = flushProgressReport(reporter.current, performance.now());
      reporter.current = flushed.reporter;
      if (flushed.message !== undefined) {
        sendRef.current?.(flushed.message);
        return;
      }
      if (flushed.flushAt !== undefined) {
        schedule(Math.max(0, flushed.flushAt - performance.now()), flushHeld);
      }
    };

    const arm = () => {
      const nowMs = Date.now();
      const gate = progressSendGate(race, passageId, cursor, nowMs);
      if (!gate.open) {
        if (gate.waitUntil !== undefined) {
          schedule(Math.max(0, gate.waitUntil - nowMs), arm);
        }
        return;
      }
      const interval =
        race !== undefined && cursor === race.length ? 0 : PROGRESS_REPORT_INTERVAL_MS;
      const mono = performance.now();
      const step = observeProgressCursor(reporter.current, cursor, mono, interval);
      reporter.current = step.reporter;
      if (step.message !== undefined) {
        sendRef.current?.(step.message);
      }
      if (step.flushAt !== undefined) {
        schedule(Math.max(0, step.flushAt - mono), flushHeld);
      }
    };

    arm();
    return clearTimer;
  }, [connected, cursor, passageId, racePassageId, raceLength, startsAt, raceKey]);

  return {
    room,
    others: otherPlayerRows(room.players, raceLength, link?.selfId),
  };
}

function foldFrames(current: RaceRoomState, frames: readonly string[] | undefined): RaceRoomState {
  if (frames === undefined) {
    if (
      current.roomId === undefined &&
      current.players.length === 0 &&
      current.snippet === undefined &&
      current.startsAt === undefined &&
      current.results === undefined
    ) {
      return current;
    }
    return createRaceRoomState();
  }
  let next = createRaceRoomState();
  for (const frame of frames) {
    next = applyServerRoomMessage(next, frame);
  }
  return next;
}

function raceFrom(
  passageId: string | undefined,
  length: number | undefined,
  startsAt: number | undefined,
): ProgressRace | undefined {
  if (passageId === undefined || length === undefined || startsAt === undefined) {
    return undefined;
  }
  return { passageId, length, startsAt };
}
