import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_STATUS_FILE = join(ROOT, "data", "place-pipeline-status.json");
const OUT_APPROVALS_FILE = join(ROOT, "data", "approved-country-additions.json");
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
    openRequests: [],
    approvedCountries: [],
    needsReview: [],
    totals: { open: 0, approved: 0, review: 0 },
  });
  const approved = Array.isArray(status?.approvedCountries) ? status.approvedCountries : [];
  const existingOpen = Array.isArray(existingStatus.openRequests) ? existingStatus.openRequests : [];
  const existingApproved = Array.isArray(existingStatus.approvedCountries) ? existingStatus.approvedCountries : [];
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
    [...existingOpen, ...existingApproved, ...existingReview, ...(Array.isArray(status?.openRequests) ? status.openRequests : []), ...approved, ...(Array.isArray(status?.needsReview) ? status.needsReview : [])]
      .map((entry) => [String(entry?.requestedKey ?? entry?.requestedName ?? entry?.id ?? "").toLowerCase(), entry])
      .filter(([key]) => key),
  );

  const mergedStatus = {
    ...existingStatus,
    ...status,
    openRequests: [...mergedStatusRecords.values()].filter((entry) => entry.status !== "approved"),
    approvedCountries: [...mergedStatusRecords.values()].filter((entry) => entry.status === "approved"),
    needsReview: [...mergedStatusRecords.values()].filter((entry) => entry.status === "review"),
  };

  mergedStatus.updatedAt = mergedStatus.updatedAt ?? existingStatus.updatedAt ?? new Date().toISOString();
  mergedStatus.totals = {
    open: mergedStatus.openRequests.length,
    approved: mergedStatus.approvedCountries.length,
    review: mergedStatus.needsReview.length,
  };

  writeJson(OUT_STATUS_FILE, mergedStatus);
  writeJson(OUT_APPROVALS_FILE, {
    updatedAt: new Date().toISOString(),
    entries: [...merged.values()].sort((a, b) => a.requestedName.localeCompare(b.requestedName)),
  });

  console.log(`Synced place pipeline: ${mergedStatus.totals.approved} approved, ${mergedStatus.totals.review} review`);
}

await main();
