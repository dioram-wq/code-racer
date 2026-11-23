/**
 * When the race screen should send a progress report.
 *
 * The server rejects a position behind the last one it accepted, and sending
 * the same position again does not move the room. Keystrokes can also arrive
 * faster than a broadcast is worth. `observeProgressCursor` hands the socket
 * a position only when it is strictly ahead of the last one sent. The first
 * such cursor goes out immediately. Another one before the interval has
 * elapsed is held, and the newest of those is what `flushProgressReport`
 * sends once the interval ends. An interval of 0 sends every cursor that is
 * ahead, which is how the finish is reported without waiting.
 *
 * `progressSendGate` is the other half. It stays closed until the passage on
 * screen is the race snippet and `startsAt` has been reached, so a countdown
 * or a local passage is not reported. `startsAt` is Unix time, so the clock
 * passed here has to be Unix time too. The throttle clock is just a
 * monotonic number the caller supplies. Neither function opens a socket.
 */

import type { ReportProgressMessage } from "@code-racer/shared";

/** How long to hold a cursor that moved again after a report. A tenth of a second. */
export const PROGRESS_REPORT_INTERVAL_MS = 100;

/** The race the gate compares with the passage on screen. */
export interface ProgressRace {
  /** Snippet id from the race-start frame. */
  readonly passageId: string;
  /** `snippet.code.length`. */
  readonly length: number;
  /** Unix milliseconds when typing begins. */
  readonly startsAt: number;
}

export interface ProgressSendGate {
  /** The cursor may be reported for this passage. */
  readonly open: boolean;
  /**
   * Unix milliseconds when a countdown ends. Absent when waiting will not
   * open the gate, for example because this is a different passage.
   */
  readonly waitUntil: number | undefined;
}

const CLOSED: ProgressSendGate = { open: false, waitUntil: undefined };
const OPEN: ProgressSendGate = { open: true, waitUntil: undefined };

/**
 * Whether `cursor` is worth considering for `passageId` at `nowMs`.
 *
 * Closed when there is no race, the snippet on screen is a different
 * passage, the cursor is not a non-negative integer, or the cursor is past
 * the snippet. Closed until `startsAt` when the race is still counting down,
 * and `waitUntil` is that instant.
 */
export function progressSendGate(
  race: ProgressRace | undefined,
  passageId: string,
  cursor: number,
  nowMs: number,
): ProgressSendGate {
  if (race === undefined || race.passageId !== passageId) {
    return CLOSED;
  }
  if (!Number.isSafeInteger(race.length) || race.length < 0) {
    return CLOSED;
  }
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > race.length) {
    return CLOSED;
  }
  if (!Number.isFinite(nowMs) || !Number.isFinite(race.startsAt)) {
    return CLOSED;
  }
  if (nowMs < race.startsAt) {
    return { open: false, waitUntil: race.startsAt };
  }
  return OPEN;
}

export interface ProgressReporter {
  /** Last position handed to the socket. Unset until the first report. */
  readonly sent: number | undefined;
  /** Newest cursor waiting out the interval. */
  readonly held: number | undefined;
  /** Clock reading when `sent` was handed off. */
  readonly sentAt: number | undefined;
}

/** A reporter that has not sent anything. A new race starts from here. */
export function createProgressReporter(): ProgressReporter {
  return { sent: undefined, held: undefined, sentAt: undefined };
}

export interface ProgressReport {
  readonly reporter: ProgressReporter;
  /** Send this now. Absent when the cursor should not produce a frame. */
  readonly message: ReportProgressMessage | undefined;
  /**
   * Clock reading when a held cursor should be flushed. Absent when nothing
   * is waiting.
   */
  readonly flushAt: number | undefined;
}

/**
 * Note the local cursor at `now`.
 *
 * A cursor that is not a non-negative integer, or a clock reading that is
 * not finite, leaves the reporter unchanged. So does a cursor that is not
 * ahead of the last sent position. The starting cursor, 0, is not sent:
 * everyone begins there. Moving back to or behind the last sent position
 * drops a held cursor. The same reporter object is returned when nothing
 * changed.
 */
export function observeProgressCursor(
  reporter: ProgressReporter,
  cursor: number,
  now: number,
  intervalMs: number = PROGRESS_REPORT_INTERVAL_MS,
): ProgressReport {
  if (!Number.isSafeInteger(cursor) || cursor < 0 || !Number.isFinite(now)) {
    return idle(reporter);
  }
  const interval = validInterval(intervalMs);

  const sent = reporter.sent;
  if (sent !== undefined && cursor <= sent) {
    if (reporter.held === undefined) {
      return idle(reporter);
    }
    return {
      reporter: { sent, held: undefined, sentAt: reporter.sentAt },
      message: undefined,
      flushAt: undefined,
    };
  }

  if (sent === undefined && cursor === 0) {
    return idle(reporter);
  }

  const sentAt = reporter.sentAt;
  if (sentAt === undefined || now >= sentAt + interval) {
    return {
      reporter: { sent: cursor, held: undefined, sentAt: now },
      message: { type: "progress", position: cursor },
      flushAt: undefined,
    };
  }

  if (reporter.held === cursor) {
    return { reporter, message: undefined, flushAt: sentAt + interval };
  }

  return {
    reporter: { sent, held: cursor, sentAt },
    message: undefined,
    flushAt: sentAt + interval,
  };
}

/**
 * Send a held cursor once `now` has reached the interval.
 *
 * Returns the same reporter when nothing is held, the clock is not finite,
 * or the interval has not elapsed. The flush time stays on the result in
 * that last case so the caller can wait the remainder.
 */
export function flushProgressReport(
  reporter: ProgressReporter,
  now: number,
  intervalMs: number = PROGRESS_REPORT_INTERVAL_MS,
): ProgressReport {
  const held = reporter.held;
  if (held === undefined || !Number.isFinite(now)) {
    return idle(reporter);
  }
  const interval = validInterval(intervalMs);
  const sentAt = reporter.sentAt;
  if (sentAt !== undefined && now < sentAt + interval) {
    return { reporter, message: undefined, flushAt: sentAt + interval };
  }
  return {
    reporter: { sent: held, held: undefined, sentAt: now },
    message: { type: "progress", position: held },
    flushAt: undefined,
  };
}

function idle(reporter: ProgressReporter): ProgressReport {
  return { reporter, message: undefined, flushAt: undefined };
}

function validInterval(intervalMs: number): number {
  if (!Number.isFinite(intervalMs) || intervalMs < 0) {
    return PROGRESS_REPORT_INTERVAL_MS;
  }
  return intervalMs;
}
