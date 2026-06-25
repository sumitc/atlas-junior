"use client";

import { SpeechRecognition } from "@capacitor-community/speech-recognition";
import { Capacitor } from "@capacitor/core";
import { Share } from "@capacitor/share";
import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  getLeaderboard,
  sendDebugNotification,
  submitPlaceRequest,
  submitScore,
  submitStats,
  type LeaderboardEntry,
  type DebugNotificationKind,
} from "@/lib/api";
import {
  applyPlaceDictionaryDelta,
  findSuggestion,
  getPlacesVersion,
  isKnownPlace,
  isRejectedBareWord,
  loadPlaces,
  refreshPlacesDelta,
} from "@/lib/places";
import { APP_VERSION } from "@/lib/version";

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

type DuplicateChallenge = {
  draftPlace: string;
  matchedPlace: string;
  exact: boolean;
};

type PlaceCheckState =
  | { status: "suggest"; suggestion: string }
  | { status: "unknown" };

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

const endGameButton =
  "inline-flex items-center justify-center rounded-full border border-slate-400 bg-slate-200 px-4 py-3 text-sm font-semibold text-slate-700 shadow-sm transition hover:bg-slate-300 disabled:cursor-not-allowed disabled:text-slate-300";

const PLAYER_NAMES_STORAGE_KEY = "atlas-player-names";
const GAME_SESSION_STORAGE_KEY = "atlas-game-session";
const DEFAULT_PLAYER_NAMES = ["Aarav", "Mia"];
const TURN_TIME_LIMIT_SECONDS = 180;

function formatTurnTimeStep(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}

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

function getNormalizedTokens(value: string): string[] {
  return normalizePlaceName(value)
    .split(" ")
    .map((token) => token.trim())
    .filter(Boolean);
}

function levenshteinDistance(first: string, second: string): number {
  if (first === second) {
    return 0;
  }

  if (first.length === 0) {
    return second.length;
  }

  if (second.length === 0) {
    return first.length;
  }

  const matrix = Array.from({ length: first.length + 1 }, () =>
    Array<number>(second.length + 1).fill(0),
  );

  for (let row = 0; row <= first.length; row += 1) {
    matrix[row][0] = row;
  }

  for (let column = 0; column <= second.length; column += 1) {
    matrix[0][column] = column;
  }

  for (let row = 1; row <= first.length; row += 1) {
    for (let column = 1; column <= second.length; column += 1) {
      const substitutionCost = first[row - 1] === second[column - 1] ? 0 : 1;

      matrix[row][column] = Math.min(
        matrix[row - 1][column] + 1,
        matrix[row][column - 1] + 1,
        matrix[row - 1][column - 1] + substitutionCost,
      );
    }
  }

  return matrix[first.length][second.length];
}

function areLikelySamePlace(first: string, second: string): boolean {
  const normalizedFirst = normalizePlaceName(first);
  const normalizedSecond = normalizePlaceName(second);

  if (!normalizedFirst || !normalizedSecond) {
    return false;
  }

  if (normalizedFirst === normalizedSecond) {
    return true;
  }

  const firstKey = createPlaceKey(first);
  const secondKey = createPlaceKey(second);

  if (!firstKey || !secondKey || firstKey[0] !== secondKey[0]) {
    return false;
  }

  const firstTokens = getNormalizedTokens(first);
  const secondTokens = getNormalizedTokens(second);

  if (firstTokens.length === secondTokens.length) {
    const tokenDistances = firstTokens.map((token, index) =>
      levenshteinDistance(token, secondTokens[index] ?? ""),
    );

    if (
      tokenDistances.every((distance, index) => {
        const longestTokenLength = Math.max(
          firstTokens[index]?.length ?? 0,
          secondTokens[index]?.length ?? 0,
        );

        const similarity = 1 - distance / longestTokenLength;

        return similarity >= 0.84;
      })
    ) {
      return true;
    }
  }

  const wholeDistance = levenshteinDistance(firstKey, secondKey);
  const longestLength = Math.max(firstKey.length, secondKey.length);
  const similarity = 1 - wholeDistance / longestLength;

  return similarity >= 0.84;
}

