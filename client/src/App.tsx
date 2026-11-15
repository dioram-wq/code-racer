import {
  backspace,
  createTypingState,
  getSnippet,
  typeCharacter,
  type Snippet,
  type TypingState,
} from "@code-racer/shared";
import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { raceCharacters } from "./race-characters.js";
import {
  advanceRaceTiming,
  createRaceTiming,
  isRaceClockRunning,
  liveRaceStats,
  systemRaceClock,
  type RaceTiming,
} from "./race-stats.js";

/** Labels are tenths of a second, so the screen samples the clock at that rate. */
const RACE_CLOCK_TICK_MS = 100;

function loadSnippet(): Snippet {
  const found = getSnippet("ts-clamp");
  if (found === undefined) {
    throw new Error("missing snippet: ts-clamp");
  }
  return found;
}

const snippet = loadSnippet();

interface RaceSession {
  readonly typing: TypingState;
  readonly timing: RaceTiming;
  readonly now: number;
}

function createSession(code: string): RaceSession {
  return {
    typing: createTypingState(code),
    timing: createRaceTiming(),
    now: 0,
  };
}

function isTypingKey(key: string): boolean {
  return key === "Backspace" || key === "Enter" || key === "Tab" || key.length === 1;
}

function applyTypingKey(state: TypingState, key: string): TypingState {
  if (key === "Backspace") {
    return backspace(state);
  }
  if (key === "Enter") {
    return typeCharacter(state, "\n");
  }
  if (key === "Tab") {
    return typeCharacter(state, "\t");
  }
  return typeCharacter(state, key);
}

export function App() {
  const screenRef = useRef<HTMLElement>(null);
  const [session, setSession] = useState(() => createSession(snippet.code));
  const running = isRaceClockRunning(session.timing);
  const stats = liveRaceStats(session.timing, session.typing, session.now);

  useEffect(() => {
    screenRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!running) {
      return;
    }
    const id = window.setInterval(() => {
      setSession((current) => {
        if (!isRaceClockRunning(current.timing)) {
          return current;
        }
        const stamp = Math.max(current.now, systemRaceClock.now());
        if (stamp === current.now) {
          return current;
        }
        return { ...current, now: stamp };
      });
    }, RACE_CLOCK_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [running]);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || !isTypingKey(event.key)) {
      return;
    }
    event.preventDefault();
    const key = event.key;
    setSession((current) => {
      const typing = applyTypingKey(current.typing, key);
      if (typing === current.typing) {
        return current;
      }
      const stamp = Math.max(current.now, systemRaceClock.now());
      return {
        typing,
        timing: advanceRaceTiming(current.timing, typing, { now: () => stamp }),
        now: stamp,
      };
    });
  }

  return (
    <main
      ref={screenRef}
      className="screen"
      tabIndex={0}
      aria-label="Single player race"
      onKeyDown={onKeyDown}
    >
      <p className="command">
        <span className="prompt">guest@code-racer:~$</span> type {snippet.id}
      </p>
      <p className="meta">
        <span className="lang">{snippet.language}</span>
        {" · "}
        {snippet.title}
      </p>
      <p className="stats">
        <span className="stat-label">time</span>{" "}
        <span className="stat-value">{stats.elapsedLabel}</span>
        {" · "}
        <span className="stat-label">wpm</span>{" "}
        <span className="stat-value">{stats.wpmLabel}</span>
        {" · "}
        <span className="stat-label">accuracy</span>{" "}
        <span className="stat-value">{stats.accuracyLabel}</span>
      </p>
      <pre className="passage" aria-label={snippet.title}>
        {raceCharacters(session.typing).map((character) =>
          character.value === "\n" ? (
            <span key={character.index} className={character.className}>
              {character.className === "char-cursor" ? " " : ""}
              {"\n"}
            </span>
          ) : (
            <span key={character.index} className={character.className}>
              {character.value}
            </span>
          ),
        )}
      </pre>
      <p className={stats.resultLabel === null ? "hint" : "hint result"} aria-live="polite">
        {stats.resultLabel === null ? "type the snippet" : `passage complete · ${stats.resultLabel}`}
      </p>
    </main>
  );
}
