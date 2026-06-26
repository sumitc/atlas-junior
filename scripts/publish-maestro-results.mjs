import fs from "node:fs";
import path from "node:path";

function arg(name, fallback = "") {
  const prefix = `--${name}=`;
  const entry = process.argv.slice(2).find((value) => value.startsWith(prefix));
  return entry ? entry.slice(prefix.length) : fallback;
}

const reportDir = arg("reportDir", "maestro-results");
const appId = arg("appId", "com.fibuladreams.atlas");
const suiteName = arg("suiteName", "atlas-smoke");
const outputFile = arg("outputFile", path.join(reportDir, "report.json"));
const startedAt = arg("startedAt", new Date().toISOString());
const buildVersionMatch = fs.readFileSync(new URL("../lib/version.ts", import.meta.url), "utf8").match(/APP_VERSION\s*=\s*"([^"]+)"/);
const buildVersion = buildVersionMatch?.[1] ?? "unknown";

const cases = ["startup", "gameplay", "navigation"].map((name) => {
  const statusPath = path.join(reportDir, `${name}.status`);
  const rawPath = path.join(reportDir, `${name}.txt`);
  const logPath = fs.existsSync(rawPath) ? fs.readFileSync(rawPath, "utf8") : "";
  const status = fs.existsSync(statusPath) ? fs.readFileSync(statusPath, "utf8").trim() : "fail";

  return {
    name,
    status: status === "pass" ? "pass" : "fail",
    durationMs: 0,
    message: logPath.trim().slice(0, 2000) || undefined,
  };
});

const report = {
  appId,
  buildVersion,
  suiteName,
  platform: "android",
  device: process.env.AVD_NAME ?? "",
  startedAt,
  finishedAt: new Date().toISOString(),
  passed: cases.filter((testCase) => testCase.status === "pass").length,
  failed: cases.filter((testCase) => testCase.status === "fail").length,
  steps: cases,
};

fs.mkdirSync(path.dirname(outputFile), { recursive: true });
fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
console.log(outputFile);
