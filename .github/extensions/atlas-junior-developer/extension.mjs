// Extension: atlas-junior-developer
// Atlas Junior developer skill — architecture context, build commands, and project knowledge

import { joinSession } from "@github/copilot-sdk/extension";
import { execSync } from "child_process";

// ─── Project paths ────────────────────────────────────────────────────────────
const PROJECT_DIR  = "/Users/sumitc/projects/atlas-junior";
const BACKEND_DIR  = `${PROJECT_DIR}/backend`;
const BACKEND_URL  = "https://atlas-junior.vercel.app";

// ─── Architecture knowledge ───────────────────────────────────────────────────
const ARCHITECTURE = `
# Atlas Junior — Architecture Reference (updated 2026-05)

## Overview
Atlas Junior is a kids geography word game — a Capacitor Android APK with a Vercel serverless
backend. All game logic runs fully on-device (no server during gameplay). The server is only
hit for leaderboard, stats, and support tickets.

## Directory layout
- atlas-junior/                  → Git repo root, also the Next.js app
- atlas-junior/backend/          → Vercel serverless functions (deployed)
- atlas-junior/backend/api/      → Individual Vercel function handlers
- atlas-junior/components/       → React components (AtlasGame.tsx is the main one)
- atlas-junior/lib/              → Client-side helpers (api.ts = typed fetch wrappers)
- atlas-junior/app/              → Next.js App Router pages
- atlas-junior/android/          → Capacitor Android project (generated, don't hand-edit)

## LEGACY / DO NOT EDIT
- atlas-junior/  (the older atlas-app was never a thing — atlas-junior IS the app)

---

## Frontend

### Tech stack
- Next.js 16 with output: "export" (static HTML/JS, no server)
- React 19, TypeScript, Tailwind CSS v4
- Capacitor 7 for native Android bridge
- @capacitor-community/speech-recognition@7.0.1

### Build pipeline
- \`npm run cap:sync\`         → next build + npx cap sync  (debug builds, includes debug panel)
- \`npm run cap:sync:release\` → same but NEXT_PUBLIC_DEBUG_PANEL=false (strips debug panel)
- \`npm run apk:debug\`        → gradle assembleDebug
- \`npm run apk:release\`      → chains cap:sync:release then gradle assembleRelease
- APK output: android/app/build/outputs/apk/debug/app-debug.apk
- JAVA_HOME must be set: \$(brew --prefix openjdk@21)
- ⚠️  Always cap:sync BEFORE assembleDebug/Release — stale JS otherwise ships in APK.
- ⚠️  apk:release MUST chain cap:sync:release internally (it does — don't run them separately).

### Key env vars (.env.local — gitignored)
- NEXT_PUBLIC_API_URL=https://atlas-junior.vercel.app  (baked at build time)
- NEXT_PUBLIC_DEBUG_PANEL=true                          (set false for release builds)

### Key files
- components/AtlasGame.tsx       → entire game UI + end-game flow (largest file)
- lib/api.ts                     → submitScore(), submitStats(), getLeaderboard(), postTicket()
- app/page.tsx                   → home / game entry point
- app/leaderboard/page.tsx       → leaderboard view
- app/support/page.tsx           → support ticket form
- app/globals.css                → global styles + .app-safe-area-shell definition

### CORS note
Capacitor WebView origin is "http://localhost" — NOT a real domain.
Backend must use CORS * (origin whitelist breaks the app).

### Speech recognition
- Uses @capacitor-community/speech-recognition for native Android
- Browser Web Speech API used as fallback on web
- partialResults listener + listeningState listener
- stopListening(): always clears UI immediately, then awaits plugin (never blocks UI)
- dbg() helper logs to the in-app debug panel (gated by NEXT_PUBLIC_DEBUG_PANEL)

### Debug panel
- Gated by: {process.env.NEXT_PUBLIC_DEBUG_PANEL === "true" && <div>…</div>}
- This is a compile-time check — next build bakes the value from env at build time
- CLI env var (NEXT_PUBLIC_DEBUG_PANEL=false npm run build) overrides .env.local
- Debug panel is intentionally kept in debug builds and stripped from release builds
- DO NOT remove it from the codebase — it is very useful during device testing

### UI layout notes
- Fixed bottom bar: nav links (bottom-0, ~32px) + debug toggle (bottom-7, ~28px)
- app-safe-area-shell sets padding-bottom via CSS (for notch/safe-area)
- ⚠️  GOTCHA: Never put Tailwind padding classes on the same element as app-safe-area-shell
  — they both set padding-bottom and one will silently override the other.
  Solution: apply bottom padding (pb-36 etc.) to the INNER content div, not to <main>.
- Info/about button uses ℹ symbol (not ? — that was confusing)
- Share button hidden in native Capacitor builds (window.location.origin = "http://localhost")

### Mic area UI (current design)
- Mic button → dynamic caption below it (replaces separate speech feedback box)
- Caption shows: "Tap to speak" / "Listening… tap to stop" / "I heard: Delhi" / error message
- Caption colour reflects tone: green=success, red=error, blue=neutral
- Text input below for manual edits
- Save → "✓ Saved" flashes below Save button for 2s via savedFlash state + setTimeout

---

## Backend (Vercel serverless)

### Deployment
- Vercel project: atlas-junior (developsumit-4445s-projects)
- Production URL: https://atlas-junior.vercel.app
- Root directory in Vercel: backend/
- vercel.json: { "version": 2 } — minimal, sufficient
- Runtime: Node.js (default Vercel)

### Env vars (set in Vercel dashboard)
- UPSTASH_REDIS_REST_URL    → Upstash Redis REST endpoint
- UPSTASH_REDIS_REST_TOKEN  → Must be READ-WRITE token (not read-only!)
- GITHUB_TOKEN              → Fine-grained PAT, Issues: Read+write on sumitc/atlas-junior
- GITHUB_REPO               → sumitc/atlas-junior
- ⚠️  GOTCHA: Upstash has separate read-only and read-write REST tokens. If POST /api/stats
  returns {"error":"Could not save stats"} and Vercel logs show "NOPERM this user has…",
  the token is read-only. Replace with the main REST token from Upstash dashboard.

### API endpoints
| Method | Path              | Purpose                                      |
|--------|-------------------|----------------------------------------------|
| GET    | /api/health       | { ok: true } health check                    |
| GET    | /api/leaderboard  | Top-10 entries [{ id, name, score, date, rank }] |
| POST   | /api/leaderboard  | Submit score { name, score, date } → { entryId, rank, onLeaderboard } |
| GET    | /api/stats        | Global counters { games, turns }             |
| POST   | /api/stats        | Increment counters { turns }                 |
| POST   | /api/tickets      | Create GitHub Issue { subject, body, platform, appVersion } |

### Redis key schema (prefix: atlas:)
- atlas:lb           → Sorted set. Member = UUID, score = savedTurns (HIGHER = better)
- atlas:lb:{id}      → Hash. Fields: name, score, date
- atlas:stats:games  → Integer counter (total games played)
- atlas:stats:turns  → Integer counter (total turns across all games)
- atlas:ratelimit:{ip}:{window} → TTL key for ticket rate limiting (1 per 15 min per IP)

### Leaderboard pipeline (POST /api/leaderboard)
Pipeline order: [ZADD NX, HSET, ZREMRANGEBYRANK, ZREVRANK]
Destructure:    [,        ,     ,                  rank  ]  → index [3]
- ZADD NX: won't overwrite existing member (UUIDs always fresh so effectively always adds)
- ZREMRANGEBYRANK: prunes to top 10 (removes rank 10+, i.e. lowest scores)
- ZREVRANK: returns 0-based rank (0 = best). Add 1 for display.
- Score: ZADD stores savedTurns. ZREVRANGE returns HIGHEST first → rank 1 = most places = best.
- Server generates UUID for entryId (never trust client-supplied entryId).
- Qualification: entries.length < 10 || savedTurns >= entries[entries.length-1].score
  (>= handles ties correctly — ties qualify)

### Score semantics (IMPORTANT)
- score = savedTurns = number of moves where kind === "saved" (skips are excluded)
- HIGHER savedTurns = more places named = BETTER
- Redis ZREVRANGE returns highest score first → rank 1 = best player
- Do NOT confuse with "lower is better" — it is HIGHER IS BETTER

### Rate limiting (tickets.js) — lessons learned
- RATE_LIMIT = 1 per RATE_WINDOW_SEC = 900 (15 min per IP)
- ⚠️  GOTCHA: Original code only called EXPIRE when count === 1. If EXPIRE failed transiently
  after INCR, the key had NO TTL → permanent rate-limit for that IP (can never submit again).
  Fix: Promise.all([INCR, EXPIRE]) — always sets TTL on every request (sliding window, acceptable).
- Catch block must return 503 (fail closed), never fail open (allow through on Redis error).

### Stats
- Fire-and-forget from client (.catch(() => {}))
- Stats loss on network failure is acceptable (analytics only)
- 0-turn games still submit stats (statsSubmittedRef guards double-submit)
- statsSubmittedRef: useRef, set before network call, reset only in startGame()

### Support tickets
- Rate limit: 1 per IP per 15 min (Redis TTL key)
- GitHub label required: "atlas-app" (must exist in repo for tickets to appear)
  → Create with: gh label create "atlas-app" --repo sumitc/atlas-junior --color "0075ca"
- Creates GitHub Issue via REST API

---

## End-game flow (AtlasGame.tsx)

1. Game ends (all countries guessed or player resets)
2. openEndGame() called:
   a. statsSubmittedRef.current = true (prevents double-submit)
   b. submitStats(game.moves.length) — fire and forget
   c. Fetch current leaderboard
   d. Compute qualification: savedTurns qualifies if top-10
   e. Show end-game modal (no close/dismiss button — it is FINAL)
   f. ⚠️  openEndGame() MUST reset ALL modal state (not just result/loading):
      endGameResult, endGameLoading, endGameName, endGameSubmitting, endGameSubmitError,
      endGameResultRefetched — stale state from a previous game will corrupt the next.
3. If qualifies:
   a. Show team name input (default = playerNames.join(" - "))
   b. User edits name, taps Submit
   c. submitToLeaderboard() → POST /api/leaderboard
   d. On error: set endGameSubmitError=true (form stays visible, button becomes "Retry")
      ⚠️  Do NOT repurpose endGameResult for errors — it kills the form UI.
   e. On success: re-fetch leaderboard, show updated board with new entry highlighted
   f. "Skip & start new game" button available during loading (escape hatch)
4. User taps "New game" → returnToSetup() → startGame() (resets statsSubmittedRef)

---

## Known limitations / accepted debt
- Leaderboard metadata orphan: ZREMRANGEBYRANK prunes sorted set but leaves atlas:lb:{id} hashes.
  Cosmetic data leak at small scale — acceptable.
- Stats fire-and-forget: can be lost on network failure. Acceptable for analytics.
- Debug panel in APK: floating "show debug" button visible in debug builds. Intentional.
- No offline queue for leaderboard submissions. If POST fails, score is lost (Retry button shown).
- ZADD NX is technically dead code (UUIDs always fresh) but kept as belt-and-suspenders.
- Rate limit is sliding window (Promise.all always resets TTL) — acceptable for 1/15min limit.

---

## Gotchas / hard-won lessons (read before touching anything)

### CSS
1. app-safe-area-shell vs Tailwind padding:
   app-safe-area-shell in globals.css sets padding-bottom. If you also put a Tailwind pb-* class
   on the SAME element, one silently overrides the other (CSS cascade order).
   → Always put bottom padding on the INNER content div, not on the element with app-safe-area-shell.

2. Tailwind JIT only includes classes that appear in source files literally.
   Dynamic class names (template literals) may not be picked up — use full class names.

### Capacitor
3. window.location.origin = "http://localhost" inside the APK.
   Any feature that builds a URL from origin (share, deep link) is broken in native builds.
   → Check Capacitor.getPlatform() !== "web" and hide/disable such features in native.

4. JAVA_HOME must be set when running Gradle on macOS with Homebrew:
   JAVA_HOME=$(brew --prefix openjdk@21) ./gradlew assembleDebug

5. cap:sync MUST run before every APK build to copy latest web assets into the Android project.
   cap:sync:release runs next build with NEXT_PUBLIC_DEBUG_PANEL=false — compile-time strip.

### React state
6. Never repurpose a result/data state variable to signal error conditions.
   Use a separate boolean (e.g. endGameSubmitError). Overloading result with error shapes
   causes defensive code to miss checks and kills UI branches that depend on result being set.

7. Any modal/overlay opened multiple times must reset ALL its state on open, not just the main
   data fields. Easy to miss endGameSubmitting, endGameSubmitError etc. when adding new state.

### Redis / Vercel
8. Upstash read-only token: GET commands work but INCR/ZADD/HSET fail with NOPERM.
   The Upstash dashboard shows two tokens — always use the Read-Write REST token.

9. INCR then EXPIRE in separate Redis calls: if EXPIRE fails, the key has no TTL.
   Use Promise.all([INCR, EXPIRE]) to always set TTL, even if it creates a sliding window.

10. Vercel root directory must be set to "backend/" for serverless functions to deploy correctly.
    vercel.json needs only { "version": 2 } — do not add rewrites or builds.

---

## Common commands

\`\`\`bash
# Build and sync debug APK (full pipeline)
cd ~/projects/atlas-junior
npm run cap:sync
JAVA_HOME=\$(brew --prefix openjdk@21) npm run apk:debug

# Build release APK (strips debug panel — cap:sync:release is chained automatically)
JAVA_HOME=\$(brew --prefix openjdk@21) npm run apk:release

# Check backend health
curl https://atlas-junior.vercel.app/api/health

# Check leaderboard
curl https://atlas-junior.vercel.app/api/leaderboard

# Test stats write (will fail with NOPERM if token is read-only)
curl -X POST https://atlas-junior.vercel.app/api/stats \\
  -H "Content-Type: application/json" -d '{"turns":5}'

# Deploy backend changes to Vercel
cd ~/projects/atlas-junior/backend
vercel --prod

# View Vercel function logs
vercel logs --limit 30

# List Vercel env vars
vercel env ls

# Create atlas-app label (needed for support tickets)
gh label create "atlas-app" --repo sumitc/atlas-junior --color "0075ca" --description "Atlas Junior in-app feedback"
\`\`\`
`;

