import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

import { execFileSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const CACHE_DIR = join(ROOT, ".vosk-cache");
const MODEL_ZIP_NAME = "vosk-model-small-en-us-0.15.zip";
const MODEL_URL = `https://alphacephei.com/vosk/models/${MODEL_ZIP_NAME}`;
const ASSET_DIR = join(ROOT, "android", "app", "src", "main", "assets");
const ASSET_ZIP_PATH = join(ASSET_DIR, MODEL_ZIP_NAME);
const CACHE_ZIP_PATH = join(CACHE_DIR, MODEL_ZIP_NAME);

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(ASSET_DIR, { recursive: true });

if (!existsSync(CACHE_ZIP_PATH)) {
  console.log(`↓ downloading Vosk model: ${MODEL_URL}`);
  execFileSync("curl", ["-L", "-o", CACHE_ZIP_PATH, MODEL_URL], { stdio: "inherit" });
} else {
  console.log(`✓ cached: ${MODEL_ZIP_NAME}`);
}

if (!existsSync(ASSET_ZIP_PATH)) {
  console.log(`→ copying model into Android assets`);
  execFileSync("cp", [CACHE_ZIP_PATH, ASSET_ZIP_PATH], { stdio: "inherit" });
} else {
  console.log(`✓ Android asset already present: ${MODEL_ZIP_NAME}`);
}
