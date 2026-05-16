"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";

type Player = {
  id: string;
  name: string;
};

type Move = {
  id: string;
  playerName: string;
  place: string;
  kind: "saved" | "skipped";
};

type GameState = {
  phase: "setup" | "playing";
  players: Player[];
  currentPlayerIndex: number;
  requiredLetter: string;
  usedPlaceKeys: string[];
  moves: Move[];
  statusMessage: string;
};

interface SpeechRecognitionAlternative {
  transcript: string;
}

interface SpeechRecognitionResult {
  0: SpeechRecognitionAlternative;
  isFinal: boolean;
}

interface SpeechRecognitionResultList {
  length: number;
  [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList;
}

interface SpeechRecognitionErrorEvent extends Event {
  error: string;
}

interface BrowserSpeechRecognition extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  maxAlternatives: number;
  onend: (() => void) | null;
  onerror: ((event: SpeechRecognitionErrorEvent) => void) | null;
  onresult: ((event: SpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

declare global {
  interface Window {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const primaryButton =
  "inline-flex items-center justify-center rounded-full bg-fuchsia-600 px-5 py-3 text-sm font-bold text-white shadow-lg shadow-fuchsia-300/50 transition hover:bg-fuchsia-500 disabled:cursor-not-allowed disabled:bg-fuchsia-300";

const secondaryButton =
  "inline-flex items-center justify-center rounded-full border border-white/60 bg-white/80 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white disabled:cursor-not-allowed disabled:text-slate-300";

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizePlaceName(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function createPlaceKey(value: string): string {
  return normalizePlaceName(value).replace(/[^a-z]/g, "");
}

function getLastLetter(value: string): string {
  const lettersOnly = normalizePlaceName(value).replace(/[^a-z]/g, "");
  return lettersOnly.at(-1) ?? "";
}

function createSetupState(statusMessage = "Tap About for the rules, then add the players."): GameState {
  return {
    phase: "setup",
    players: [],
    currentPlayerIndex: 0,
    requiredLetter: "a",
    usedPlaceKeys: [],
    moves: [],
    statusMessage,
  };
}

function createNewGame(names: string[]): GameState {
  const players = names.map((name) => ({
    id: makeId(),
    name,
  }));

  return {
    phase: "playing",
    players,
    currentPlayerIndex: 0,
    requiredLetter: "a",
    usedPlaceKeys: [],
    moves: [],
    statusMessage: `Atlas! ${players[0].name} starts with A.`,
  };
}

function getNextPlayerIndex(players: Player[], currentIndex: number): number {
  return (currentIndex + 1) % players.length;
}

export function AtlasGame() {
  const [playerNames, setPlayerNames] = useState(["Aarav", "Mia"]);
  const [game, setGame] = useState<GameState>(createSetupState);
  const [draftPlace, setDraftPlace] = useState("");
  const [speechMessage, setSpeechMessage] = useState(
    "Tap Listen, say the place name, then save it.",
  );
  const [speechMessageTone, setSpeechMessageTone] = useState<"neutral" | "error" | "success">(
    "neutral",
  );
  const [isListening, setIsListening] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);

  const speechSupported =
    typeof window !== "undefined" &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));

  const currentPlayer =
    game.phase === "playing" ? game.players[game.currentPlayerIndex] : null;

  const calledPlaces = useMemo(
    () =>
      [...game.moves]
        .reverse()
        .filter((move) => move.kind === "saved")
        .map((move) => move.place),
    [game.moves],
  );

  useEffect(() => {
    return () => {
      recognitionRef.current?.abort();
    };
  }, []);

  function updateSpeechMessage(
    message: string,
    tone: "neutral" | "error" | "success" = "neutral",
  ) {
    setSpeechMessage(message);
    setSpeechMessageTone(tone);
  }

  function updatePlayerName(index: number, value: string) {
    setPlayerNames((current) =>
      current.map((name, currentIndex) => (currentIndex === index ? value : name)),
    );
  }

  function addPlayerField() {
    setPlayerNames((current) => [...current, `Kid ${current.length + 1}`]);
  }

  function removePlayerField(index: number) {
    setPlayerNames((current) => current.filter((_, currentIndex) => currentIndex !== index));
  }

  function stopListening() {
    recognitionRef.current?.stop();
    setIsListening(false);
  }

  function startListening() {
    if (!speechSupported) {
      updateSpeechMessage(
        "Speech input is not available here, so type the place name instead.",
      );
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      updateSpeechMessage(
        "Speech input is not available here, so type the place name instead.",
      );
      return;
    }

    recognitionRef.current?.abort();

    const recognition = new Recognition();
    recognition.continuous = false;
    recognition.interimResults = true;
    recognition.lang = "en-US";
    recognition.maxAlternatives = 1;

    recognition.onresult = (event) => {
      const transcript = Array.from({ length: event.results.length }, (_, index) => {
        return event.results[index][0]?.transcript ?? "";
      })
        .join(" ")
        .trim();

      setDraftPlace(transcript);
      updateSpeechMessage(
        transcript ? `I heard: "${transcript}"` : "I am still listening...",
      );
    };

    recognition.onerror = (event) => {
      updateSpeechMessage(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it or type the place name."
          : "I could not hear that clearly. Try again or type the place name.",
        "error",
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    setDraftPlace("");
    updateSpeechMessage("Listening...");
    setIsListening(true);
    recognition.start();
  }

  function startGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const names = playerNames.map((name) => name.trim()).filter(Boolean);

    if (names.length < 2) {
      setGame(createSetupState("Add at least two players before starting."));
      return;
    }

    setPlayerNames(names);
    setDraftPlace("");
    updateSpeechMessage("Tap Listen, say the place name, then save it.");
    setGame(createNewGame(names));
  }

  function saveTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (game.phase !== "playing" || !currentPlayer) {
      return;
    }

    const normalized = normalizePlaceName(draftPlace);
    const placeKey = createPlaceKey(draftPlace);

    if (!placeKey) {
      updateSpeechMessage("No place name is ready yet. Listen again or type it.", "error");
      return;
    }

    if (!placeKey.startsWith(game.requiredLetter)) {
      updateSpeechMessage(
        `This turn must start with ${game.requiredLetter.toUpperCase()}.`,
        "error",
      );
      return;
    }

    if (game.usedPlaceKeys.includes(placeKey)) {
      updateSpeechMessage(
        `"${draftPlace.trim()}" was already called out.`,
        "error",
      );
      return;
    }

    const nextLetter = getLastLetter(normalized);

    if (!nextLetter) {
      updateSpeechMessage(
        "I could not find the next letter. Try saying the place again.",
        "error",
      );
      return;
    }

    const nextPlayerIndex = getNextPlayerIndex(game.players, game.currentPlayerIndex);
    const placeLabel = draftPlace.trim();

    setGame({
      ...game,
      currentPlayerIndex: nextPlayerIndex,
      requiredLetter: nextLetter,
      usedPlaceKeys: [...game.usedPlaceKeys, placeKey],
      moves: [
        ...game.moves,
        {
          id: makeId(),
          playerName: currentPlayer.name,
          place: placeLabel,
          kind: "saved",
        },
      ],
      statusMessage: `${placeLabel} saved. ${game.players[nextPlayerIndex].name} now plays ${nextLetter.toUpperCase()}.`,
    });
    setDraftPlace("");
    updateSpeechMessage(`Saved "${placeLabel}".`, "success");
  }

  function skipTurn() {
    if (game.phase !== "playing" || !currentPlayer) {
      return;
    }

    const nextPlayerIndex = getNextPlayerIndex(game.players, game.currentPlayerIndex);

    setGame({
      ...game,
      currentPlayerIndex: nextPlayerIndex,
      moves: [
        ...game.moves,
        {
          id: makeId(),
          playerName: currentPlayer.name,
          place: "Skipped",
          kind: "skipped",
        },
      ],
      statusMessage: `${currentPlayer.name} skipped. ${game.players[nextPlayerIndex].name} still needs ${game.requiredLetter.toUpperCase()}.`,
    });
    setDraftPlace("");
    updateSpeechMessage("Turn skipped.");
  }

  function returnToSetup() {
    stopListening();
    setDraftPlace("");
    updateSpeechMessage("Tap Listen, say the place name, then save it.");
    setGame(createSetupState());
  }

  return (
    <>
      <main className="min-h-screen bg-[radial-gradient(circle_at_top,_#fde68a,_#f5d0fe_42%,_#bfdbfe_78%,_#ffffff)] px-4 py-5 sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
          <header className="flex items-center justify-between rounded-[2rem] bg-white/75 px-5 py-4 shadow-lg shadow-violet-200/50 backdrop-blur sm:px-6">
            <div>
              <p className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Atlas
              </p>
              <p className="text-sm font-medium text-slate-500">
                A colourful place-name game for kids
              </p>
            </div>

            <button
              aria-label="About Atlas"
              className="flex h-12 w-12 items-center justify-center rounded-full bg-violet-600 text-xl font-black text-white shadow-lg shadow-violet-300/60 transition hover:bg-violet-500"
              onClick={() => setIsAboutOpen(true)}
              type="button"
            >
              ?
            </button>
          </header>

          {game.phase === "setup" ? (
            <section className="rounded-[2rem] bg-white/80 p-5 shadow-xl shadow-fuchsia-200/50 backdrop-blur sm:p-6">
              <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h1 className="text-2xl font-black text-slate-900 sm:text-3xl">
                    Setup players
                  </h1>
                  <p className="mt-1 text-sm text-slate-600">{game.statusMessage}</p>
                </div>

                <button className={secondaryButton} onClick={addPlayerField} type="button">
                  Add player
                </button>
              </div>

              <form className="mt-5 space-y-4" onSubmit={startGame}>
                {playerNames.map((name, index) => (
                  <div
                    className="flex items-center gap-3 rounded-[1.5rem] bg-gradient-to-r from-amber-100 via-pink-100 to-cyan-100 p-3"
                    key={`${index}-${name}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-sm font-black text-violet-600 shadow">
                      {index + 1}
                    </span>
                    <input
                      className="w-full rounded-full border border-white bg-white px-4 py-3 text-sm font-medium text-slate-900 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                      onChange={(event) => updatePlayerName(index, event.target.value)}
                      placeholder={`Player ${index + 1}`}
                      value={name}
                    />
                    <button
                      className={secondaryButton}
                      disabled={playerNames.length <= 2}
                      onClick={() => removePlayerField(index)}
                      type="button"
                    >
                      Remove
                    </button>
                  </div>
                ))}

                <div className="pt-2">
                  <button className={`${primaryButton} w-full sm:w-auto`} type="submit">
                    Start game
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <section className="grid gap-5">
              <div className="flex flex-wrap items-center gap-3 rounded-[2rem] bg-white/75 p-4 shadow-lg shadow-cyan-200/50 backdrop-blur">
                <div className="rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 px-5 py-3 text-center shadow">
                  <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-700">
                    Letter
                  </p>
                  <p className="text-3xl font-black uppercase text-slate-900">
                    {game.requiredLetter}
                  </p>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                    Current player
                  </p>
                  <p className="mt-1 text-2xl font-black text-slate-900">
                    {currentPlayer?.name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{game.statusMessage}</p>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                {game.players.map((player, index) => (
                  <span
                    className={`rounded-full px-4 py-2 text-sm font-bold shadow-sm ${
                      index === game.currentPlayerIndex
                        ? "bg-fuchsia-600 text-white"
                        : "bg-white/80 text-slate-700"
                    }`}
                    key={player.id}
                  >
                    {player.name}
                  </span>
                ))}
              </div>

              <article className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-2xl font-black text-slate-900">Listen</h2>
                    <p className="mt-1 text-sm text-slate-600">
                      Say the place, check the text, then save it.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      className={secondaryButton}
                      onClick={isListening ? stopListening : startListening}
                      type="button"
                    >
                      {isListening ? "Stop" : "Listen"}
                    </button>
                    <button className={secondaryButton} onClick={skipTurn} type="button">
                      Skip
                    </button>
                    <button className={secondaryButton} onClick={returnToSetup} type="button">
                      Reset & players
                    </button>
                  </div>
                </div>

                <form className="mt-5 space-y-4" onSubmit={saveTurn}>
                  <input
                    autoCapitalize="words"
                    autoComplete="off"
                    className="w-full rounded-[1.5rem] border border-white bg-white px-5 py-4 text-lg font-semibold text-slate-900 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                    onChange={(event) => setDraftPlace(event.target.value)}
                    placeholder={`This turn needs ${game.requiredLetter.toUpperCase()}...`}
                    value={draftPlace}
                  />

                  <div
                    className={`rounded-[1.5rem] border p-4 text-sm font-medium ${
                      speechMessageTone === "error"
                        ? "border-rose-200 bg-rose-50 text-rose-700"
                        : speechMessageTone === "success"
                          ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                          : "border-sky-200 bg-sky-50 text-sky-700"
                    }`}
                  >
                    {speechMessage}
                  </div>

                  <button className={`${primaryButton} w-full sm:w-auto`} type="submit">
                    Save place
                  </button>
                </form>
              </article>

              <article className="rounded-[2rem] bg-white/80 p-5 shadow-xl shadow-amber-200/50 backdrop-blur sm:p-6">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-2xl font-black text-slate-900">Past places</h2>
                  <span className="rounded-full bg-gradient-to-r from-cyan-200 to-violet-200 px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] text-slate-700">
                    {calledPlaces.length}
                  </span>
                </div>

                <div className="mt-4">
                  {calledPlaces.length > 0 ? (
                    <div className="flex flex-wrap gap-3">
                      {calledPlaces.map((place, index) => (
                        <span
                          className="rounded-full bg-gradient-to-r from-pink-200 via-amber-100 to-cyan-200 px-4 py-2 text-sm font-bold text-slate-800 shadow-sm"
                          key={`${place}-${index}`}
                        >
                          {place}
                        </span>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-slate-500">
                      No place names have been saved yet.
                    </p>
                  )}
                </div>
              </article>
            </section>
          )}
        </div>
      </main>

      {isAboutOpen ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] bg-white p-6 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-2xl font-black text-slate-900">About Atlas</h2>
                <p className="mt-1 text-sm text-slate-600">
                  Quick rules for the game.
                </p>
              </div>

              <button
                aria-label="Close about"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-lg font-black text-slate-700"
                onClick={() => setIsAboutOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>

            <div className="mt-5 space-y-3 text-sm leading-6 text-slate-700">
              <p>1. Say <strong>Atlas</strong> and let the first player start with <strong>A</strong>.</p>
              <p>2. Each new place must start with the last letter of the previous place.</p>
              <p>3. If the same place was already saved before, the app will show an error.</p>
              <p>4. Tap <strong>Listen</strong> to capture the spoken place, then save it.</p>
              <p>5. If speech is not available, just type the place name instead.</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
