import {
  backspace,
  getSnippet,
  typeCharacter,
  type Snippet,
  type TypingState,
} from "@code-racer/shared";
import { useEffect, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import {
  joinRoomFailure,
  newPlayerId,
  roomJoinBlocker,
  roomJoinMode,
  roomSocketUrl,
} from "./net/room-session.js";
import { useRoomConnection, type RoomJoinRequest } from "./net/use-room-connection.js";
import { useRaceProgress } from "./net/use-race-progress.js";
import { raceCharacters } from "./race-characters.js";
import { adoptRacePassage, racePassageIsOnScreen } from "./race-room.js";
import { RaceResults } from "./race-results.js";
import { RaceStandings } from "./race-standings.js";
import { RoomJoin } from "./room-join.js";
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
  disabled,
  onChoose,
}: {
  language: RaceLanguage;
  disabled: boolean;
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
          disabled={disabled}
          title={disabled ? "The race snippet stays on screen" : undefined}
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
  const [draftName, setDraftName] = useState("guest");
  const [draftRoom, setDraftRoom] = useState("");
  const [localError, setLocalError] = useState<string | undefined>(undefined);
  const [request, setRequest] = useState<RoomJoinRequest | undefined>(undefined);
  const connection = useRoomConnection(request);
  const { session } = race;
  const progress = useRaceProgress({
    link: connection.link,
    cursor: session.typing.cursor,
    passageId: session.snippet.id,
  });
  const { others, room } = progress;
  const joined = connection.phase === "joined";
  const passageLocked = racePassageIsOnScreen(race, room.snippet, joined);
  const adoptedStartsAt = useRef<number | undefined>(undefined);
  const running = isRaceClockRunning(session.timing);
  const stats = liveRaceStats(session.timing, session.typing, session.now);
  const snippet = session.snippet;

  useEffect(() => {
    screenRef.current?.focus();
  }, [snippet.id]);

  useEffect(() => {
    if (connection.phase === "joined") {
      screenRef.current?.focus();
    }
  }, [connection.phase]);

  const raceSnippet = room.snippet;
  const raceStartsAt = room.startsAt;
  useEffect(() => {
    if (!joined) {
      adoptedStartsAt.current = undefined;
      return;
    }
    if (raceSnippet === undefined || raceStartsAt === undefined) {
      return;
    }
    if (adoptedStartsAt.current === raceStartsAt) {
      return;
    }
    adoptedStartsAt.current = raceStartsAt;
    setRace((current) => adoptRacePassage(current, raceSnippet));
  }, [joined, raceSnippet, raceStartsAt]);

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
    setRace((current) =>
      racePassageIsOnScreen(current, room.snippet, joined)
        ? current
        : changeLanguagePassage(current, language),
    );
  }

  function joinRoom() {
    const failure = joinRoomFailure(draftName, draftRoom);
    if (failure !== undefined) {
      setLocalError(failure);
      return;
    }
    const selfId = newPlayerId();
    if (selfId === undefined) {
      setLocalError("Could not choose a player id");
      return;
    }
    setLocalError(undefined);
    setRequest({
      url: roomSocketUrl(window.location),
      roomId: draftRoom,
      name: draftName,
      selfId,
    });
  }

  function leaveRoom() {
    connection.leave();
    setRequest(undefined);
    setLocalError(undefined);
  }

  function startRace() {
    connection.start();
    screenRef.current?.focus();
  }

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (
      event.target instanceof HTMLElement &&
      event.target.closest("button, input, textarea") !== null
    ) {
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
      aria-label={joined ? "Multiplayer race" : "Single player race"}
      onKeyDown={onKeyDown}
    >
      <p className="command">
        <span className="prompt">
          {joined && connection.name !== undefined ? connection.name : "guest"}@
          {joined && connection.roomId !== undefined ? connection.roomId : "code-racer"}:~$
        </span>{" "}
        type {snippet.id}
      </p>
      <RoomJoin
        mode={roomJoinMode(
          connection.phase,
          request !== undefined,
          roomJoinBlocker(connection.phase, connection.error, connection.notice) !== undefined,
        )}
        roomId={connection.roomId}
        name={connection.name}
        pendingRoom={request?.roomId ?? draftRoom}
        error={localError ?? connection.error?.message ?? (joined ? undefined : connection.notice)}
        draftName={draftName}
        draftRoom={draftRoom}
        canStart={joined && room.snippet === undefined}
        onDraftName={(value) => {
          setDraftName(value);
          setLocalError(undefined);
        }}
        onDraftRoom={(value) => {
          setDraftRoom(value);
          setLocalError(undefined);
        }}
        onJoin={joinRoom}
        onStart={startRace}
        onLeave={leaveRoom}
      />
      <LanguageChoices language={race.language} disabled={passageLocked} onChoose={chooseLanguage} />
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
      <RaceStandings rows={others} />
      <RaceResults results={room.results} selfId={connection.selfId} />
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