function findLikelyDuplicatePlace(
  draftPlaceValue: string,
  pastMoves: Move[],
): DuplicateChallenge | null {
  const normalizedDraft = normalizePlaceName(draftPlaceValue);

  for (const move of pastMoves) {
    if (move.kind !== "saved") {
      continue;
    }

    if (areLikelySamePlace(draftPlaceValue, move.place)) {
      return {
        draftPlace: draftPlaceValue.trim(),
        matchedPlace: move.place,
        exact: normalizePlaceName(move.place) === normalizedDraft,
      };
    }
  }

  return null;
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

function getInitialPlayerNames(): string[] {
  if (typeof window === "undefined") {
    return DEFAULT_PLAYER_NAMES;
  }

  const savedNames = window.localStorage.getItem(PLAYER_NAMES_STORAGE_KEY);

  if (!savedNames) {
    return DEFAULT_PLAYER_NAMES;
  }

  try {
    const parsedNames = JSON.parse(savedNames);

    if (
      Array.isArray(parsedNames) &&
      parsedNames.length >= 2 &&
      parsedNames.every((name) => typeof name === "string")
    ) {
      return parsedNames;
    }
  } catch {
    window.localStorage.removeItem(PLAYER_NAMES_STORAGE_KEY);
  }

  return DEFAULT_PLAYER_NAMES;
}

type PersistedGameSession = {
  game: GameState;
  draftPlace: string;
  turnSecondsRemaining: number;
};

function isPersistedGameSession(value: unknown): value is PersistedGameSession {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as Partial<PersistedGameSession> & { game?: Partial<GameState> };

  return (
    !!candidate.game &&
    (candidate.game.phase === "playing" || candidate.game.phase === "setup") &&
    Array.isArray(candidate.game.players) &&
    Array.isArray(candidate.game.moves) &&
    typeof candidate.draftPlace === "string" &&
    typeof candidate.turnSecondsRemaining === "number"
  );
}

function getInitialGameSession(): PersistedGameSession | null {
  if (typeof window === "undefined") {
    return null;
  }

  const raw = window.sessionStorage.getItem(GAME_SESSION_STORAGE_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (isPersistedGameSession(parsed) && parsed.game.phase === "playing") {
      return parsed;
    }
  } catch {
    window.sessionStorage.removeItem(GAME_SESSION_STORAGE_KEY);
  }

  return null;
}

const MEDALS = ["🥇", "🥈", "🥉"];

const DEBUG_NOTIFICATION_OPTIONS: Array<{ kind: DebugNotificationKind; label: string }> = [
  { kind: "leaderboard-top", label: "Leaderboard: you are #1" },
  { kind: "leaderboard-toppled", label: "Leaderboard: top score topped" },
  { kind: "pipeline-approved", label: "Pipeline: place approved" },
  { kind: "pipeline-rejected", label: "Pipeline: place rejected" },
  { kind: "support-updated", label: "Support: ticket updated" },
  { kind: "support-closed", label: "Support: ticket resolved" },
];

function TopThree({ entries, highlightId }: { entries: import("@/lib/api").LeaderboardEntry[]; highlightId?: string }) {
  const top = entries.slice(0, 3);
  return (
    <div className="space-y-1.5">
      <p className="text-xs font-bold uppercase tracking-widest text-slate-400">Top 3</p>
      {top.map((e, i) => (
        <div
          key={e.id}
          className={`flex items-center gap-3 rounded-2xl px-4 py-2.5 ${e.id === highlightId ? "bg-fuchsia-50 ring-2 ring-fuchsia-300" : "bg-slate-50"}`}
        >
          <span className="text-xl w-7 text-center">{MEDALS[i]}</span>
          <span className="flex-1 truncate text-sm font-semibold text-slate-800">{e.name}</span>
          <span className="text-sm font-mono font-bold text-slate-500">{e.score}</span>
        </div>
      ))}
    </div>
  );
}

export function AtlasGame() {
  const [playerNames, setPlayerNames] = useState(getInitialPlayerNames);
  const [game, setGame] = useState<GameState>(() => getInitialGameSession()?.game ?? createSetupState());
  const [draftPlace, setDraftPlace] = useState(() => getInitialGameSession()?.draftPlace ?? "");
  const [speechMessage, setSpeechMessage] = useState("");
  const [speechMessageTone, setSpeechMessageTone] = useState<"neutral" | "error" | "success">(
    "neutral",
  );
  const [savedFlash, setSavedFlash] = useState(false);
  const [flyingWord, setFlyingWord] = useState<string | null>(null);
  const [duplicateChallenge, setDuplicateChallenge] = useState<DuplicateChallenge | null>(null);
  const [placeCheck, setPlaceCheck] = useState<PlaceCheckState | null>(null);
  const [isListening, setIsListening] = useState(false);
  const [isAboutOpen, setIsAboutOpen] = useState(false);
  const [nativeSpeechAvailable, setNativeSpeechAvailable] = useState<boolean | null>(null);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showDebug, setShowDebug] = useState(process.env.NEXT_PUBLIC_DEBUG_PANEL === "true");
  const [debugNotificationKind, setDebugNotificationKind] = useState<DebugNotificationKind>(
    "leaderboard-top",
  );
  const [debugNotificationSending, setDebugNotificationSending] = useState(false);
  const [shareCopied, setShareCopied] = useState(false);
  const debugScrollRef = useRef<HTMLDivElement | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const placeInputRef = useRef<HTMLInputElement | null>(null);
  // Tracks the latest speech transcript so listeningState/onend handlers can auto-save
  const latestTranscriptRef = useRef("");
  const nativeSpeechAutoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nativeSpeechAutoSaveHandledRef = useRef(false);
  const NATIVE_SPEECH_AUTO_SAVE_DELAY_MS = 150;
  const isNativeApp = typeof window !== "undefined" && Capacitor.getPlatform() !== "web";
  const browserSpeechSupported =
    typeof window !== "undefined" &&
    (Boolean(window.SpeechRecognition) || Boolean(window.webkitSpeechRecognition));

  // End-game modal state
  const [showEndGame, setShowEndGame] = useState(false);
  const [endGameLoading, setEndGameLoading] = useState(false);
  const [endGameName, setEndGameName] = useState("");
  const [endGameSubmitting, setEndGameSubmitting] = useState(false);
  const [endGameSubmitError, setEndGameSubmitError] = useState(false);
  const [endGameQualifies, setEndGameQualifies] = useState(false);
  const [endGameLeaderboard, setEndGameLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [endGameResult, setEndGameResult] = useState<{ rank: number | null; entryId: string; onLeaderboard: boolean } | null>(null);
  const [turnSecondsRemaining, setTurnSecondsRemaining] = useState(
    () => getInitialGameSession()?.turnSecondsRemaining ?? TURN_TIME_LIMIT_SECONDS,
  );
  const [placeRequestState, setPlaceRequestState] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [placeRequestError, setPlaceRequestError] = useState<string | null>(null);
  const [placesReady, setPlacesReady] = useState(false);
  const statsSubmittedRef = useRef(false);
  const turnTimeoutHandledRef = useRef(false);
  const turnTimerIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  function clearTurnTimerInterval() {
    if (turnTimerIntervalRef.current) {
      clearInterval(turnTimerIntervalRef.current);
      turnTimerIntervalRef.current = null;
    }
  }

  function resetTurnTimer() {
    clearTurnTimerInterval();
    turnTimeoutHandledRef.current = false;
    setTurnSecondsRemaining(TURN_TIME_LIMIT_SECONDS);
  }

  function clearTurnDraftState() {
    setDraftPlace("");
    setDuplicateChallenge(null);
    setPlaceCheck(null);
    updateSpeechMessage("");
    setPlaceRequestState("idle");
    setPlaceRequestError(null);
    clearNativeSpeechAutoSaveTimer();
    nativeSpeechAutoSaveHandledRef.current = false;
    latestTranscriptRef.current = "";
  }

  const speechSupported = isNativeApp ? nativeSpeechAvailable !== false : browserSpeechSupported;

  const currentPlayer =
    game.phase === "playing" ? game.players[game.currentPlayerIndex] : null;
  const hasDraftPlace = draftPlace.trim().length > 0;
  const placeKeyOk = hasDraftPlace && createPlaceKey(draftPlace).startsWith(game.requiredLetter);
  const turnRemainingProgress = Math.max(
    0,
    Math.min(1, turnSecondsRemaining / TURN_TIME_LIMIT_SECONDS),
  );
  // Score counts only saved moves (skipped moves were removed)
  const savedTurns = game.moves.filter((m) => m.kind === "saved").length;
  const totalTurns = game.moves.length;

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
      clearNativeSpeechAutoSaveTimer();
      clearTurnTimerInterval();
      recognitionRef.current?.abort();
      if (isNativeApp) {
        void SpeechRecognition.stop();
        void SpeechRecognition.removeAllListeners();
      }
    };
  }, [isNativeApp]);

  useEffect(() => {
    if (!isNativeApp) {
      return;
    }

    void (async () => {
      try {
        const { available } = await SpeechRecognition.available();
        setNativeSpeechAvailable(available);
      } catch {
        setNativeSpeechAvailable(false);
      }
    })();
  }, [isNativeApp]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    window.localStorage.setItem(
      PLAYER_NAMES_STORAGE_KEY,
      JSON.stringify(playerNames),
    );
  }, [playerNames]);

  // Load places dictionary in background when component mounts
  useEffect(() => {
    let cancelled = false;

    void loadPlaces()
      .then(() => {
        if (!cancelled) {
          setPlacesReady(true);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setPlacesReady(false);
          updateSpeechMessage(
            error instanceof Error ? error.message : "Could not load the place dictionary.",
            "error",
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    if (game.phase !== "playing" || showEndGame) {
      window.sessionStorage.removeItem(GAME_SESSION_STORAGE_KEY);
      return;
    }

    const payload: PersistedGameSession = {
      game,
      draftPlace,
      turnSecondsRemaining,
    };

    window.sessionStorage.setItem(GAME_SESSION_STORAGE_KEY, JSON.stringify(payload));
  }, [draftPlace, game, turnSecondsRemaining, showEndGame]);

  /* eslint-disable react-hooks/exhaustive-deps */
  useEffect(() => {
    clearTurnTimerInterval();

    if (game.phase !== "playing" || showEndGame) {
     return undefined;
    }
    turnTimeoutHandledRef.current = false;
    turnTimerIntervalRef.current = setInterval(() => {
     setTurnSecondsRemaining((current) => {
        if (current <= 1) {
          clearTurnTimerInterval();
         void (async () => {
           if (turnTimeoutHandledRef.current || game.phase !== "playing") {
             return;
           }

           turnTimeoutHandledRef.current = true;
           dbg("turn timer expired");
           await stopListening();
           openEndGame();
         })();
         return 0;
       }

        return current - 1;
      });
    }, 1000);

    return () => {
      clearTurnTimerInterval();
    };
  }, [game.phase, game.currentPlayerIndex, showEndGame]);
  /* eslint-enable react-hooks/exhaustive-deps */

  // Clear all validation state when user edits the input (fixes stale duplicateChallenge bug)
  useEffect(() => {
    const clearValidation = window.setTimeout(() => {
      setPlaceCheck(null);
      setDuplicateChallenge(null);
      updateSpeechMessage("");
      setPlaceRequestState("idle");
      setPlaceRequestError(null);
    }, 0);

    return () => window.clearTimeout(clearValidation);
  }, [draftPlace]);

  function updateSpeechMessage(
    message: string,
    tone: "neutral" | "error" | "success" = "neutral",
  ) {
    setSpeechMessage(message);
    setSpeechMessageTone(tone);
  }

  function dbg(msg: string) {
    const ts = new Date().toLocaleTimeString("en-GB", { hour12: false });
    setDebugLogs((prev) => {
      const next = [...prev, `${ts} ${msg}`];
      return next.slice(-60); // keep last 60 lines
    });
    setTimeout(() => {
      debugScrollRef.current?.scrollTo({ top: 999999, behavior: "smooth" });
    }, 30);
  }

  async function shareAtlas() {
    const shareUrl = "https://play.google.com/store/apps/details?id=com.fibuladreams.atlas";
    const shareText = "Try out Atlas Junior app with your kid!";

    if (Capacitor.getPlatform() !== "web") {
      await Share.share({
        title: "Atlas Junior",
        text: shareText,
        url: shareUrl,
        dialogTitle: "Share Atlas Junior",
      });
      return;
    }

    if (typeof window !== "undefined" && typeof navigator.share === "function") {
      await navigator.share({
        title: "Atlas Junior",
        text: shareText,
        url: shareUrl,
      });
      return;
    }

    if (typeof window !== "undefined" && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(`${shareText} ${shareUrl}`);
      setShareCopied(true);
      window.setTimeout(() => setShareCopied(false), 2000);
      return;
    }

    if (typeof window !== "undefined") {
      window.prompt("Copy this link", shareUrl);
    }
  }

  async function fireDebugNotification() {
    if (debugNotificationSending) {
      return;
    }

    setDebugNotificationSending(true);
    try {
      dbg(`notification test: ${debugNotificationKind}`);
      await sendDebugNotification(debugNotificationKind);
      window.dispatchEvent(new Event("atlas:notifications-refresh"));
      dbg(`notification test sent: ${debugNotificationKind}`);
    } catch (error) {
      dbg(`notification test failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setDebugNotificationSending(false);
    }
  }

  function clearNativeSpeechAutoSaveTimer() {
    if (nativeSpeechAutoSaveTimerRef.current) {
      clearTimeout(nativeSpeechAutoSaveTimerRef.current);
      nativeSpeechAutoSaveTimerRef.current = null;
    }
  }

  function scheduleNativeSpeechAutoSave(transcript: string) {
    if (!transcript) {
      return;
    }

    clearNativeSpeechAutoSaveTimer();
    nativeSpeechAutoSaveTimerRef.current = setTimeout(() => {
      nativeSpeechAutoSaveTimerRef.current = null;

      if (nativeSpeechAutoSaveHandledRef.current) {
        return;
      }

      nativeSpeechAutoSaveHandledRef.current = true;
      dbg(`native auto-save: "${transcript}"`);
      saveTurnInternal({ overridePlace: transcript });
    }, NATIVE_SPEECH_AUTO_SAVE_DELAY_MS);
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

  async function stopListening() {
    clearNativeSpeechAutoSaveTimer();
    recognitionRef.current?.stop();
    recognitionRef.current?.abort();

    // Always clear the UI immediately — do not wait for the plugin to settle,
    // because if the recognizer is stuck the await would never complete.
    setIsListening(false);

    if (isNativeApp) {
      dbg("stopListening: calling stop()");
      try {
        await SpeechRecognition.stop();
        dbg("stopListening: stop() done");
      } catch (e) {
        dbg(`stopListening: stop error ${String(e)}`);
      }

    }
  }

  async function startListening() {
    setDuplicateChallenge(null);

    if (isNativeApp) {
      try {
        dbg("startListening: checking available()");
        const { available } = await SpeechRecognition.available();
        setNativeSpeechAvailable(available);
        dbg(`startListening: available=${available}`);

        dbg("startListening: checking permissions");
        const currentPermissions = await SpeechRecognition.checkPermissions();
        const grantedPermissions =
          currentPermissions.speechRecognition === "granted"
            ? currentPermissions
            : await SpeechRecognition.requestPermissions();
        dbg(`startListening: permission=${grantedPermissions.speechRecognition}`);

        if (grantedPermissions.speechRecognition !== "granted") {
          updateSpeechMessage(
            "Microphone access was blocked. Allow it in app permissions or type the place name instead.",
            "error",
          );
          placeInputRef.current?.focus();
          return;
        }

        const onlineStart = async () => {
        dbg("startListening: removeAllListeners");
        await SpeechRecognition.removeAllListeners();
        await SpeechRecognition.addListener("partialResults", ({ matches }) => {
          const transcript = matches?.[0]?.trim() ?? "";
          dbg(`partialResults: "${transcript}"`);
          latestTranscriptRef.current = transcript;
          setDraftPlace(transcript);
          updateSpeechMessage(
            transcript ? `I heard: "${transcript}"` : "I am still listening...",
          );
          scheduleNativeSpeechAutoSave(transcript);
        });
        await SpeechRecognition.addListener("listeningState", ({ status }) => {
          dbg(`listeningState: ${status}`);
          setIsListening(status === "started");
          if (status === "stopped") {
            clearNativeSpeechAutoSaveTimer();
            const transcript = latestTranscriptRef.current;
            if (transcript && !nativeSpeechAutoSaveHandledRef.current) {
              // Auto-save for audio — no Save button tap needed
              nativeSpeechAutoSaveHandledRef.current = true;
              saveTurnInternal({ overridePlace: transcript });
            } else {
              updateSpeechMessage("Didn't catch that — tap Listen to try again.");
            }
          }
        });

        latestTranscriptRef.current = "";
        nativeSpeechAutoSaveHandledRef.current = false;
        clearNativeSpeechAutoSaveTimer();
        setDraftPlace("");
        updateSpeechMessage("Listening...");
        await SpeechRecognition.start({
          language: "en-US",
          maxResults: 1,
          partialResults: true,
          popup: false,
        });
        dbg("startListening: start() resolved");
        setIsListening(true);
        };

        if (!available) {
        dbg("startListening: online speech unavailable");
        updateSpeechMessage(
          "Speech input is not available in this app. Allow mic access or type the place name instead.",
          "error",
        );
        placeInputRef.current?.focus();
        return;
        }

        await onlineStart();
        return;
      } catch (e) {
        dbg(`startListening: CATCH ${String(e)}`);
        setIsListening(false);
        updateSpeechMessage("I could not start speech in the app. Allow mic access or type the place name instead.", "error");
        placeInputRef.current?.focus();
      }
      return;
    }

    if (!speechSupported) {
      updateSpeechMessage(
        "Speech input is not available in this browser. Type the place name instead.",
        "error",
      );
      placeInputRef.current?.focus();
      return;
    }

    const Recognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Recognition) {
      updateSpeechMessage(
        "Speech input is not available in this browser. Type the place name instead.",
        "error",
      );
      placeInputRef.current?.focus();
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

      const isFinal = event.results[event.results.length - 1]?.isFinal ?? false;
      latestTranscriptRef.current = transcript;
      setDraftPlace(transcript);
      updateSpeechMessage(
        transcript ? `I heard: "${transcript}"` : "I am still listening...",
      );
      scheduleNativeSpeechAutoSave(transcript);

      if (isFinal && transcript) {
        // Auto-save for audio — no Save button tap needed
        saveTurnInternal({ overridePlace: transcript });
      }
    };

    recognition.onerror = (event) => {
      updateSpeechMessage(
        event.error === "not-allowed"
          ? "Microphone access was blocked. Allow it or type the place name."
          : event.error === "network"
            ? "Speech needs a network connection here. Try again or type the place name."
            : "I could not hear that clearly. Try again or type the place name.",
        "error",
      );
      setIsListening(false);
    };

    recognition.onend = () => {
      if (latestTranscriptRef.current.trim()) {
        scheduleNativeSpeechAutoSave(latestTranscriptRef.current.trim());
      }
      setIsListening(false);
    };

    recognitionRef.current = recognition;
    latestTranscriptRef.current = "";
    nativeSpeechAutoSaveHandledRef.current = false;
    clearNativeSpeechAutoSaveTimer();
    setDraftPlace("");
    updateSpeechMessage("Listening...");

    try {
      recognition.start();
      setIsListening(true);
    } catch {
      setIsListening(false);
      updateSpeechMessage(
        "I could not start the microphone. Allow mic access or type the place name instead.",
        "error",
      );
      placeInputRef.current?.focus();
    }
  }

  function startGame(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const names = playerNames.map((name) => name.trim()).filter(Boolean);

    if (names.length < 2) {
      setGame(createSetupState("Add at least two players before starting."));
      return;
    }

    setPlayerNames(names);
    clearTurnDraftState();
    resetTurnTimer();
    statsSubmittedRef.current = false;
    setGame(createNewGame(names));
  }

  async function requestPlaceAdd(): Promise<void> {
    if (game.phase !== "playing" || !currentPlayer) {
      return;
    }

    const requestedPlace = draftPlace.trim();
    if (!requestedPlace) {
      return;
    }
    if (placeRequestState === "submitting" || placeRequestState === "done") {
      return;
    }

    setPlaceRequestState("submitting");
    setPlaceRequestError(null);

    try {
      const suggestedPlace =
        placeCheck?.status === "suggest" ? placeCheck.suggestion : null;

      const result = await submitPlaceRequest({
        requestedName: requestedPlace,
        playerName: currentPlayer.name,
        turnLetter: game.requiredLetter,
        platform: Capacitor.getPlatform(),
        appVersion: APP_VERSION,
        savedTurns,
        totalTurns,
        suggestion: suggestedPlace ?? "",
      });
      if (result.status === "approved") {
        const approvedPlace = result.canonicalName?.trim() || requestedPlace;
        const previousVersion = getPlacesVersion();
        applyPlaceDictionaryDelta(
          [
            {
              requestedName: requestedPlace,
              canonicalName: approvedPlace,
              requestedKey: "",
              canonicalKey: "",
              updatedAt: new Date().toISOString(),
              source: "place-pipeline",
              reason: null,
            },
          ],
          previousVersion,
        );
        const saved = saveTurnInternal({
          overridePlace: approvedPlace,
          bypassDictionaryCheck: true,
        });
        if (saved) {
          setPlaceRequestState("done");
          updateSpeechMessage(result.message, "success");
          void refreshPlacesDelta(previousVersion).catch(() => {});
        } else {
          setPlaceRequestState("error");
          setPlaceRequestError("Could not save the approved place.");
          updateSpeechMessage("The place was approved, but it could not be saved yet.", "error");
        }
      } else {
        setPlaceRequestState("done");
        updateSpeechMessage(result.message, "success");
      }
    } catch (error) {
      setPlaceRequestState("error");
      setPlaceRequestError(error instanceof Error ? error.message : "Could not submit request");
      updateSpeechMessage("Could not send the request. Try again or check the pipeline.", "error");
    }
  }

  function saveTurnInternal(
    {
      overridePlace,
      bypassDictionaryCheck,
    }: { overridePlace?: string; bypassDictionaryCheck?: boolean } = {},
  ): boolean {
    if (game.phase !== "playing" || !currentPlayer) {
      return false;
    }

    if (turnTimeoutHandledRef.current) {
      return false;
    }

    if (!placesReady) {
      updateSpeechMessage("Place dictionary is still loading. Try again in a moment.", "error");
      return false;
    }

    // overridePlace lets callers (e.g. "Yes ✓" button) pass the accepted value
    // directly, bypassing stale React state for draftPlace
    const placeValue = overridePlace ?? draftPlace;

    const normalized = normalizePlaceName(placeValue);
    const placeKey = createPlaceKey(placeValue);

    if (!placeKey) {
      setDuplicateChallenge(null);
      setPlaceCheck(null);
      updateSpeechMessage("No place name is ready yet. Listen again or type it.", "error");
      return false;
    }

    if (!placeKey.startsWith(game.requiredLetter)) {
      setDuplicateChallenge(null);
      setPlaceCheck(null);
      updateSpeechMessage(
        `This turn must start with ${game.requiredLetter.toUpperCase()}.`,
        "error",
      );
      return false;
    }

    const likelyDuplicatePlace = findLikelyDuplicatePlace(placeValue, game.moves);

    if (game.usedPlaceKeys.includes(placeKey) || likelyDuplicatePlace) {
      const challenge =
        likelyDuplicatePlace ??
        ({
          draftPlace: placeValue.trim(),
          matchedPlace: placeValue.trim(),
          exact: true,
        } satisfies DuplicateChallenge);

      setDuplicateChallenge(challenge);
      setPlaceCheck(null);
      updateSpeechMessage(
        challenge.exact
          ? `"${placeValue.trim()}" was already called out. Pick a different place.`
          : `"${placeValue.trim()}" looks like "${challenge.matchedPlace}", which was already called out. Pick a different place.`,
        "error",
      );
      return false;
    }

    // Place dictionary check — only if not overriding
    const isBlockedWord = isRejectedBareWord(placeValue);

    if (!bypassDictionaryCheck && (isBlockedWord || !isKnownPlace(placeValue))) {
      const suggestion = isBlockedWord ? null : findSuggestion(placeValue);
      setDuplicateChallenge(null);
      setPlaceCheck(suggestion ? { status: "suggest", suggestion } : { status: "unknown" });
      return false;
    }

    const nextLetter = getLastLetter(normalized);

    if (!nextLetter) {
      setDuplicateChallenge(null);
      updateSpeechMessage(
        "I could not find the next letter. Try saying the place again.",
        "error",
      );
      return false;
    }

    const nextPlayerIndex = getNextPlayerIndex(game.players, game.currentPlayerIndex);
    const placeLabel = placeValue.trim();

    setDuplicateChallenge(null);
    setPlaceCheck(null);
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
    clearTurnDraftState();
    resetTurnTimer();
    setSavedFlash(true);
    setFlyingWord(placeLabel);
    setTimeout(() => setSavedFlash(false), 2000);
    setTimeout(() => setFlyingWord(null), 900);
    return true;
  }

  function saveTurn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    saveTurnInternal({});
  }

  function openEndGame() {
    void stopListening();
    clearTurnTimerInterval();
    clearTurnDraftState();
    setTurnSecondsRemaining(0);
    setShowEndGame(true);
    setEndGameLoading(true);
    setEndGameResult(null);
    setEndGameSubmitError(false);
    setEndGameSubmitting(false);
    setEndGameQualifies(false);
    setEndGameLeaderboard([]);
    // Default team name = player names joined by "-"
    setEndGameName(game.players.map((p) => p.name).join("-").slice(0, 24));

    // Submit stats once per game (fire-and-forget)
    if (!statsSubmittedRef.current) {
      statsSubmittedRef.current = true;
      void submitStats(totalTurns).catch(() => {});
    }

    // Fetch leaderboard to check qualification
    void getLeaderboard()
      .then((entries) => {
        setEndGameLeaderboard(entries);
        // Qualifies if fewer than 10 entries OR our saved-place count meets or beats the last entry
        const qualifies = entries.length < 10 || savedTurns >= (entries[entries.length - 1]?.score ?? 0);
        setEndGameQualifies(qualifies);
      })
      .catch(() => {
        // Fetch failed — default to showing the name entry (assume qualifies)
        setEndGameLeaderboard([]);
        setEndGameQualifies(true);
      })
      .finally(() => setEndGameLoading(false));
  }

  async function submitToLeaderboard() {
    setEndGameSubmitting(true);
    setEndGameSubmitError(false);
    try {
      const result = await submitScore({
        name: endGameName.trim() || "Anonymous",
        score: savedTurns,
        date: (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; })(),
      });
      // Refresh leaderboard so the just-saved entry appears in TopThree
      const fresh = await getLeaderboard().catch(() => endGameLeaderboard);
      setEndGameLeaderboard(fresh);
      setEndGameResult(result);
    } catch {
      setEndGameSubmitError(true);
    } finally {
      setEndGameSubmitting(false);
    }
  }

  function returnToSetup() {
    void stopListening();
    clearTurnTimerInterval();
    // Silently submit stats if not yet done (e.g. user resets without opening End Game)
    if (!statsSubmittedRef.current && game.phase === "playing") {
      statsSubmittedRef.current = true;
      void submitStats(totalTurns).catch(() => {});
    }
    clearTurnDraftState();
    resetTurnTimer();
    setGame(createSetupState());
  }

  return (
    <>
      {/* Flying-word animation keyframes */}
      <style>{`
        @keyframes wordFlyDown {
          0%   { opacity: 1; transform: translateY(0) scale(1); }
          60%  { opacity: 0.7; transform: translateY(140px) scale(0.85); }
          100% { opacity: 0; transform: translateY(220px) scale(0.7); }
        }
      `}</style>

      {/* Floating chip that flies toward Past places on save */}
      {flyingWord && (
        <div
          style={{
            position: "fixed",
            top: "38%",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 100,
            pointerEvents: "none",
          }}
        >
          <span
            style={{ display: "block", animation: "wordFlyDown 0.9s cubic-bezier(0.4,0,1,1) forwards" }}
            className="rounded-full bg-gradient-to-r from-violet-500 to-fuchsia-500 px-5 py-2 text-sm font-extrabold text-white shadow-xl shadow-fuchsia-300/50 whitespace-nowrap"
          >
            {flyingWord} ↓
          </span>
        </div>
      )}
      <main className="app-safe-area-shell min-h-screen bg-[radial-gradient(circle_at_top,_#fde68a,_#f5d0fe_42%,_#bfdbfe_78%,_#ffffff)] sm:px-6">
        <div className="mx-auto flex w-full max-w-4xl flex-col gap-5 pb-36">
          <header className="relative flex items-start justify-between gap-3 rounded-[2rem] bg-white/75 px-5 py-4 pr-16 shadow-lg shadow-violet-200/50 backdrop-blur sm:px-6">
            <div className="min-w-0 flex-1">
              <p className="text-3xl font-black tracking-tight text-slate-900 sm:text-4xl">
                Atlas
              </p>
              <p className="truncate text-sm font-medium text-slate-500">
                Colourful place-name game
              </p>
            </div>

            <button
              aria-label="About Atlas"
              className="absolute right-16 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-violet-600 text-lg font-black text-white shadow-lg shadow-violet-300/60 transition hover:bg-violet-500"
              onClick={() => setIsAboutOpen(true)}
              type="button"
            >
              ℹ
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
                    key={index}
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
                <div
                  className="rounded-full p-1 shadow transition-[filter,box-shadow] duration-300"
                  style={{
                    background: `conic-gradient(from 270deg, rgba(236,72,153,0.95) 0deg ${turnRemainingProgress * 360}deg, rgba(255,255,255,0.25) ${turnRemainingProgress * 360}deg 360deg)`,
                    boxShadow:
                      turnRemainingProgress < 0.1
                        ? "0 0 24px rgba(236,72,153,0.45)"
                        : "0 8px 18px rgba(236,72,153,0.18)",
                  }}
                >
                  <div className="rounded-full bg-gradient-to-r from-amber-300 via-orange-300 to-pink-300 px-5 py-3 text-center shadow-inner">
                    <p className="text-xs font-bold uppercase tracking-[0.3em] text-slate-700">
                      Letter
                    </p>
                    <p className="text-3xl font-black uppercase text-slate-900">
                      {game.requiredLetter}
                    </p>
                  </div>
                </div>

                <div className="min-w-0 flex-1">
                  <p className="text-xs font-bold uppercase tracking-[0.25em] text-slate-500">
                    Current player
                  </p>
                  <p
                    className="animate-turn-pop mt-1 text-2xl font-black text-slate-900"
                    key={currentPlayer?.id ?? "no-player"}
                  >
                    {currentPlayer?.name}
                  </p>
                  <p className="mt-1 text-sm text-slate-600">{game.statusMessage}</p>
                </div>
              </div>

              <div className="-mx-1 overflow-x-auto pb-2">
                <div className="flex w-max items-center gap-2 px-1">
                {game.players.map((player, index) => (
                  <span
                    className={`shrink-0 rounded-full px-4 py-2 text-sm font-bold shadow-sm ${
                      index === game.currentPlayerIndex
                        ? "animate-turn-pop bg-fuchsia-600 text-white"
                        : "bg-white/80 text-slate-700"
                    }`}
                    key={player.id}
                  >
                    {player.name}
                  </span>
                ))}
                  <span className="mx-1 h-8 w-px shrink-0 bg-slate-300" aria-hidden="true" />
                  <button
                    className={`${endGameButton} shrink-0 whitespace-nowrap`}
                    onClick={openEndGame}
                    type="button"
                  >
                    End game
                  </button>
                </div>
              </div>

              <article className="rounded-[2rem] bg-white/85 p-5 shadow-xl shadow-violet-200/60 backdrop-blur sm:p-6">
                <form className="space-y-4" onSubmit={saveTurn}>
                  {/* ── Mic button ── */}
                  <div className="flex flex-col items-center gap-2 py-3">
                    <button
                      type="button"
                      onClick={isListening ? stopListening : startListening}
                      className={`relative flex h-20 w-20 items-center justify-center rounded-full shadow-lg transition-all ${
                        isListening
                          ? "bg-rose-500 text-white"
                          : "bg-fuchsia-600 text-white hover:bg-fuchsia-500"
                      }`}
                    >
                      {isListening && (
                        <span className="absolute inset-0 animate-ping rounded-full bg-rose-400 opacity-50" />
                      )}
                      {/* Microphone icon */}
                      <svg
                        xmlns="http://www.w3.org/2000/svg"
                        fill="none"
                        viewBox="0 0 24 24"
                        strokeWidth={2}
                        stroke="currentColor"
                        className="relative z-10 h-9 w-9"
                        aria-hidden="true"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M12 18.75a6 6 0 0 0 6-6v-1.5m-6 7.5a6 6 0 0 1-6-6v-1.5m6 7.5v3.75m-3.75 0h7.5M12 15.75a3 3 0 0 1-3-3V4.5a3 3 0 0 1 6 0v8.25a3 3 0 0 1-3 3Z"
                        />
                      </svg>
                    </button>
                      <p className={`w-full max-w-full text-center text-xs font-semibold leading-snug break-words ${
                          speechMessage
                            ? speechMessageTone === "error"
                              ? "text-rose-500"
                              : speechMessageTone === "success"
                                ? "text-emerald-600"
                                : "text-sky-600"
                            : "text-slate-500"
                        }`}>
                          {speechMessage ||
                            (isListening
                              ? `Listening… tap to stop | ${formatTurnTimeStep(turnSecondsRemaining)}`
                              : `Tap to speak | ${formatTurnTimeStep(turnSecondsRemaining)}`)}
                      </p>
                  </div>

                  {/* ── Text input ── */}
                  <input
                    autoCapitalize="words"
                    autoComplete="off"
                    className="w-full rounded-[1.5rem] border border-white bg-white px-5 py-4 text-lg font-semibold text-slate-900 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                    onChange={(event) => {
                      setDraftPlace(event.target.value);
                    }}
                    placeholder={`Needs ${game.requiredLetter.toUpperCase()}…`}
                    ref={placeInputRef}
                    value={draftPlace}
                  />

                  {/* ── Save (only when letter is correct and no pending check) ── */}
                  {hasDraftPlace && placesReady && placeKeyOk && !placeCheck && !duplicateChallenge && (
                    <button className={`${primaryButton} w-full`} type="submit">
                      Save
                    </button>
                  )}

                  {!placesReady && hasDraftPlace && (
                    <p className="text-center text-sm font-semibold text-amber-600">
                      Loading place dictionary…
                    </p>
                  )}

                  {/* ── Letter hint (reactive, no click needed) ── */}
                  {hasDraftPlace && !placeKeyOk && (
                    <p className="text-center text-sm font-semibold text-rose-500">
                      Must start with {game.requiredLetter.toUpperCase()}
                    </p>
                  )}

                  {/* ── Save flash ── */}
                  {savedFlash && (
                    <p className="text-center text-sm font-semibold text-emerald-600 animate-pulse">
                      ✓ Saved
                    </p>
                  )}

                  {/* ── Duplicate override ── */}
                  {duplicateChallenge && (
                    <p className="text-center text-sm font-semibold text-rose-500">
                      Pick a different place.
                    </p>
                  )}

                  {/* ── Place-check feedback ── */}
                  {placeCheck?.status === "suggest" && (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-2">
                      <p>Did you mean <strong>{placeCheck.suggestion}</strong>?</p>
                      <div className="flex gap-2">
                        <button
                          className="flex-1 rounded-xl bg-amber-200 px-3 py-1.5 font-semibold hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-60"
                          onClick={() => saveTurnInternal({ overridePlace: placeCheck.suggestion })}
                          disabled={placeRequestState === "submitting"}
                          type="button"
                        >
                          Yes ✓
                        </button>
                        <button
                          className="flex-1 rounded-xl bg-white border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                          disabled={placeRequestState === "submitting"}
                          onClick={() => void requestPlaceAdd()}
                          type="button"
                        >
                          {placeRequestState === "submitting"
                            ? "Requesting…"
                            : placeRequestState === "done"
                              ? "Requested"
                              : "Request add"}
                        </button>
                      </div>
                      {placeRequestError && (
                        <p className="text-xs text-rose-600">{placeRequestError}</p>
                      )}
                    </div>
                  )}
                  {placeCheck?.status === "unknown" && (
                    <div className="rounded-2xl bg-amber-50 px-4 py-3 text-sm text-amber-800 space-y-2">
                      <p>&#34;{draftPlace.trim()}&#34; isn&#39;t in our map.</p>
                      <button
                        className="w-full rounded-xl bg-white border border-amber-300 px-3 py-1.5 font-semibold hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={placeRequestState === "submitting"}
                        onClick={() => void requestPlaceAdd()}
                        type="button"
                      >
                        {placeRequestState === "submitting"
                          ? "Requesting…"
                          : placeRequestState === "done"
                            ? "Requested"
                            : "Request add"}
                      </button>
                      {placeRequestError && (
                        <p className="text-xs text-rose-600">{placeRequestError}</p>
                      )}
                    </div>
                  )}
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

      {/* ── Navigation links ── */}
      <div className="fixed bottom-0 left-0 right-0 z-30 flex items-center bg-white/70 py-2 backdrop-blur text-xs text-slate-400">
        <div className="flex flex-1 justify-center gap-6">
          <Link href="/leaderboard" className="hover:text-fuchsia-600 transition">
            🏆 Leaderboard
          </Link>
          <Link href="/support" className="hover:text-slate-600 transition">
            Support
          </Link>
          <button
            className="hover:text-fuchsia-600 transition"
            onClick={() => void shareAtlas()}
            type="button"
          >
            {shareCopied ? "✓ Copied" : "📤 Share"}
          </button>
        </div>
        <span className="pr-3 text-slate-300">v{APP_VERSION}</span>
      </div>

      {/* ── Debug panel (debug builds only) ── */}
      {process.env.NEXT_PUBLIC_DEBUG_PANEL === "true" && <div className="fixed bottom-7 left-0 right-0 z-40">
        <button
          className="w-full bg-slate-800 py-1 text-xs font-mono text-slate-300"
          onClick={() => setShowDebug((v) => !v)}
          type="button"
        >
          {showDebug ? "▼ hide debug" : "▲ show debug"} ({debugLogs.length} lines)
        </button>
        {showDebug && (
          <div
            ref={debugScrollRef}
            className="h-48 overflow-y-auto bg-slate-900 px-3 py-2"
          >
            {debugLogs.length === 0 && (
              <p className="text-xs font-mono text-slate-500">No logs yet. Tap Listen.</p>
            )}
            {debugLogs.map((line, i) => (
              <p className="text-xs font-mono text-green-300 leading-5" key={i}>{line}</p>
            ))}
          </div>
        )}
        {showDebug && (
          <div className="flex gap-2 bg-slate-900 px-3 pb-3">
            <button
              className="rounded bg-slate-700 px-3 py-1 text-xs font-mono text-white"
              onClick={() => {
                void navigator.clipboard?.writeText(debugLogs.join("\n"));
              }}
              type="button"
            >
              Copy logs
            </button>
            <button
              className="rounded bg-slate-700 px-3 py-1 text-xs font-mono text-white"
              onClick={() => setDebugLogs([])}
              type="button"
            >
              Clear
            </button>
          </div>
        )}
        {showDebug && (
          <div className="space-y-2 bg-slate-900 px-3 pb-4">
            <select
              className="w-full rounded bg-slate-800 px-3 py-2 text-xs font-mono text-white outline-none"
              value={debugNotificationKind}
              onChange={(event) => {
                const nextKind = DEBUG_NOTIFICATION_OPTIONS.find(
                  (option) => option.kind === event.target.value,
                );
                if (nextKind) {
                  setDebugNotificationKind(nextKind.kind);
                }
              }}
            >
              {DEBUG_NOTIFICATION_OPTIONS.map((option) => (
                <option key={option.kind} value={option.kind}>
                  {option.label}
                </option>
              ))}
            </select>
            <button
              className="w-full rounded bg-fuchsia-600 px-3 py-2 text-xs font-bold text-white disabled:cursor-not-allowed disabled:bg-fuchsia-400"
              onClick={() => void fireDebugNotification()}
              type="button"
              disabled={debugNotificationSending}
            >
              {debugNotificationSending ? "Sending…" : "Send test notification"}
            </button>
          </div>
        )}
      </div>}

      {/* ── End Game modal ── */}
      {showEndGame ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-[2rem] bg-white shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="flex items-start justify-between gap-4 px-6 pt-6 pb-4">
              <div>
                <h2 className="text-2xl font-black text-slate-900">
                  {endGameResult ? (endGameResult.onLeaderboard ? "🏆 Top 10!" : "🎮 Game over!") : "Game over!"}
                </h2>
                <p className="mt-0.5 text-sm text-slate-500">
                  {savedTurns} place{savedTurns !== 1 ? "s" : ""} named
                  {totalTurns !== savedTurns ? ` · ${totalTurns - savedTurns} skip${totalTurns - savedTurns !== 1 ? "s" : ""}` : ""}
                </p>
              </div>
            </div>

            {/* Body — scrollable */}
            <div className="max-h-[65vh] overflow-y-auto px-6 pb-6 space-y-5">
              {endGameLoading ? (
                <div className="space-y-5">
                  <div className="flex flex-col items-center gap-3 py-8 text-slate-400">
                    <div className="h-8 w-8 animate-spin rounded-full border-4 border-fuchsia-200 border-t-fuchsia-600" />
                    <p className="text-sm">Loading leaderboard…</p>
                  </div>
                  {/* Always show escape hatch — network may be slow */}
                  <button className={`${secondaryButton} w-full`} onClick={() => { setShowEndGame(false); returnToSetup(); }} type="button">
                    Skip &amp; start new game
                  </button>
                </div>
              ) : endGameResult ? (
                /* ── Post-submit ── */
                <div className="space-y-4">
                  {endGameResult.onLeaderboard && endGameResult.rank !== null ? (
                    <p className="text-center font-bold text-fuchsia-600">
                      You&apos;re ranked #{endGameResult.rank} all-time!
                    </p>
                  ) : (
                    <p className="text-center text-sm text-slate-500">Score saved!</p>
                  )}
                  {endGameLeaderboard.length > 0 && (
                    <TopThree entries={endGameLeaderboard} highlightId={endGameResult.entryId || undefined} />
                  )}
                  <div className="flex gap-3">
                    <Link
                      href={endGameResult.entryId ? `/leaderboard?entry=${endGameResult.entryId}` : "/leaderboard"}
                      className={`${primaryButton} flex-1 text-center`}
                    >
                      Full leaderboard
                    </Link>
                    <button className={`${secondaryButton} flex-1`} onClick={() => { setShowEndGame(false); returnToSetup(); }} type="button">
                      New game
                    </button>
                  </div>
                </div>
              ) : endGameQualifies ? (
                /* ── Top 10 entry ── */
                <div className="space-y-4">
                  <div className="rounded-2xl bg-fuchsia-50 px-4 py-3 text-center">
                    <p className="font-bold text-fuchsia-700">🎉 You made the top 10!</p>
                    <p className="text-xs text-fuchsia-500 mt-0.5">Enter your team name to save your score</p>
                  </div>
                  {endGameSubmitError && (
                    <p className="text-center text-sm text-red-500">Couldn&apos;t save — check your connection and try again.</p>
                  )}
                  <input
                    className="w-full rounded-[1.5rem] border border-slate-200 bg-white px-5 py-3 text-sm font-semibold text-slate-900 outline-none transition focus:border-fuchsia-300 focus:ring-4 focus:ring-fuchsia-100"
                    maxLength={24}
                    onChange={(e) => setEndGameName(e.target.value)}
                    placeholder="Team name"
                    value={endGameName}
                  />
                  <button className={`${primaryButton} w-full`} disabled={endGameSubmitting} onClick={submitToLeaderboard} type="button">
                    {endGameSubmitting ? "Saving…" : endGameSubmitError ? "Retry" : "Save to leaderboard"}
                  </button>
                  {endGameLeaderboard.length > 0 && (
                    <TopThree entries={endGameLeaderboard} />
                  )}
                  <div className="flex justify-center gap-4">
                    <Link href="/leaderboard" className="text-sm text-slate-400 underline underline-offset-2">See full leaderboard</Link>
                    <button className="text-sm text-slate-400 underline underline-offset-2" onClick={() => { setShowEndGame(false); returnToSetup(); }} type="button">New game</button>
                  </div>
                </div>
              ) : (
                /* ── Didn't qualify ── */
                <div className="space-y-4">
                  {endGameLeaderboard.length > 0 && (
                    <TopThree entries={endGameLeaderboard} />
                  )}
                  <div className="flex gap-3">
                    <Link href="/leaderboard" className={`${primaryButton} flex-1 text-center`}>Full leaderboard</Link>
                    <button className={`${secondaryButton} flex-1`} onClick={() => { setShowEndGame(false); returnToSetup(); }} type="button">New game</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}

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
              <p>4. Tap the <strong>microphone</strong> button to speak the place name, then tap <strong>Save</strong>.</p>
              <p>5. If speech is not available, just type the place name instead.</p>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
