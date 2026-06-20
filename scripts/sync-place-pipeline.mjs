import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_STATUS_FILE = join(ROOT, "data", "place-pipeline-status.json");
const OUT_APPROVALS_FILE = join(ROOT, "data", "approved-country-additions.json");
const OUT_DICT_VERSION_JSON = join(ROOT, "data", "place-dictionary-version.json");
const OUT_DICT_VERSION_JS = join(ROOT, "backend", "api", "place-dictionary-version.js");
const OUT_DICT_VERSION_TS = join(ROOT, "lib", "place-dictionary-version.ts");
const BASE_URL = process.env.NEXT_PUBLIC_API_URL || "https://atlas-junior.vercel.app";

function ensureDir(path) {
  mkdirSync(dirname(path), { recursive: true });
}

function writeJson(path, value) {
  ensureDir(path);
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writeDictionaryVersion(version, approvedCount) {
  const payload = {
    version,
    updatedAt: version,
    approvedCount,
  };
  writeJson(OUT_DICT_VERSION_JSON, payload);
  ensureDir(OUT_DICT_VERSION_JS);
  writeFileSync(OUT_DICT_VERSION_JS, `export const PLACE_DICTIONARY_VERSION = "${version}";\n`, "utf8");
  ensureDir(OUT_DICT_VERSION_TS);
  writeFileSync(OUT_DICT_VERSION_TS, `export const PLACE_DICTIONARY_VERSION = "${version}";\n`, "utf8");
}

async function main() {
  const res = await fetch(`${BASE_URL}/api/place-pipeline`);
  if (!res.ok) {
    console.warn(`⚠️  Could not sync place pipeline from ${BASE_URL}: HTTP ${res.status}`);
    return;
  }

  const status = await res.json();
  const existingStatus = readJson(OUT_STATUS_FILE, {
    updatedAt: null,
    source: "redis+repo",
    endpoint: "/api/place-pipeline",
    dictionaryVersion: null,
    openRequests: [],
    approvedCountries: [],
    rejectedRequests: [],
    needsReview: [],
    totals: { open: 0, approved: 0, rejected: 0, review: 0 },
  });
  const approved = Array.isArray(status?.approvedCountries) ? status.approvedCountries : [];
  const rejected = Array.isArray(status?.rejectedRequests) ? status.rejectedRequests : [];
  const existingOpen = Array.isArray(existingStatus.openRequests) ? existingStatus.openRequests : [];
  const existingApproved = Array.isArray(existingStatus.approvedCountries) ? existingStatus.approvedCountries : [];
  const existingRejected = Array.isArray(existingStatus.rejectedRequests) ? existingStatus.rejectedRequests : [];
  const existingReview = Array.isArray(existingStatus.needsReview) ? existingStatus.needsReview : [];
  const existing = readJson(OUT_APPROVALS_FILE, { updatedAt: null, entries: [] });
  const merged = new Map(
    (Array.isArray(existing.entries) ? existing.entries : []).map((entry) => [String(entry?.requestedKey ?? entry?.requestedName ?? "").toLowerCase(), entry]),
  );

  for (const entry of approved) {
    const key = String(entry?.requestedKey ?? entry?.requestedName ?? "").toLowerCase();
    if (!key) continue;
    merged.set(key, {
      requestedName: entry.requestedName,
      requestedKey: entry.requestedKey,
      canonicalName: entry.canonicalName,
      status: entry.status,
      source: entry.source,
      reason: entry.reason,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      details: entry.details ?? {},
    });
  }

  const mergedStatusRecords = new Map(
    [
      ...existingOpen,
      ...existingApproved,
      ...existingRejected,
      ...existingReview,
      ...(Array.isArray(status?.openRequests) ? status.openRequests : []),
      ...approved,
      ...rejected,
      ...(Array.isArray(status?.needsReview) ? status.needsReview : []),
    ]
      .map((entry) => [String(entry?.requestedKey ?? entry?.requestedName ?? entry?.id ?? "").toLowerCase(), entry])
      .filter(([key]) => key),
  );

  const approvedEntries = [...mergedStatusRecords.values()].filter((entry) => entry.status === "approved");
  const rejectedEntries = [...mergedStatusRecords.values()].filter((entry) => entry.status === "rejected");
  const reviewEntries = [...mergedStatusRecords.values()].filter((entry) => entry.status === "review");
  const mergedStatus = {
    ...existingStatus,
    ...status,
    openRequests: reviewEntries,
    approvedCountries: approvedEntries,
    rejectedRequests: rejectedEntries,
    needsReview: reviewEntries,
  };

  mergedStatus.updatedAt = mergedStatus.updatedAt ?? existingStatus.updatedAt ?? new Date().toISOString();
  mergedStatus.totals = {
    open: mergedStatus.openRequests.length,
    approved: mergedStatus.approvedCountries.length,
    rejected: mergedStatus.rejectedRequests.length,
    review: mergedStatus.needsReview.length,
  };

  const existingApprovedKeys = new Set(
    (Array.isArray(existingApproved) ? existingApproved : []).map((entry) => String(entry?.requestedKey ?? entry?.requestedName ?? entry?.id ?? "").toLowerCase()),
  );
  const nextApprovedKeys = new Set(
    approvedEntries.map((entry) => String(entry?.requestedKey ?? entry?.requestedName ?? entry?.id ?? "").toLowerCase()),
  );
  const approvedChanged =
    existingApprovedKeys.size !== nextApprovedKeys.size ||
    [...existingApprovedKeys].some((key) => !nextApprovedKeys.has(key));

  let dictVersion = existingStatus.dictionaryVersion ?? readJson(OUT_DICT_VERSION_JSON, { version: null }).version ?? null;
  if (approvedChanged) {
    dictVersion = new Date().toISOString();
  }
  mergedStatus.dictionaryVersion = dictVersion;
  if (dictVersion) {
    writeDictionaryVersion(dictVersion, approvedEntries.length);
  }

  writeJson(OUT_STATUS_FILE, mergedStatus);
  writeJson(OUT_APPROVALS_FILE, {
   updatedAt: new Date().toISOString(),
   entries: [...merged.values()].sort((a, b) => a.requestedName.localeCompare(b.requestedName)),
  });

  console.log(
    `Synced place pipeline: ${mergedStatus.totals.approved} approved, ${mergedStatus.totals.rejected} rejected, ${mergedStatus.totals.review} review`,
  );
}

await main();