// ─── Server status check ──────────────────────────────────────────────────────
function checkBackendStatus() {
  try {
    const result = execSync(
      `curl -s --max-time 5 ${BACKEND_URL}/api/health`,
      { encoding: "utf8", timeout: 8000 }
    );
    const json = JSON.parse(result);
    return json.ok ? "✅ Backend is up" : "⚠️  Backend returned unexpected response";
  } catch {
    return "❌ Backend is unreachable";
  }
}

function getVercelLogs(lines = 20) {
  try {
    return execSync(
      `cd ${BACKEND_DIR} && vercel logs --limit ${lines} 2>&1`,
      { encoding: "utf8", timeout: 15000 }
    );
  } catch (e) {
    return `Error fetching logs: ${e.message}`;
  }
}

// ─── Extension registration ───────────────────────────────────────────────────
const session = await joinSession({
  hooks: {
    onSessionStart: async () => {
      return {
        additionalContext: `
You are working on the Atlas Junior project — a Capacitor Android kids geography word game.
Key facts:
- Frontend (Next.js static export + Capacitor): ${PROJECT_DIR}
- Backend (Vercel serverless): ${BACKEND_URL}
- All game logic is local. Server is only called for leaderboard, stats, and support tickets.
- Score = savedTurns (moves excluding skips). HIGHER IS BETTER. ZREVRANGE = rank 1 = best.
- CORS must be * — Capacitor WebView origin is http://localhost.
- NEXT_PUBLIC_API_URL is baked at build time. Must rebuild APK after changing.
- Debug panel: gated by NEXT_PUBLIC_DEBUG_PANEL=true (.env.local). Keep in debug, strip for release.
- GitHub label "atlas-app" must exist in sumitc/atlas-junior for support tickets.
- Vercel token must be READ-WRITE (not read-only) for Redis writes to work.
- CSS GOTCHA: never put Tailwind pb-* on same element as app-safe-area-shell — put it on inner div.
- Capacitor GOTCHA: window.location.origin = "http://localhost" — hide URL-based features in native.
- State GOTCHA: openEndGame() must reset ALL modal state, not just result/loading.
- Redis GOTCHA: always Promise.all([INCR, EXPIRE]) — separate calls risk TTL-less keys.
Call atlas_junior_get_context for the full architecture reference including all gotchas.
`,
      };
    },
  },

  tools: [
    {
      name: "atlas_junior_get_context",
      description:
        "Returns the full Atlas Junior architecture reference — file layout, API endpoints, " +
        "Redis schema, end-game flow, score semantics, build commands, and known limitations. " +
        "Call this at the start of any Atlas Junior work.",
      parameters: { type: "object", properties: {} },
      handler: async () => ARCHITECTURE,
    },

    {
      name: "atlas_junior_server_status",
      description: "Checks whether the Atlas Junior Vercel backend is reachable and healthy.",
      parameters: { type: "object", properties: {} },
      handler: async () => checkBackendStatus(),
    },

    {
      name: "atlas_junior_read_logs",
      description: "Returns recent Vercel function logs for the Atlas Junior backend.",
      parameters: {
        type: "object",
        properties: {
          lines: {
            type: "number",
            description: "Number of recent log lines to return (default 20)",
          },
        },
      },
      handler: async (args) => getVercelLogs(args.lines ?? 20),
    },
  ],
});
