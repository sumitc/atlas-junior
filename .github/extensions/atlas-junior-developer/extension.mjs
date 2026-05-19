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
- \`npm run apk:release\`      → gradle assembleRelease (app store)
- APK output: android/app/build/outputs/apk/debug/app-debug.apk
- JAVA_HOME must be set: \$(brew --prefix openjdk@21)

### Key env vars (.env.local — gitignored)
- NEXT_PUBLIC_API_URL=https://atlas-junior.vercel.app  (baked at build time)
- NEXT_PUBLIC_DEBUG_PANEL=true                          (set false for release builds)

### Key files
- components/AtlasGame.tsx       → entire game UI + end-game flow (largest file)
- lib/api.ts                     → submitScore(), submitStats(), getLeaderboard(), postTicket()
- app/page.tsx                   → home / game entry point
- app/leaderboard/page.tsx       → leaderboard view
- app/support/page.tsx           → support ticket form

### CORS note
Capacitor WebView origin is "http://localhost" — NOT a real domain.
Backend must use CORS * (origin whitelist breaks the app).

### Speech recognition
- Uses @capacitor-community/speech-recognition for native Android
- Browser Web Speech API used as fallback on web
- partialResults listener + listeningState listener
- stopListening(): always clears UI immediately, then awaits plugin (never blocks UI)
- dbg() helper logs to the in-app debug panel (gated by NEXT_PUBLIC_DEBUG_PANEL)

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
- atlas:lb           → Sorted set. Member = UUID, score = savedTurns (lower = better rank)
- atlas:lb:{id}      → Hash. Fields: name, score, date
- atlas:stats:games  → Integer counter (total games played)
- atlas:stats:turns  → Integer counter (total turns across all games)
- atlas:ratelimit:{ip}:{window} → TTL key for ticket rate limiting (1 per 15 min per IP)

### Leaderboard pipeline (POST /api/leaderboard)
Pipeline order: [ZADD NX, HSET, ZREMRANGEBYRANK, ZREVRANK]
Destructure:    [,        ,     ,                  rank  ]  → index [3]
- ZADD NX: won't overwrite existing member (UUIDs always fresh so effectively always adds)
- ZREMRANGEBYRANK: prunes to top 10 (removes rank 10+)
- ZREVRANK: returns 0-based rank (0 = best). Add 1 for display.
- Score sorting: ZADD stores savedTurns as score. Lower score = lower rank number = better.
  But Redis ZRANGEBYSCORE returns lowest first. Leaderboard uses ZREVRANGE (NOT ZREVRANGEBYSCORE)
  which returns HIGHEST score first — this would be WRONG if lower is better.
  ⚠️  Double-check GET /api/leaderboard sort direction is correct for your scoring semantics.

### Score semantics
- score = savedTurns = number of moves that were NOT skips (higher = more places named = better)
- Redis sorted set stores savedTurns; ZREVRANGE returns highest first (rank 1 = highest score)
- Qualification: entries.length < 10 || savedTurns >= entries[entries.length-1].score
  (>= handles ties correctly — ties qualify)

### Stats
- Fire-and-forget from client (.catch(() => {}))
- Stats loss on network failure is acceptable (analytics only)
- 0-turn games still submit stats (statsSubmittedRef guards double-submit)
- statsSubmittedRef: useRef, set before network call, reset only in startGame()

### Support tickets
- Rate limit: 1 per IP per 15 min (Redis TTL key)
- GitHub label required: "atlas-app" (must exist in repo for tickets to appear)
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
3. If qualifies:
   a. Show team name input (default = playerNames.join(" - "))
   b. User edits name, taps Submit
   c. submitToLeaderboard() → POST /api/leaderboard
   d. Re-fetch leaderboard to show updated board with new entry highlighted
   e. "Skip & start new game" button available during loading (escape hatch)
4. User taps "New game" → returnToSetup() → startGame() (resets statsSubmittedRef)

---

## Known limitations / accepted debt
- Leaderboard metadata orphan: ZREMRANGEBYRANK prunes sorted set but leaves atlas:lb:{id} hashes.
  Cosmetic data leak at small scale — acceptable.
- Stats fire-and-forget: can be lost on network failure. Acceptable for analytics.
- Debug panel in APK: floating "show debug" button visible in debug builds. Intentional.
- No offline queue for leaderboard submissions. If POST fails, score is lost.
- ZADD NX is technically dead code (UUIDs always fresh) but kept as belt-and-suspenders.

---

## Common commands

\`\`\`bash
# Build and sync debug APK
cd ~/projects/atlas-junior
npm run cap:sync
JAVA_HOME=\$(brew --prefix openjdk@21) npm run apk:debug

# Build release APK (strips debug panel)
npm run cap:sync:release
JAVA_HOME=\$(brew --prefix openjdk@21) npm run apk:release

# Check backend health
curl https://atlas-junior.vercel.app/api/health

# Check leaderboard
curl https://atlas-junior.vercel.app/api/leaderboard

# Test stats write
curl -X POST https://atlas-junior.vercel.app/api/stats \\
  -H "Content-Type: application/json" -d '{"turns":5}'

# Deploy backend changes to Vercel
cd ~/projects/atlas-junior/backend
vercel --prod

# View Vercel function logs
vercel logs --limit 30

# List Vercel env vars
vercel env ls
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
- Score = savedTurns (moves excluding skips). Lower = better.
- CORS must be * — Capacitor WebView origin is http://localhost.
- NEXT_PUBLIC_API_URL is baked at build time. Must rebuild APK after changing.
- Debug panel is gated by NEXT_PUBLIC_DEBUG_PANEL=true in .env.local.
- GitHub label "atlas-app" must exist in sumitc/atlas-junior for support tickets.
- Vercel token must be READ-WRITE (not read-only) for Redis writes to work.
Call atlas_junior_get_context for the full architecture reference.
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
