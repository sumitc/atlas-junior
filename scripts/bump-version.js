#!/usr/bin/env node
// Bumps versionCode (+1) and versionName (patch +1) in android/app/build.gradle
// Run automatically as part of aab:release

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const gradlePath = resolve(__dirname, "../android/app/build.gradle");

let gradle = readFileSync(gradlePath, "utf8");

// Bump versionCode
const codeMatch = gradle.match(/versionCode\s+(\d+)/);
if (!codeMatch) { console.error("❌ versionCode not found"); process.exit(1); }
const oldCode = parseInt(codeMatch[1], 10);
const newCode = oldCode + 1;
gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${newCode}`);

// Bump versionName patch (e.g. 1.0.0 → 1.0.1)
const nameMatch = gradle.match(/versionName\s+"(\d+)\.(\d+)\.(\d+)"/);
if (!nameMatch) { console.error("❌ versionName not found (expected X.Y.Z format)"); process.exit(1); }
const [major, minor, patch] = [nameMatch[1], nameMatch[2], nameMatch[3]];
const newName = `${major}.${minor}.${parseInt(patch, 10) + 1}`;
gradle = gradle.replace(/versionName\s+"\d+\.\d+\.\d+"/, `versionName "${newName}"`);

writeFileSync(gradlePath, gradle, "utf8");
console.log(`✅ Version bumped: ${major}.${minor}.${patch} (${oldCode}) → ${newName} (${newCode})`);
