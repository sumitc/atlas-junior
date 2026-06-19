/**
 * build-places-db.mjs
 * Builds public/places.json from GeoNames open data.
 *
 * Run once (or when you want to refresh the data):
 *   node scripts/build-places-db.mjs
 *
 * Output: public/places.json
 *   { map: { normalizedKey: "Display Name", ... },
 *     byFirstLetter: { a: ["aachen","abadan",...], b: [...], ... } }
 *
 * Data sources (Creative Commons Attribution 4.0):
 *   https://www.geonames.org/  — GeoNames Geographical Database
 *
 * Normalization matches createPlaceKey() in AtlasGame.tsx exactly:
 *   NFD decompose → strip combining marks → lowercase → strip non-alpha
 */

import { createReadStream, createWriteStream, existsSync, mkdirSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, ".places-cache");
const OUT_FILE = join(ROOT, "public", "places.json");

// ── Normalization (must match createPlaceKey in AtlasGame.tsx) ──────────────
function normalize(name) {
  return name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

// ── Download helper ─────────────────────────────────────────────────────────
async function download(url, destPath) {
  if (existsSync(destPath)) {
    console.log(`  ✓ cached: ${destPath.split("/").pop()}`);
    return;
  }
  console.log(`  ↓ downloading: ${url}`);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  const file = createWriteStream(destPath);
  await pipeline(res.body, file);
  console.log(`  ✓ saved: ${destPath.split("/").pop()}`);
}

// ── Unzip + read lines helper ───────────────────────────────────────────────
async function* readZippedLines(zipPath) {
  // Extract to same cache dir, read the extracted file
  const dir = dirname(zipPath);
  execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: "pipe" });
  // Find the extracted txt file (largest file in dir matching the zip base name)
  const base = zipPath.replace(/\.zip$/, "");
  const txtPath = base + ".txt";
  const rl = createInterface({ input: createReadStream(txtPath), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function* readLines(filePath) {
  const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
  for await (const line of rl) yield line;
}

async function* readGeoapifyLocalityLines(zipPath) {
  const dir = dirname(zipPath);
  execSync(`unzip -o "${zipPath}" -d "${dir}"`, { stdio: "pipe" });

  const files = [
    join(dir, "in", "place_city.ndjson"),
    join(dir, "in", "place-town.ndjson"),
  ];

  for (const filePath of files) {
    if (!existsSync(filePath)) continue;
    const rl = createInterface({ input: createReadStream(filePath), crlfDelay: Infinity });
    for await (const line of rl) yield line;
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
mkdirSync(CACHE_DIR, { recursive: true });

const map = {}; // normalizedKey → "Display Name"

// ── 1. Cities with population ≥ 5,000 ──────────────────────────────────────
console.log("\n[1/5] Cities (population ≥ 5,000)");
const cities5kZip = join(CACHE_DIR, "cities5000.zip");
await download("https://download.geonames.org/export/dump/cities5000.zip", cities5kZip);

const selectedIds = new Set(); // track geoname IDs for alternate-name pass

for await (const line of readZippedLines(cities5kZip)) {
  const cols = line.split("\t");
  if (cols.length < 15) continue;
  const [id, name] = cols;
  const key = normalize(name);
  if (!key) continue;
  if (!map[key]) map[key] = name;
  selectedIds.add(id);
}
console.log(`  ${selectedIds.size} cities loaded`);

// ── 2. Countries ────────────────────────────────────────────────────────────
console.log("\n[2/5] Countries");
const countryFile = join(CACHE_DIR, "countryInfo.txt");
await download("https://download.geonames.org/export/dump/countryInfo.txt", countryFile);

const countryIds = new Set();
for await (const line of readLines(countryFile)) {
  if (line.startsWith("#")) continue;
  const cols = line.split("\t");
  if (cols.length < 17) continue;
  const name = cols[4];
  const geonameId = cols[16];
  const key = normalize(name);
  if (!key) continue;
  if (!map[key]) map[key] = name;
  if (geonameId) { selectedIds.add(geonameId); countryIds.add(geonameId); }
}
console.log(`  ${countryIds.size} countries loaded`);

// ── 3. Admin level 1 (states, provinces, regions) ──────────────────────────
console.log("\n[3/5] Admin level-1 regions");
const admin1File = join(CACHE_DIR, "admin1CodesASCII.txt");
await download("https://download.geonames.org/export/dump/admin1CodesASCII.txt", admin1File);

const adminIds = new Set();
for await (const line of readLines(admin1File)) {
  const cols = line.split("\t");
  if (cols.length < 4) continue;
  const name = cols[1];
  const geonameId = cols[3]?.trim();
  const key = normalize(name);
  if (!key) continue;
  if (!map[key]) map[key] = name;
  if (geonameId) { selectedIds.add(geonameId); adminIds.add(geonameId); }
}
console.log(`  ${adminIds.size} regions loaded`);

// ── 4. India locality bundle (cities/towns) ─────────────────────────────────
console.log("\n[4/6] India localities (cities/towns)");
const indiaLocalitiesZip = join(CACHE_DIR, "india-localities.zip");
await download("https://www.geoapify.com/data-share/localities/in.zip", indiaLocalitiesZip);

let indiaLocalityCount = 0;
let indiaLocalityAliasCount = 0;
for await (const line of readGeoapifyLocalityLines(indiaLocalitiesZip)) {
  const trimmed = line.trim();
  if (!trimmed) continue;

  const place = JSON.parse(trimmed);
  const canonicalName = typeof place.name === "string" ? place.name.trim() : "";
  const canonicalKey = normalize(canonicalName);
  if (!canonicalKey || canonicalKey.length < 2) continue;

  if (!map[canonicalKey]) {
    map[canonicalKey] = canonicalName;
    indiaLocalityCount++;
  }

  const otherNames = place.other_names;
  if (!otherNames || typeof otherNames !== "object") continue;

  for (const [aliasKeyName, value] of Object.entries(otherNames)) {
    if (aliasKeyName !== "old_name" && aliasKeyName !== "name:en") continue;
    if (typeof value !== "string") continue;
    for (const alias of value.split(/[;,|]/)) {
      const aliasName = alias.trim();
      const aliasKey = normalize(aliasName);
      if (!aliasKey || aliasKey.length < 2 || map[aliasKey]) continue;
      map[aliasKey] = canonicalName;
      indiaLocalityAliasCount++;
    }
  }
}
console.log(`  ${indiaLocalityCount} India locality names loaded`);
console.log(`  ${indiaLocalityAliasCount} India locality aliases added`);

// ── 5. Geographic features: rivers, lakes, mountains, islands, seas ─────────
console.log("\n[5/6] Geographic features (rivers/lakes/mountains/islands/seas)");
const allCountriesZip = join(CACHE_DIR, "allCountries.zip");
await download("https://download.geonames.org/export/dump/allCountries.zip", allCountriesZip);

// Feature classes/codes we want — much tighter filter than before:
// H: OCN/SEA/BAY/GULF (all — only ~200 globally), LK/LKS (lakes with pop > 0)
// T: MT/MTS (mountains — elevation > 3000m only), ISL (islands — pop > 1000)
// L: CONT (continents — only 7)
// NOTE: rivers (H.STM) excluded — too many low-quality entries; covered via alternate names
const WANTED_FEATURES = new Set([
  "H.OCN","H.SEA","H.BAY","H.GULF","H.CHAN",
  "H.LK","H.LKS",
  "T.MT","T.MTS","T.ISL","T.ISLS",
  "L.CONT",
]);

let featCount = 0;
for await (const line of readZippedLines(allCountriesZip)) {
  const cols = line.split("\t");
  if (cols.length < 17) continue;
  const geoId   = cols[0];
  const name    = cols[1];
  const fClass  = cols[6];
  const fCode   = cols[7];
  const pop     = parseInt(cols[14], 10) || 0;
  const elev    = parseInt(cols[15], 10) || parseInt(cols[16], 10) || 0;
  const fKey = `${fClass}.${fCode}`;
  if (!WANTED_FEATURES.has(fKey)) continue;

  // Per-type significance filters:
  if (fKey === "T.MT" || fKey === "T.MTS") {
    if (elev < 3000) continue;             // only notable mountains
  } else if (fKey === "T.ISL" || fKey === "T.ISLS") {
    if (pop < 1000) continue;              // only inhabited islands
  } else if (fKey === "H.LK" || fKey === "H.LKS") {
    if (pop === 0) continue;               // only lakes with known population nearby
  }
  // OCN, SEA, BAY, GULF, CHAN, CONT → include all

  const key = normalize(name);
  if (!key || key.length < 3) continue;
  if (!map[key]) { map[key] = name; featCount++; }
  selectedIds.add(geoId);
}
console.log(`  ${featCount} geographic features loaded`);

// ── 6. English alternate names (preferred/short only) ───────────────────────
console.log("\n[6/6] English alternate names (preferred + short)");
const altNamesZip = join(CACHE_DIR, "alternateNamesV2.zip");
await download("https://download.geonames.org/export/dump/alternateNamesV2.zip", altNamesZip);

// Format: altNameId \t geonameid \t isoLanguage \t alternateName \t isPreferredName \t isShortName \t ...
let altCount = 0;
for await (const line of readZippedLines(altNamesZip)) {
  const cols = line.split("\t");
  if (cols.length < 6) continue;
  const [, geonameid, isoLang, altName, isPref, isShort] = cols;
  if (isoLang !== "en") continue;
  if (isPref !== "1" && isShort !== "1") continue;
  if (!selectedIds.has(geonameid)) continue;
  const key = normalize(altName);
  if (!key || key.length < 2) continue;
  if (!map[key]) {
    // Find canonical display name: look up by id in our map via reverse scan isn't efficient,
    // so just store the altName itself as display (it's the preferred English name)
    map[key] = altName;
    altCount++;
  }
}
console.log(`  ${altCount} alternate name keys added`);

// ── Alias expansion: strip common geographic prefixes ───────────────────────
// Allows users to type "Everest" instead of "Mount Everest", "Nile" instead of "River Nile", etc.
const PREFIX_PATTERNS = [
  /^mount\s+/i, /^mt\.?\s+/i, /^lake\s+/i, /^river\s+/i,
  /^sea\s+of\s+/i, /^gulf\s+of\s+/i, /^bay\s+of\s+/i,
  /^cape\s+/i, /^island\s+of\s+/i,
];
const SUFFIX_PATTERNS = [
  /\s+river$/i, /\s+lake$/i, /\s+mountain[s]?$/i,
  /\s+island[s]?$/i, /\s+sea$/i, /\s+ocean$/i,
  /\s+gulf$/i, /\s+bay$/i,
];
let aliasCount = 0;
for (const [, display] of Object.entries(map)) {
  let stripped = null;
  for (const pat of PREFIX_PATTERNS) {
    if (pat.test(display)) { stripped = display.replace(pat, ""); break; }
  }
  if (!stripped) {
    for (const pat of SUFFIX_PATTERNS) {
      if (pat.test(display)) { stripped = display.replace(pat, ""); break; }
    }
  }
  if (stripped && stripped.length >= 3) {
    const aliasKey = normalize(stripped);
    if (aliasKey && !map[aliasKey]) {
      map[aliasKey] = display; // alias points to full display name
      aliasCount++;
    }
  }
}
console.log(`  ${aliasCount} prefix/suffix aliases added`);

// ── Build byFirstLetter buckets ─────────────────────────────────────────────
console.log("\nBuilding first-letter buckets...");
const byFirstLetter = {};
for (const key of Object.keys(map)) {
  const letter = key[0];
  if (!letter) continue;
  if (!byFirstLetter[letter]) byFirstLetter[letter] = [];
  byFirstLetter[letter].push(key);
}
// Sort each bucket for consistency
for (const letter of Object.keys(byFirstLetter)) {
  byFirstLetter[letter].sort();
}

// ── Summary ─────────────────────────────────────────────────────────────────
const totalKeys = Object.keys(map).length;
console.log(`\n✅ Total keys: ${totalKeys.toLocaleString()}`);
for (const [l, arr] of Object.entries(byFirstLetter).sort()) {
  process.stdout.write(`   ${l}: ${arr.length}  `);
}
console.log();

// ── Write output ─────────────────────────────────────────────────────────────
const output = JSON.stringify({ map, byFirstLetter });
const bytes = Buffer.byteLength(output);
writeFileSync(OUT_FILE, output, "utf-8");
console.log(`\n📦 Written to public/places.json (${(bytes / 1024).toFixed(0)} KB uncompressed)`);
console.log("   Data source: GeoNames (https://www.geonames.org/) — CC BY 4.0");
