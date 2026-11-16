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
  advanceLanguagePassage,
  changeLanguagePassage,
  RACE_LANGUAGES,
  type LanguagePassage,
  type RaceLanguage,
} from "./race-language.js";
import { formatPassageResult, isNextSnippetKey, openPassage } from "./race-passage.js";
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

function keepScreenFocus(event: MouseEvent<HTMLButtonElement>) {
  event.preventDefault();
}

function LanguageChoices({
  language,
  onChoose,
}: {
  language: RaceLanguage;
  onChoose: (language: RaceLanguage) => void;
}) {
  return (
    <div className="lang-row" role="radiogroup" aria-labelledby="snippet-language-label">
      <span className="lang-label" id="snippet-language-label">
        lang
      </span>
      {RACE_LANGUAGES.map((choice) => (
        <button
          key={choice}
          type="button"
          role="radio"
          aria-checked={choice === language}
          className="lang-choice"
          onMouseDown={keepScreenFocus}
          onClick={() => {
            onChoose(choice);
          }}
        >
          {choice}
        </button>
      ))}
    </div>
  );
}

export function App() {
  const screenRef = useRef<HTMLElement>(null);
  const [race, setRace] = useState<LanguagePassage>(() => ({
    language: "typescript",
    session: openPassage(openingSnippet),
  }));
  const { session } = race;
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
      setRace((current) => {
        if (!isRaceClockRunning(current.session.timing)) {
          return current;
        }
        const stamp = Math.max(current.session.now, systemRaceClock.now());
        if (stamp === current.session.now) {
          return current;
        }
        return { ...current, session: { ...current.session, now: stamp } };
      });
    }, RACE_CLOCK_TICK_MS);
    return () => {
      window.clearInterval(id);
    };
  }, [running]);

  function goToNextSnippet() {
    setRace((current) =>
      current.session.typing.finished ? advanceLanguagePassage(current) : current,
    );
  }

  function chooseLanguage(language: RaceLanguage) {
    setRace((current) => changeLanguagePassage(current, language));
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("button") !== null) {
      return;
    }
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
    setRace((current) => {
      const typing = applyTypingKey(current.session.typing, key);
      if (typing === current.session.typing) {
        return current;
      }
      const stamp = Math.max(current.session.now, systemRaceClock.now());
      return {
        ...current,
        session: {
          ...current.session,
          typing,
          timing: advanceRaceTiming(current.session.timing, typing, { now: () => stamp }),
          now: stamp,
        },
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
      <LanguageChoices language={race.language} onChoose={chooseLanguage} />
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
      <pre
        key={snippet.id}
        className="passage"
        aria-label={`${snippet.language} · ${snippet.title}`}
      >
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
