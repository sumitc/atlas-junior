import { existsSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PLACES_FILE = join(ROOT, "public", "places.json");
const APPROVALS_FILE = join(ROOT, "data", "approved-country-additions.json");

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, "utf8"));
}

const places = readJson(PLACES_FILE, null);
if (!places || typeof places !== "object" || !places.map || !places.byFirstLetter) {
  throw new Error("public/places.json is missing or invalid");
}

const approvals = readJson(APPROVALS_FILE, { entries: [] });
const entries = Array.isArray(approvals.entries) ? approvals.entries : [];
let added = 0;
let aliased = 0;

for (const entry of entries) {
  const requestedName = String(entry?.requestedName ?? "").trim();
  const canonicalName = String(entry?.canonicalName ?? "").trim();
  const requestedKey = normalize(requestedName);
  const canonicalKey = normalize(canonicalName);

  if (!requestedKey || !canonicalKey) continue;

  if (!places.map[canonicalKey]) {
    places.map[canonicalKey] = canonicalName;
    added++;
  }
  if (!places.map[requestedKey]) {
    places.map[requestedKey] = canonicalName;
    aliased++;
  }
}

const byFirstLetter = {};
for (const key of Object.keys(places.map)) {
  const letter = key[0];
  if (!letter) continue;
  if (!byFirstLetter[letter]) byFirstLetter[letter] = [];
  byFirstLetter[letter].push(key);
}
for (const letter of Object.keys(byFirstLetter)) {
  byFirstLetter[letter].sort();
}

places.byFirstLetter = byFirstLetter;
writeFileSync(PLACES_FILE, `${JSON.stringify(places)}\n`, "utf8");

console.log(`Applied approved country aliases: ${aliased} aliases, ${added} canonical names`);
