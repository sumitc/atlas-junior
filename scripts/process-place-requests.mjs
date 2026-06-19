import { existsSync, mkdirSync, readFileSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const REPO = process.env.GITHUB_REPO || "sumitc/atlas-junior";
const TOKEN = process.env.GITHUB_TOKEN;
const REQUESTS_FILE = join(ROOT, "data", "approved-country-additions.json");
const STATUS_FILE = join(ROOT, "data", "place-pipeline-status.json");

if (!TOKEN) {
  throw new Error("GITHUB_TOKEN is required");
}

function normalize(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z]/g, "");
}

function extractRequestedName(issue) {
  const title = String(issue?.title ?? "");
  const titleMatch = title.match(/^Add place request:\s*(.+)$/i);
  if (titleMatch?.[1]) {
    return titleMatch[1].trim();
  }

  const body = String(issue?.body ?? "");
  const bodyMatch = body.match(/Please add\s+"([^"]+)"/i);
  if (bodyMatch?.[1]) {
    return bodyMatch[1].trim();
  }

  return "";
}

async function fetchAllOpenIssues() {
  const issues = [];
  for (let page = 1; page <= 10; page++) {
    const res = await fetch(
      `https://api.github.com/repos/${REPO}/issues?labels=atlas-app&state=open&per_page=100&page=${page}`,
      {
        headers: {
          Authorization: `Bearer ${TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
        },
      },
    );
    if (!res.ok) {
      throw new Error(`GitHub issues ${res.status}`);
    }
    const batch = await res.json();
    if (!Array.isArray(batch) || batch.length === 0) break;
    issues.push(...batch.filter((issue) => !issue.pull_request));
    if (batch.length < 100) break;
  }
  return issues;
}

async function resolveCountry(requestedName) {
  const response = await fetch(`https://restcountries.com/v3.1/name/${encodeURIComponent(requestedName)}`);
  if (!response.ok) return null;
  const data = await response.json();
  if (!Array.isArray(data)) return null;

  const requestedKey = normalize(requestedName);
  for (const item of data) {
    const common = String(item?.name?.common ?? "").trim();
    const official = String(item?.name?.official ?? "").trim();
    const altSpellings = Array.isArray(item?.altSpellings) ? item.altSpellings : [];
    const allNames = [common, official, ...altSpellings].map((name) => [name, normalize(name)]).filter(([, key]) => key);
    if (allNames.some(([, key]) => key === requestedKey)) {
      return {
        requestedName,
        canonicalName: common || official || requestedName,
        source: "restcountries",
      };
    }
  }

  return null;
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

function writePretty(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const issues = await fetchAllOpenIssues();
const openRequests = [];
const approvedCountries = [];
const needsReview = [];

for (const issue of issues) {
  const requestedName = extractRequestedName(issue);
  if (!requestedName) continue;

  const existing = {
    number: issue.number,
    title: issue.title,
    url: issue.html_url,
    requestedName,
    createdAt: issue.created_at,
  };

  openRequests.push(existing);
  const resolved = await resolveCountry(requestedName);

  if (resolved) {
    approvedCountries.push({
      ...existing,
      canonicalName: resolved.canonicalName,
      source: resolved.source,
    });
  } else {
    needsReview.push({
      ...existing,
      reason: "Did not resolve as a current country via REST Countries",
    });
  }
}

const approvals = readJson(REQUESTS_FILE, { updatedAt: null, entries: [] });
const existingEntries = Array.isArray(approvals.entries) ? approvals.entries : [];
const mergedEntries = new Map(
  existingEntries.map((entry) => [normalize(entry?.requestedName), entry]),
);

for (const item of approvedCountries) {
  const key = normalize(item.requestedName);
  if (!key) continue;
  mergedEntries.set(key, {
    requestedName: item.requestedName,
    canonicalName: item.canonicalName,
    issueNumber: item.number,
    issueUrl: item.url,
    source: item.source,
    updatedAt: new Date().toISOString(),
  });
}

const nextApprovals = {
  updatedAt: new Date().toISOString(),
  entries: [...mergedEntries.values()].sort((a, b) =>
    a.requestedName.localeCompare(b.requestedName),
  ),
};

const pipelineStatus = {
  updatedAt: new Date().toISOString(),
  source: "github-issues",
  openRequests,
  approvedCountries,
  needsReview,
  totals: {
    open: openRequests.length,
    approved: approvedCountries.length,
    review: needsReview.length,
  },
};

writePretty(REQUESTS_FILE, nextApprovals);
writePretty(STATUS_FILE, pipelineStatus);

console.log(`Processed ${openRequests.length} place requests`);
console.log(`Approved countries: ${approvedCountries.length}`);
console.log(`Needs review: ${needsReview.length}`);
