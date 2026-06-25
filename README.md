# Atlas Junior

A turn-based kids geography word-chain game. Players take turns naming places that start with the last letter of the previous place. Supports voice input, offline place validation, a global leaderboard, and in-app support.

Available as:
- **Android app** — [Google Play Store](https://play.google.com/store/apps/details?id=com.fibuladreams.atlas) (v1.0.21)
- **Web app** — [atlas-junior.vercel.app/game](https://atlas-junior.vercel.app/game)

---

## Architecture overview

```
atlas-junior/                  ← Next.js app (frontend + Capacitor source)
├── app/                       ← Next.js App Router pages
│   ├── page.tsx               ← game (renders AtlasGame component)
│   ├── leaderboard/page.tsx
│   ├── support/page.tsx
│   └── privacy/page.tsx
├── components/
│   └── AtlasGame.tsx          ← all game logic, speech recognition, UI (~1400 lines)
├── lib/
│   ├── api.ts                 ← typed API client (leaderboard, support form, place pipeline)
│   ├── places.ts              ← offline place validation (loads places.json)
│   └── version.ts             ← APP_VERSION — single source of truth
├── public/
│   └── places.json            ← 142k GeoNames place keys, ~6.4MB (offline dict)
├── scripts/
│   ├── build-places-db.mjs    ← downloads GeoNames, builds places.json
│   └── test-places.mjs        ← 27 functional tests for place validation
├── android/                   ← Capacitor Android project
│   └── app/build.gradle       ← versionCode + versionName
├── backend/                   ← Vercel project root
│   ├── api/
│   │   ├── leaderboard.js     ← Upstash Redis leaderboard (GET + POST)
│   │   ├── tickets.js         ← GitHub Issues support form submissions (GET + POST)
│   │   ├── place-pipeline.js  ← place request intake + approval API (GET + POST)
│   │   └── stats.js
│   ├── public/
│   │   ├── index.html         ← landing page
│   │   └── game/              ← static Next.js export for /game route (committed)
│   └── vercel.json            ← rewrites for /game sub-routes
├── capacitor.config.ts        ← webDir: "out"
├── next.config.ts             ← conditional basePath via NEXT_PUBLIC_BASE_PATH
└── .vercelignore              ← excludes node_modules, android, .places-cache, etc.
```

---

## Dual-build pattern (CRITICAL)

The same Next.js codebase produces **two different builds**:

| Build | Command | basePath | Output | Used by |
|-------|---------|----------|--------|---------|
| Capacitor (APK) | `npm run build` | _(none)_ | `out/` | `cap sync android` |
| Web game | `npm run build:web` | `/game` | `out/` → `backend/public/game/` | Vercel |

**⚠️ Never run `deploy:web` before building the APK.**
`deploy:web` writes `/game`-prefixed paths into `out/`. If Capacitor copies those files, all CSS and JS paths break in the webview (app renders as unstyled plain HTML).

**Always re-run `npm run build` (no basePath) immediately before `cap sync`.**

---

## Run locally

```bash
npm install
npm run dev        # Next.js dev server at http://localhost:3000
```

---

## Build the Android APK / AAB

Java 21 is required (Capacitor sets `VERSION_21` in the Gradle config). macOS default is often Java 17.

```bash
# 1. Build Next.js — plain, no basePath
npm run build

# 2. Sync to Android
npx cap sync android

# 3. Build (always prefix with Java 21)
cd android
JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew assembleRelease bundleRelease
```

Outputs:
- `android/app/build/outputs/apk/release/app-release.apk`
- `android/app/build/outputs/bundle/release/app-release.aab`

### Version bump checklist
1. `lib/version.ts` — update `APP_VERSION`
2. `android/app/build.gradle` — increment `versionCode`, update `versionName` to match

---

## Deploy the web game to Vercel

```bash
# Build with /game basePath + copy static export to backend/public/game/
npm run deploy:web

# Push — Vercel auto-deploys from changes to backend/
git add -A && git commit -m "..." && git push
```

If Vercel auto-deploy is stuck, check for zombie deployments:
```bash
npx vercel ls --prod
# If any show "Initializing" for 10+ min, cancel it:
npx vercel remove <deployment-url> --yes
```

---

## Places dictionary

The game validates place names offline using a bundled GeoNames dictionary.

```bash
# Rebuild from scratch (downloads ~700MB to .places-cache/, takes 5-10 min first run)
node scripts/build-places-db.mjs

# Run validation tests (27 tests)
node scripts/test-places.mjs
```

The `.places-cache/` directory is gitignored. `public/places.json` (the output) **is** committed.

### Request pipeline

Place requests go through `/api/place-pipeline`. The API auto-approves current-country matches from REST Countries, stores approved overlays in `data/approved-country-additions.json`, and exposes the live queue at `/game/pipeline`.
The GitHub Actions workflow in `.github/workflows/place-dictionary-pipeline.yml` keeps the repo copy in sync on a schedule, so the pipeline runs even if the local machine is off.

---

## Key features (current — v1.0.21)

- **Voice-first gameplay** — tap microphone, speak a place name, and auto-save when speech stops or pauses
- **Offline place validation** — bundled GeoNames dictionary with fuzzy "Did you mean?" suggestions
- **Turn timer + stricter rules** — shared countdown timer, auto-skip on timeout, and tighter duplicate/save validation
- **Leaderboard + support** — Upstash Redis leaderboard, GitHub Issues support tickets, and live place-request pipeline
- **Notifications v2** — in-app bell, unread count, read-state fading, deep links, and Android push alerts
- **Mobile-friendly UI** — polished cards, flying save animation, and version footer across web + APK

---

## Linting and type checks

```bash
npm run lint
npm run build   # includes TypeScript check
```
