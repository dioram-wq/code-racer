import {
  backspace,
  getSnippet,
  typeCharacter,
  type Snippet,
  type TypingState,
} from "@code-racer/shared";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { raceCharacters } from "./race-characters.js";
import {
  advancePassage,
  formatPassageResult,
  isNextSnippetKey,
  openPassage,
} from "./race-passage.js";
import {
  advanceRaceTiming,
  isRaceClockRunning,
  liveRaceStats,
  systemRaceClock,
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

const openingSnippet = loadSnippet();

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
  const [session, setSession] = useState(() => openPassage(openingSnippet));
  const running = isRaceClockRunning(session.timing);
  const stats = liveRaceStats(session.timing, session.typing, session.now);
  const snippet = session.snippet;

  useEffect(() => {
    screenRef.current?.focus();
  }, [snippet.id]);

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

  function goToNextSnippet() {
    setSession((current) => (current.typing.finished ? advancePassage(current) : current));
  }

  function keepScreenFocus(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey) {
      return;
    }
    if (session.typing.finished && isNextSnippetKey(event.key)) {
      event.preventDefault();
      goToNextSnippet();
      return;
    }
    if (!isTypingKey(event.key)) {
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
        ...current,
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
      <pre key={snippet.id} className="passage" aria-label={snippet.title}>
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
      <p className={stats.finished ? "hint result" : "hint"} aria-live="polite">
        {formatPassageResult(stats.resultLabel)}
      </p>
      {stats.finished ? (
        <p className="next-row">
          <button
            type="button"
            className="next"
            onMouseDown={keepScreenFocus}
            onClick={goToNextSnippet}
            aria-keyshortcuts="Enter Tab"
          >
            next snippet
          </button>
          <span className="hint">enter or tab</span>
        </p>
      ) : null}
    </main>
  );
}
