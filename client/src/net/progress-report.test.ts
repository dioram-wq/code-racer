import { describe, expect, it } from "vitest";
import {
  createProgressReporter,
  flushProgressReport,
  observeProgressCursor,
  PROGRESS_REPORT_INTERVAL_MS,
  progressSendGate,
  type ProgressRace,
} from "./progress-report.js";

const race: ProgressRace = { passageId: "tiny", length: 4, startsAt: 1_000 };

describe("progressSendGate", () => {
  it("stays closed until the passage on screen is this race and the countdown has ended", () => {
    expect(progressSendGate(undefined, "tiny", 1, 1_000)).toEqual({
      open: false,
      waitUntil: undefined,
    });
    expect(progressSendGate(race, "other", 1, 1_000)).toEqual({
      open: false,
      waitUntil: undefined,
    });
    expect(progressSendGate(race, "tiny", 1, 999)).toEqual({ open: false, waitUntil: 1_000 });
    expect(progressSendGate(race, "tiny", 1, 1_000)).toEqual({ open: true, waitUntil: undefined });
  });

  it("stays closed for a cursor the server would reject", () => {
    expect(progressSendGate(race, "tiny", -1, 1_000).open).toBe(false);
    expect(progressSendGate(race, "tiny", 1.5, 1_000).open).toBe(false);
    expect(progressSendGate(race, "tiny", 5, 1_000).open).toBe(false);
    expect(progressSendGate(race, "tiny", 1, Number.NaN).open).toBe(false);
    expect(progressSendGate(race, "tiny", 4, 1_000).open).toBe(true);
  });
});

describe("observeProgressCursor", () => {
  it("does not send the starting cursor", () => {
    const reporter = createProgressReporter();
    const step = observeProgressCursor(reporter, 0, 0);

    expect(step.reporter).toBe(reporter);
    expect(step.message).toBeUndefined();
    expect(step.flushAt).toBeUndefined();
  });

  it("sends the first cursor ahead of the start immediately", () => {
    const step = observeProgressCursor(createProgressReporter(), 1, 40);

    expect(step.message).toEqual({ type: "progress", position: 1 });
    expect(step.flushAt).toBeUndefined();
    expect(step.reporter).toEqual({ sent: 1, held: undefined, sentAt: 40 });
  });

  it("holds a burst and keeps the newest cursor for the end of the interval", () => {
    const first = observeProgressCursor(createProgressReporter(), 1, 0);
    const held = observeProgressCursor(first.reporter, 2, 10);
    const newer = observeProgressCursor(held.reporter, 4, 30);
    const same = observeProgressCursor(newer.reporter, 4, 50);

    expect(held.message).toBeUndefined();
    expect(held.flushAt).toBe(PROGRESS_REPORT_INTERVAL_MS);
    expect(newer.message).toBeUndefined();
    expect(newer.reporter.held).toBe(4);
    expect(same.reporter).toBe(newer.reporter);
    expect(same.flushAt).toBe(PROGRESS_REPORT_INTERVAL_MS);

    const flushed = flushProgressReport(same.reporter, PROGRESS_REPORT_INTERVAL_MS);

    expect(flushed.message).toEqual({ type: "progress", position: 4 });
    expect(flushed.flushAt).toBeUndefined();
    expect(flushed.reporter).toEqual({
      sent: 4,
      held: undefined,
      sentAt: PROGRESS_REPORT_INTERVAL_MS,
    });
  });

  it("does not flush before the interval has elapsed", () => {
    const sent = observeProgressCursor(createProgressReporter(), 1, 0);
    const held = observeProgressCursor(sent.reporter, 3, 10);
    const early = flushProgressReport(held.reporter, PROGRESS_REPORT_INTERVAL_MS - 1);

    expect(early.reporter).toBe(held.reporter);
    expect(early.message).toBeUndefined();
    expect(early.flushAt).toBe(PROGRESS_REPORT_INTERVAL_MS);
  });

  it("sends a later cursor immediately once the interval has elapsed", () => {
    const sent = observeProgressCursor(createProgressReporter(), 1, 0);
    const again = observeProgressCursor(sent.reporter, 2, PROGRESS_REPORT_INTERVAL_MS);

    expect(again.message).toEqual({ type: "progress", position: 2 });
    expect(again.reporter.held).toBeUndefined();
  });

  it("does not send a cursor that repeats or moves backward, and drops a held one", () => {
    const sent = observeProgressCursor(createProgressReporter(), 2, 0);
    const repeat = observeProgressCursor(sent.reporter, 2, 10);
    const held = observeProgressCursor(sent.reporter, 5, 10);
    const backspaced = observeProgressCursor(held.reporter, 2, 20);
    const behind = observeProgressCursor(backspaced.reporter, 1, 30);

    expect(repeat.reporter).toBe(sent.reporter);
    expect(repeat.message).toBeUndefined();
    expect(backspaced.message).toBeUndefined();
    expect(backspaced.flushAt).toBeUndefined();
    expect(backspaced.reporter.held).toBeUndefined();
    expect(backspaced.reporter.sent).toBe(2);
    expect(behind.reporter).toBe(backspaced.reporter);

    const forward = observeProgressCursor(backspaced.reporter, 3, 30);

    expect(forward.message).toBeUndefined();
    expect(forward.reporter.held).toBe(3);
    expect(forward.flushAt).toBe(PROGRESS_REPORT_INTERVAL_MS);
  });

  it("sends the finish immediately when the caller uses a zero interval", () => {
    const sent = observeProgressCursor(createProgressReporter(), 1, 0);
    const held = observeProgressCursor(sent.reporter, 2, 10);
    const finish = observeProgressCursor(held.reporter, 4, 20, 0);

    expect(finish.message).toEqual({ type: "progress", position: 4 });
    expect(finish.flushAt).toBeUndefined();
    expect(finish.reporter.held).toBeUndefined();
  });

  it("ignores a cursor or a clock it cannot place on the timeline", () => {
    const reporter = createProgressReporter();

    expect(observeProgressCursor(reporter, 1.5, 0).reporter).toBe(reporter);
    expect(observeProgressCursor(reporter, -1, 0).reporter).toBe(reporter);
    expect(observeProgressCursor(reporter, 1, Number.NaN).reporter).toBe(reporter);
    expect(flushProgressReport(reporter, Number.POSITIVE_INFINITY).reporter).toBe(reporter);
  });

  it("uses the default interval when the supplied one is not a duration", () => {
    const sent = observeProgressCursor(createProgressReporter(), 1, 0);
    const held = observeProgressCursor(sent.reporter, 2, 40, Number.NaN);

    expect(held.message).toBeUndefined();
    expect(held.flushAt).toBe(PROGRESS_REPORT_INTERVAL_MS);
  });
});
