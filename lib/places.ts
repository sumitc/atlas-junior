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
  allKeys: string[];
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
    const loaded = await res.json();
    placesData = {
      ...loaded,
      allKeys: Object.keys(loaded.map ?? {}),
    };
    placesVersion = PLACE_DICTIONARY_VERSION;
    if (pendingDeltaItems.length > 0) {
      const queued = pendingDeltaItems;
      pendingDeltaItems = [];
      applyPlaceDictionaryDelta(queued);
      placesVersion = pendingDeltaVersion ?? placesVersion;
      pendingDeltaVersion = null;
    }

    // Apply the full approved overlay once so the shipped GeoNames snapshot
    // stays in sync with places approved after the dictionary was last rebuilt.
    await refreshPlacesDelta("1970-01-01T00:00:00.000Z").catch(() => {});
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
  if (!data.allKeys.includes(normalizedKey)) {
    data.allKeys.push(normalizedKey);
  }
}

export function getPlacesVersion(): string {
  return placesVersion;
}

export function getRandomStartingLetter(): string {
  const data = placesData;
  if (!data) {
    return "a";
  }

  const letters = Object.keys(data.byFirstLetter).filter(
    (letter) => (data.byFirstLetter[letter]?.length ?? 0) > 0,
  );
  if (letters.length === 0) {
    return "a";
  }

  return letters[Math.floor(Math.random() * letters.length)] ?? "a";
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

function buildSuggestionSeeds(key: string): string[] {
  const seeds = [key];
  const maxTrim = Math.min(6, Math.max(0, key.length - 4));
  for (let trim = 1; trim <= maxTrim; trim += 1) {
    const trimmed = key.slice(trim);
    if (trimmed.length >= 4) {
      seeds.push(trimmed);
    }
  }
  return [...new Set(seeds)];
}

function maxDistanceForSeed(seed: string): number {
  if (seed.length <= 6) return 2;
  if (seed.length <= 10) return 3;
  return 4;
}

/**
 * Returns close matches ordered from best to worst. Uses the first-letter bucket
 * and also tries trimmed prefixes so speech prefixes like "rename ..." can still
 * produce useful autocorrect choices.
 */
export function findSuggestions(name: string, limit = 3): string[] {
  if (!placesData) return [];
  const key = normalizePlaceKey(name);
  if (!key) return [];

  const seen = new Set<string>();
  const ranked: Array<{ key: string; score: number }> = [];

  for (const seed of buildSuggestionSeeds(key)) {
    const bucket = placesData.byFirstLetter[seed[0]];
    if (!bucket || bucket.length === 0) continue;

    const maxDist = maxDistanceForSeed(seed);
    for (const candidate of bucket) {
      if (seen.has(candidate)) continue;
      if (candidate.length < 5) continue;
      if (Math.abs(candidate.length - seed.length) > maxDist + 1) continue;

      const dist = levenshtein(seed, candidate, maxDist);
      if (dist > maxDist) continue;

      const normalizedDistance = dist / Math.max(seed.length, candidate.length);
      if (normalizedDistance > 0.34) continue;

      seen.add(candidate);
      ranked.push({
        key: candidate,
        score: normalizedDistance * 100 + Math.abs(candidate.length - seed.length),
      });
    }
  }

  return ranked
    .sort((first, second) => first.score - second.score || first.key.localeCompare(second.key))
    .slice(0, limit)
    .map((entry) => placesData?.map[entry.key] ?? entry.key);
}

export function findSuggestion(name: string): string | null {
  return findSuggestions(name, 1)[0] ?? null;
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
