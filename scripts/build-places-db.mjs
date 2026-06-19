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

import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { pipeline } from "stream/promises";
import { createInterface } from "readline";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, ".places-cache");
const OUT_FILE = join(ROOT, "public", "places.json");
const APPROVALS_FILE = join(ROOT, "data", "approved-country-additions.json");

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

function prepareHdxPlaceTsv(zipPath) {
  const dir = dirname(zipPath);
  const outPath = join(dir, "hotosm_ind_populated_places.tsv");
  const jqFilter =
    '.features[] | select(.properties.place != null and .properties.name != null and (.properties.place == "city" or .properties.place == "town" or .properties.place == "village" or .properties.place == "hamlet" or .properties.place == "suburb" or .properties.place == "neighbourhood" or .properties.place == "locality" or .properties.place == "isolated_dwelling" or .properties.place == "quarter")) | [.properties.name, (.properties.name_en // ""), (.properties.name_latin // ""), .properties.place, (.properties.adm1_name // ""), (.properties.adm2_name // ""), (.properties.adm3_name // ""), (.properties.adm4_name // "")] | @tsv';

  execSync(
    `unzip -p "${zipPath}" populated_places.geojson | jq -r '${jqFilter}' > "${outPath}"`,
    { stdio: "pipe" },
  );

  return outPath;
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

// ── 4. India populated places (cities/towns/villages/hamlets) ──────────────
console.log("\n[4/6] India populated places");
const hdxZip = join(CACHE_DIR, "hotosm_ind_populated_places_osm_geojson.zip");
await download(
  "https://production-raw-data-api.s3.amazonaws.com/ISO3/IND/populated_places/hotosm_ind_populated_places_osm_geojson.zip",
  hdxZip,
);
const hdxTsv = prepareHdxPlaceTsv(hdxZip);

const INDIA_RENAME_ALIASES = {
  allahabad: "Prayagraj",
  bangalore: "Bengaluru",
  bombay: "Mumbai",
  calcutta: "Kolkata",
  cochin: "Kochi",
  cawnpore: "Kanpur",
  gurgaon: "Gurugram",
  madras: "Chennai",
  mysore: "Mysuru",
  poona: "Pune",
  trivandrum: "Thiruvananthapuram",
  pondicherry: "Puducherry",
  baroda: "Vadodara",
};

let indiaPlaceCount = 0;
let indiaAliasCount = 0;

for await (const line of readLines(hdxTsv)) {
  const cols = line.split("\t");
  if (cols.length < 8) continue;

  const [name, nameEn, nameLatin, , adm1Name, adm2Name, adm3Name, adm4Name] = cols;
  const displayName = [nameEn, nameLatin, name].find((value) => value && value.trim())?.trim() ?? "";
  const canonicalKey = normalize(displayName);
  if (!canonicalKey || canonicalKey.length < 2) continue;

  if (!map[canonicalKey]) {
    map[canonicalKey] = displayName;
    indiaPlaceCount++;
  }

  const aliasCandidates = [
    name,
    nameEn,
    nameLatin,
    adm1Name,
    adm2Name,
    adm3Name,
    adm4Name,
  ];

  for (const candidate of aliasCandidates) {
    if (typeof candidate !== "string") continue;
    const alias = candidate.trim();
    const aliasKey = normalize(alias);
    if (!aliasKey || aliasKey.length < 2 || aliasKey === canonicalKey || map[aliasKey]) continue;
    map[aliasKey] = displayName;
    indiaAliasCount++;
  }
}

for (const [aliasKeyName, displayName] of Object.entries(INDIA_RENAME_ALIASES)) {
  const aliasKey = normalize(aliasKeyName);
  const displayKey = normalize(displayName);
  if (!aliasKey || !displayKey || !map[displayKey]) continue;
  if (!map[aliasKey]) {
    map[aliasKey] = map[displayKey];
    indiaAliasCount++;
  }
}

console.log(`  ${indiaPlaceCount} India place names loaded`);
console.log(`  ${indiaAliasCount} India aliases added`);

// ── 4b. Approved country aliases from the place-request pipeline ────────────
let approvalCount = 0;
if (existsSync(APPROVALS_FILE)) {
  try {
    const approvals = JSON.parse(readFileSync(APPROVALS_FILE, "utf8"));
    const entries = Array.isArray(approvals?.entries) ? approvals.entries : [];

    for (const entry of entries) {
      const requestedName = typeof entry?.requestedName === "string" ? entry.requestedName.trim() : "";
      const canonicalName = typeof entry?.canonicalName === "string" ? entry.canonicalName.trim() : "";
      const requestedKey = normalize(requestedName);
      const canonicalKey = normalize(canonicalName);

      if (!requestedKey || !canonicalKey) continue;
      if (!map[canonicalKey]) {
        map[canonicalKey] = canonicalName;
      }
      if (!map[requestedKey]) {
        map[requestedKey] = canonicalName;
        approvalCount++;
      }
    }
  } catch (error) {
    console.warn(`  ! could not read approved-country-additions.json: ${error instanceof Error ? error.message : error}`);
  }
}
console.log(`  ${approvalCount} approved country aliases loaded`);

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
