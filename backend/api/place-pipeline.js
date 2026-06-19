import { existsSync, readFileSync } from "fs";
import { join } from "path";

const STATUS_FILE_CANDIDATES = [
  join(process.cwd(), "data", "place-pipeline-status.json"),
  join(process.cwd(), "..", "data", "place-pipeline-status.json"),
];

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

function readJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return fallback;
  }
}

export default function handler(req, res) {
  setCors(res);
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  const statusFile = STATUS_FILE_CANDIDATES.find((path) => existsSync(path)) ?? STATUS_FILE_CANDIDATES[0];
  const status = readJson(statusFile, {
    updatedAt: null,
    source: "github-issues",
    openRequests: [],
    approvedCountries: [],
    needsReview: [],
    totals: { open: 0, approved: 0, review: 0 },
  });

  return res.json(status);
}
