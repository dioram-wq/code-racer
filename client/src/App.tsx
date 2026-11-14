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

function loadSnippet(): Snippet {
  const found = getSnippet("ts-clamp");
  if (found === undefined) {
    throw new Error("missing snippet: ts-clamp");
  }
  return found;
}

const snippet = loadSnippet();

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
  const [state, setState] = useState(() => createTypingState(snippet.code));

  useEffect(() => {
    screenRef.current?.focus();
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.metaKey || event.ctrlKey || event.altKey || !isTypingKey(event.key)) {
      return;
    }
    event.preventDefault();
    const key = event.key;
    setState((current) => applyTypingKey(current, key));
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
      <pre className="passage" aria-label={snippet.title}>
        {raceCharacters(state).map((character) =>
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
      <p className="hint" aria-live="polite">
        {state.finished ? "passage complete" : "type the snippet"}
      </p>
    </main>
  );
}
