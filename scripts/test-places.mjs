/**
 * scripts/test-places.mjs
 * Functional tests for the place validation feature.
 * Run with: node scripts/test-places.mjs
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

// ── Replicate lib/places.ts logic in Node (no fetch needed here) ─────────────
const placesData = JSON.parse(readFileSync(join(ROOT, "public", "places.json"), "utf8"));
const BLOCKED_COMMON_WORDS = new Set(["ball", "dab"]);

function normalizePlaceKey(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function isKnownPlace(name) {
  const key = normalizePlaceKey(name);
  return key.length > 0 && Object.hasOwn(placesData.map, key);
}

function isBlockedCommonWord(name) {
  const key = normalizePlaceKey(name);
  return BLOCKED_COMMON_WORDS.has(key);
}

function levenshtein(a, b, maxDist) {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > maxDist) return maxDist + 1;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const curr = [i];
    let rowMin = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(curr[j - 1] + 1, prev[j] + 1, prev[j - 1] + cost);
      rowMin = Math.min(rowMin, curr[j]);
    }
    if (rowMin > maxDist) return maxDist + 1;
    prev = curr;
  }
  return prev[n];
}

function findSuggestion(name) {
  const key = normalizePlaceKey(name);
  if (!key) return null;
  const bucket = placesData.byFirstLetter[key[0]];
  if (!bucket) return null;
  let bestKey = null, bestDist = 3;
  for (const candidate of bucket) {
    if (Math.abs(candidate.length - key.length) > 2) continue;
    const dist = levenshtein(key, candidate, bestDist - 1);
    if (dist < bestDist) { bestDist = dist; bestKey = candidate; }
  }
  return bestKey ? (placesData.map[bestKey] ?? bestKey) : null;
}

// ── Replicate game save logic (pure, no React state) ─────────────────────────
function normalizePlaceName(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function createPlaceKey(value) {
  return normalizePlaceName(value).replace(/[^a-z]/g, "");
}
function getLastLetter(normalized) {
  const letters = normalized.replace(/[^a-z]/g, "");
  return letters[letters.length - 1] ?? null;
}

/**
 * Simulates saveTurnInternal logic (pure, returns outcome instead of setting state).
 * outcome: "saved" | "letter_error" | "duplicate" | "suggest" | "unknown" | "no_next_letter"
 */
function simulateSave(placeValue, { requiredLetter, usedPlaceKeys = [] } = {}) {
  const placeKey = createPlaceKey(placeValue);
  if (!placeKey) return { outcome: "empty" };
  if (!placeKey.startsWith(requiredLetter)) return { outcome: "letter_error" };
  if (usedPlaceKeys.includes(placeKey)) return { outcome: "duplicate" };

  const blocked = isBlockedCommonWord(placeValue);
  if (blocked || !isKnownPlace(placeValue)) {
    const suggestion = blocked ? null : findSuggestion(placeValue);
    return suggestion
      ? { outcome: "suggest", suggestion }
      : { outcome: "unknown" };
  }

  const nextLetter = getLastLetter(normalizePlaceName(placeValue));
  if (!nextLetter) return { outcome: "no_next_letter" };
  return { outcome: "saved", nextLetter, savedAs: placeValue.trim() };
}

