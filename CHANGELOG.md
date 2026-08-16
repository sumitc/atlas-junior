# Atlas Junior — Changelog

## v1.0.31 (versionCode 32) — 2026-08-16

- Random start-letter roll now uses stronger randomness and avoids repeating the same start letter back-to-back
- Web and Android app versions are now kept in sync at v1.0.31

---

## v1.0.30 (versionCode 31) — 2026-08-16

- Version bump for a clean Play Store submission
- Web and Android app versions are now kept in sync at v1.0.30

---

## v1.0.29 (versionCode 30) — 2026-08-16

- Offline place validation now merges approved-place overlays on startup
- Speech typos now offer multiple autocorrect choices
- Speech failures now explain how to recover
- Android target API updated to 36 and web/app versions synced

---

## v1.0.27 (versionCode 28) — 2026-06-27

- Homepage QR updated and the alpha label now reads “Now in Beta”
- Release artifacts bumped together so the AAB/Play Console submission can proceed

---

## v1.0.26 (versionCode 27) — 2026-06-26

- Web export now rebuilds from the latest `main` during Vercel deploys, so `/game` stays in sync without committing generated files
- Maestro smoke harness now captures and stores test results for startup, gameplay, and navigation
- Android back navigation now returns from support/leaderboard/pipeline screens to the game instead of exiting
- Local release flow now tracks the new version bump across web and Android

---

Release notes are stored per-version under:
`android/app/src/main/play/release-notes/en-US/<versionCode>.txt`

The `default.txt` in that folder is used if no version-specific file exists.
Copy the relevant file's contents into Play Console when uploading a release.

---

## v1.0.8 (versionCode 9) — 2026-06-11

- **Flying word animation** — when a place is saved, a fuchsia word chip animates downward so players notice even when the past-places list is off-screen
- **Version footer** — `v1.0.8` shown right-aligned on the footer bar of all pages (game, leaderboard, support) — same build on web and APK
- **Support page: Resolved section** — closed GitHub Issues now appear under a separate ✅ Resolved section with strikethrough styling
- **8 user story issues** created and closed on GitHub to document today's feature history

---

## v1.0.7 (versionCode 8) — 2026-06-11

- **Auto-save on voice input** — spoken place name saves automatically when the microphone stops; no Save tap needed for voice turns
  - Native (Capacitor): triggers on `listeningState: stopped` via `latestTranscriptRef`
  - Browser: triggers on `onresult` when `isFinal === true`
  - If validation fails, inline feedback shown for manual follow-up

---

## v1.0.6 (versionCode 7) — 2026-06-11

- **Smart Save button** — Save only appears when the word starts with the required letter and passes all validation checks; wrong-letter entries show an inline hint instead
- **Skip turn removed** — the Skip button has been removed entirely; every player must attempt a place name
- **Duplicate challenge cleared** — fixed: `duplicateChallenge` state now clears when `draftPlace` changes, preventing stale challenge UI from blocking the next turn

---

## v1.0.5 (versionCode 6) — 2026-06-10

- **Fix: "Yes ✓" suggestion button** — tapping Yes on a fuzzy suggestion now correctly saves the turn; previously the React state hadn't committed so the old draft was saved instead
- **Fix: overridePlace pattern** — `saveTurnInternal` now accepts an `overridePlace` parameter so suggestion values are passed directly, bypassing stale state

---

## v1.0.4 (versionCode 5) — 2026-06-10

- **Offline place validation** — 142k GeoNames place names bundled as `public/places.json` (~6.4MB); validated on-device with no network needed
- **Fuzzy suggestions** — Levenshtein ≤ 2 search over the first-letter bucket; shows "Did you mean X?" with a Yes / Save anyway choice
- **Web game at /game** — the full game is now playable at [atlas-junior.vercel.app/game](https://atlas-junior.vercel.app/game) with leaderboard support
- **Landing page updated** — Play Store button is the highlighted CTA; browser link is a plain text link beneath it

---

## v1.0.3 (versionCode 4) — 2026-06-09

- **Leaderboard tie-breaking** — equal scores now rank by submission time; the older entry always holds its position (fractional Redis score encoding)
- **Landing page** — "Play in browser" link added alongside the Play Store button

---

## v1.0.2 (versionCode 3) — 2026-06-08

- Leaderboard entry sharing — copy link or native share sheet
- Leaderboard entry highlight when arriving via share link
- Stats tracking (average turns per game posted to `/api/stats`)

---

## v1.0.1 (versionCode 2) — 2026-06-01

- Mic permission handling improvements on Android
- Speech recognition stability fixes (Capacitor plugin upgrade)
- UI polish: rounded cards, gradient background, fuchsia accent colour

---

## v1.0.0 (versionCode 1) — 2026-05-24

**First public release 🎉**

- Full place-name word game with turn-based multiplayer
- Voice input via microphone (tap to speak, tap to stop)
- Manual text input with letter-hint placeholder
- Past places log scrolls fully without overlap
- Global leaderboard (top 10, submit your score at game end)
- In-app support ticket submission
- Retry on leaderboard submit failure (no lost scores)
- Info button (ℹ) opens About/How-to-play modal
