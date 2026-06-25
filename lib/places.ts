/**
 * lib/places.ts
 * Offline place-name validation using the bundled GeoNames dictionary.
 *
 * Data is loaded lazily from /places.json (built by scripts/build-places-db.mjs).
 * Normalization matches createPlaceKey() in AtlasGame.tsx exactly.
 */

import { PLACE_DICTIONARY_VERSION } from "@/lib/place-dictionary-version";
import { getPlaceDictionaryDelta, type PlaceDictionaryDeltaItem } from "@/lib/api";

interface PlacesData {
  map: Record<string, string>;
  byFirstLetter: Record<string, string[]>;
}

const MIN_BARE_WORD_LENGTH = 4;

let placesData: PlacesData | null = null;
let loadPromise: Promise<void> | null = null;
let placesVersion = PLACE_DICTIONARY_VERSION;
let pendingDeltaItems: PlaceDictionaryDeltaItem[] = [];
let pendingDeltaVersion: string | null = null;

/** Normalize a place name to its lookup key (must mirror createPlaceKey in AtlasGame.tsx) */
export function normalizePlaceKey(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// Baked at build time by Next.js — empty string for Capacitor, '/game' for web deployment
const BASE_PATH = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

/** Load the places dictionary. Safe to call multiple times — only loads once. */
export async function loadPlaces(): Promise<void> {
  if (placesData) return;
  if (loadPromise) return loadPromise;
  loadPromise = (async () => {
    const res = await fetch(`${BASE_PATH}/places.json?v=${encodeURIComponent(PLACE_DICTIONARY_VERSION)}`);
    if (!res.ok) throw new Error(`Failed to load places.json: ${res.status}`);
    placesData = await res.json();
    placesVersion = PLACE_DICTIONARY_VERSION;
    if (pendingDeltaItems.length > 0) {
      const queued = pendingDeltaItems;
      pendingDeltaItems = [];
      applyPlaceDictionaryDelta(queued);
      placesVersion = pendingDeltaVersion ?? placesVersion;
      pendingDeltaVersion = null;
    }
  })();
  return loadPromise;
}

function addDictionaryEntry(key: string, displayName: string): void {
  const normalizedKey = normalizePlaceKey(key);
  const normalizedDisplayName = String(displayName ?? "").trim();
  if (!normalizedKey || !normalizedDisplayName) {
    return;
  }

  if (!placesData) {
    return;
  }

  const data = placesData;
  data.map[normalizedKey] = normalizedDisplayName;

  const firstLetter = normalizedKey[0];
  const bucket = data.byFirstLetter[firstLetter] ?? (data.byFirstLetter[firstLetter] = []);
  if (!bucket.includes(normalizedKey)) {
    bucket.push(normalizedKey);
  }
}

export function getPlacesVersion(): string {
  return placesVersion;
}

export function applyPlaceDictionaryDelta(items: PlaceDictionaryDeltaItem[], version?: string): void {
  if (!placesData) {
    pendingDeltaItems = [...pendingDeltaItems, ...items];
    if (version && version.trim()) {
      placesVersion = version.trim();
      pendingDeltaVersion = version.trim();
    }
    return;
  }

  for (const item of items) {
    const requestedName = String(item?.requestedName ?? "").trim();
    const canonicalName = String(item?.canonicalName ?? "").trim();
    if (!requestedName || !canonicalName) {
      continue;
    }

    addDictionaryEntry(requestedName, canonicalName);
    addDictionaryEntry(canonicalName, canonicalName);
  }

  if (version && version.trim()) {
    placesVersion = version.trim();
  }
}

export async function refreshPlacesDelta(since = placesVersion): Promise<string> {
  const delta = await getPlaceDictionaryDelta(since);
  applyPlaceDictionaryDelta(delta.items, delta.version);
  return delta.version;
}

/** Returns true if the place name exists in the dictionary. */
export function isKnownPlace(name: string): boolean {
  if (!placesData) return false;
  const key = normalizePlaceKey(name);
  if (!key) return false;
  return Object.hasOwn(placesData.map, key);
}

/** Returns true for exact bare words that we want to reject even if they exist as place names. */
export function isRejectedBareWord(name: string): boolean {
  const key = normalizePlaceKey(name);
  return key.length > 0 && key.length < MIN_BARE_WORD_LENGTH;
}

/**
 * Returns the display name of a close match (Levenshtein ≤ 2) within the
 * first-letter bucket, or null if no good suggestion found.
 */
export function findSuggestion(name: string): string | null {
  if (!placesData) return null;
  const key = normalizePlaceKey(name);
  if (!key) return null;
  const firstLetter = key[0];
  const bucket = placesData.byFirstLetter[firstLetter];
  if (!bucket || bucket.length === 0) return null;

  let bestKey: string | null = null;
  let bestDist = 3; // threshold: only accept ≤ 2

  for (const candidate of bucket) {
    // Quick length gate to skip obviously wrong candidates
    if (Math.abs(candidate.length - key.length) > 2) continue;
    const dist = levenshtein(key, candidate, bestDist - 1);
    if (dist < bestDist) {
      bestDist = dist;
      bestKey = candidate;
    }
  }
  if (!bestKey) return null;
  return placesData.map[bestKey] ?? bestKey;
}

/**
 * Bounded Levenshtein distance. Returns early if current path exceeds maxDist.
 * O(n * maxDist) — significantly faster than full matrix for large strings.
 */
function levenshtein(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length;
  const n = b.length;
  // Single-row DP
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) return maxDist + 1; // prune entire row
    prev = curr;
  }
  return prev[n];
}