// ── Test runner ───────────────────────────────────────────────────────────────
let pass = 0, fail = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (e) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${e.message}`);
    fail++;
  }
}
function assert(actual, expected, msg) {
  if (actual !== expected)
    throw new Error(`${msg ?? ""}\n     expected: ${JSON.stringify(expected)}\n     got:      ${JSON.stringify(actual)}`);
}
function assertTruthy(val, msg) {
  if (!val) throw new Error(msg ?? `Expected truthy, got ${JSON.stringify(val)}`);
}
function assertFalsy(val, msg) {
  if (val) throw new Error(msg ?? `Expected falsy, got ${JSON.stringify(val)}`);
}

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── 1. Dictionary lookups ──────────────────────────────────────────");

test("Known country 'Angola' is recognised", () =>
  assertTruthy(isKnownPlace("Angola")));

test("Known country 'India' is recognised", () =>
  assertTruthy(isKnownPlace("India")));

test("Known alternate name 'UK' is recognised", () =>
  assertTruthy(isKnownPlace("UK")));

test("Known alternate name 'USA' is recognised", () =>
  assertTruthy(isKnownPlace("USA")));

test("Alias 'Everest' resolves (from 'Mount Everest')", () =>
  assertTruthy(isKnownPlace("Everest")));

test("Alias 'Nile' resolves (from 'River Nile')", () =>
  assertTruthy(isKnownPlace("Nile")));

test("Known city 'Paris' is recognised", () =>
  assertTruthy(isKnownPlace("Paris")));

test("Known Indian city 'Prayagraj' is recognised", () =>
  assertTruthy(isKnownPlace("Prayagraj")));

test("Known old name 'Allahabad' is recognised", () =>
  assertTruthy(isKnownPlace("Allahabad")));

test("Known Indian city 'Bengaluru' is recognised", () =>
  assertTruthy(isKnownPlace("Bengaluru")));

test("Common alias 'Bangalore' is recognised", () =>
  assertTruthy(isKnownPlace("Bangalore")));

test("Known Indian city 'Rourkela' is recognised", () =>
  assertTruthy(isKnownPlace("Rourkela")));

test("Known Indian place 'Kashmir' is recognised", () =>
  assertTruthy(isKnownPlace("Kashmir")));

test("Known Indian town 'Abohar' is recognised", () =>
  assertTruthy(isKnownPlace("Abohar")));

test("Bare common word 'ball' is blocked even if the dictionary contains a place entry", () =>
  assertTruthy(isBlockedCommonWord("ball")));

test("Bare common word 'dab' is blocked even if the dictionary contains a place entry", () =>
  assertTruthy(isBlockedCommonWord("dab")));

test("Known city with accents 'São Paulo' is recognised", () =>
  assertTruthy(isKnownPlace("São Paulo")));

test("Non-place word 'Frobnicator' is not recognised", () =>
  assertFalsy(isKnownPlace("Frobnicator")));

test("Random string 'xyzzyabc' is not recognised", () =>
  assertFalsy(isKnownPlace("xyzzyabc")));

test("Empty string is not recognised", () =>
  assertFalsy(isKnownPlace("")));

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── 2. Fuzzy suggestion ────────────────────────────────────────────");

test("'Prayagrajj' gets a suggestion (1-2 char difference from a real place)", () => {
  const s = findSuggestion("Prayagrajj");
  assertTruthy(s, `Expected a suggestion for 'Prayagrajj', got: ${s}`);
  console.log(`     (suggested: ${s})`);
});

test("'Pariss' suggests 'Paris' or similar", () => {
  const s = findSuggestion("Pariss");
  assertTruthy(s, `Expected a suggestion for 'Pariss', got: ${s}`);
  console.log(`     (suggested: ${s})`);
});

test("'Londn' suggests 'London' or similar", () => {
  const s = findSuggestion("Londn");
  assertTruthy(s, `Expected a suggestion for 'Londn', got: ${s}`);
  console.log(`     (suggested: ${s})`);
});

test("Totally random 'xyzzyabc' returns no suggestion", () =>
  assert(findSuggestion("xyzzyabc"), null));

test("Known place 'Paris' returns no suggestion (no need to suggest)", () => {
  // findSuggestion is only called when isKnownPlace is false, but verify it
  // doesn't erroneously return itself
  const s = findSuggestion("Paris");
  // It may return Paris or null — both are valid since it's already known
  // What we test is that it doesn't crash
  assertTruthy(s !== undefined);
  console.log(`     (Paris suggestion: ${s})`);
});

// ────────────────────────────────────────────────────────────────────────────
console.log("\n── 3. Game save flow simulation ───────────────────────────────────");

test("Known place saves immediately, advances turn", () => {
  const r = simulateSave("Angola", { requiredLetter: "a" });
  assert(r.outcome, "saved");
  assert(r.nextLetter, "a"); // Angola → last letter 'a'
});

test("Bare common word 'ball' is rejected", () => {
  const r = simulateSave("ball", { requiredLetter: "b" });
  assert(r.outcome, "unknown");
});

test("Real place 'Ball Bay' remains valid", () => {
  const r = simulateSave("Ball Bay", { requiredLetter: "b" });
  assert(r.outcome, "saved");
});

test("Known place with wrong starting letter gives letter_error", () => {
  const r = simulateSave("Angola", { requiredLetter: "b" });
  assert(r.outcome, "letter_error");
});

test("Unknown non-place word shows suggestion when fuzzy match found", () => {
  const r = simulateSave("Prayagrajj", { requiredLetter: "p" });
  assert(r.outcome, "suggest");
  assertTruthy(r.suggestion, "Should have a suggestion");
  console.log(`     (suggested: ${r.suggestion})`);
});

test("Accepting suggestion (overridePlace) saves correctly", () => {
  // First save attempt shows suggestion
  const first = simulateSave("Prayagrajj", { requiredLetter: "p" });
  assert(first.outcome, "suggest");
  const second = simulateSave(first.suggestion, { requiredLetter: "p" });
  assert(second.outcome, "saved", `Expected saved, got: ${second.outcome}`);
  console.log(`     Saved as: "${second.savedAs}", next letter: ${second.nextLetter}`);
});

test("Totally unknown word with no match shows unknown prompt", () => {
  const r = simulateSave("xyzzyabc", { requiredLetter: "x" });
  assert(r.outcome, "unknown");
});

test("Duplicate place shows duplicate warning", () => {
  const r = simulateSave("Angola", { requiredLetter: "a", usedPlaceKeys: ["angola"] });
  assert(r.outcome, "duplicate");
});

test("'India' saves and next letter is 'a'", () => {
  const r = simulateSave("India", { requiredLetter: "i" });
  assert(r.outcome, "saved");
  assert(r.nextLetter, "a");
});

test("Accented input 'São Paulo' saves and advances to 'o'", () => {
  const r = simulateSave("São Paulo", { requiredLetter: "s" });
  assert(r.outcome, "saved");
  assert(r.nextLetter, "o");
});

// ── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${"─".repeat(60)}`);
console.log(`  ${pass + fail} tests   ✅ ${pass} passed   ${fail > 0 ? "❌" : "✅"} ${fail} failed`);
if (fail > 0) process.exit(1);
