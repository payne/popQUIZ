# PQ — Pop Quiz (pq.n3pay.net)

Groups of people take the same FCC amateur radio exam practice quiz — same questions, same order,
same answer order — then compare results to start discussions about the material.

Decisions below were settled in a design grilling session on 2026-11-17 (Q1–Q40).

## Platform

- Cloudflare free tier: one **Worker** (Hono API) + **Static Assets** + **D1** + **Cron Trigger** (cleanup) + **Turnstile**.
- `pq.n3pay.net` as a Worker Custom Domain (n3pay.net DNS is already on Cloudflare).
- Front end: **Preact + Vite + TypeScript**, built as a **PWA from day one** (vite-plugin-pwa / Workbox).
- Private GitHub repo; deploy by hand with `npx wrangler deploy` (CI later).
- Expected scale: small groups (club / friends), < ~50 people per quiz, a few hundred quizzes per month.
- No analytics beyond Cloudflare's built-in dashboard.

## Question pools

- Current pools only, each tagged with a pool version so new pools can be added later:
  - Technician 2026–2030 (Element 2) — 35-question exam, pass 26
  - General 2023–2027 (Element 3) — 35-question exam, pass 26
  - Amateur Extra 2024–2028 (Element 4) — 50-question exam, pass 37
- Source: NCVEC public-release `.docx` files (errata applied) in `pools-src/`, converted by
  `scripts/parse-pool.ts` into `public/pools/*.json`. Figures go to `public/figures/`.
- Withdrawn ("Question Deleted") questions are excluded.
- Pools are static assets (edge-cached, no D1 reads).
- No written explanations in v1 — only the official correct answer.

## Building a quiz

- **Anyone** may create a quiz (no accounts); Turnstile on **create only**; rate limits on join/answer.
- **Full exam**: one question per group, in pool order (T1A…T0C), like a printed VE exam. Shows Pass / "Practice".
- **Custom quiz**: 10 / 20 / other (5 … all in selection), from chosen subelements (all by default),
  random without repeats, random order. Shows score and % only (no pass/fail).
- **Answer choices keep the official A–D order** (never shuffled — "All of these" / "Both A and B" answers depend on it).
- The server picks questions once and stores the list; every client renders the same thing.
- Share link `pq.n3pay.net/<CODE>`, 6-character code with no 0/O/1/I.

## Taking a quiz

- **Self-paced** (no leader-driven lockstep in v1). No time limit; time taken is recorded and shown.
- **Exam-style feedback**: right/wrong is revealed only after submitting.
- Change answers, skip, and flag-for-review before submitting. Submitting with blanks warns first; blanks count wrong.
- The **creator is always a participant**, plus they can close the quiz.
- Names: free text 1–20 chars (call sign or nickname), no call sign validation; **duplicates in a quiz rejected (case-insensitive)**.
- Identity = random participant token (only its SHA-256 is stored in D1), kept in localStorage under `pq:quiz:<CODE>`. **One browser per person** (no cross-device resume in v1).
- Answers write to localStorage first, then sync to the server; unsent answers queue and retry.

## Lifetime

- Joinable for **7 days** unless the creator closes it early.
- Closing (or expiry) **auto-submits** anyone still in progress; new joins are blocked; results remain viewable.
- Everything deleted after **30 days** (daily cron). Home page notes: "Names and answers are stored for 30 days, then deleted."

## Results

- Leaderboard: names shown, sorted by score desc then faster time; unfinished people listed as "in progress (22/35)".
- "No peeking": you can't see others' answers until you've submitted (enforced by the API).
- Per-question breakdown (A/B/C/D distribution, correct marked, most-missed first) only for people who submitted.
- Non-participants opening a closed quiz see the **leaderboard only**.
- Results page polls every 10–15 s while others are still working. No push notifications in v1.

## PWA

- Precache app shell, all three pools, and figures → a **started** quiz works fully offline, answers sync on reconnect.
- Creating, joining, and viewing results require a connection. No offline solo-practice mode in v1.
- ☰ "Install app": uses `beforeinstallprompt` where available; Add-to-Home-Screen instructions on iOS. No nagging.
- New version → "Update available — reload" toast; the app **never auto-reloads**, especially not mid-quiz.
- Manifest: name "Pop Quiz", short name "PQ", standalone display, generated icon (replaceable).
- iOS keeps home-screen app and Safari storage separate: accepted; the join screen tips "Finish in the same app you started in."

## Hamburger menu ☰

- Share this quiz (Web Share API → copy link / `sms:` fallback), QR code
- Who's in / progress, Results, New quiz, Light/dark theme, Install app
- **Reload app**: flush unsent answers (warn if any remain — they stay saved locally), unregister the
  service worker, clear Cache Storage, reload from network. **Keeps** localStorage progress. Disabled offline ("Needs a connection").
- **Reset everything** (separate, lower, strong warning): also clears all local progress.
- App version + build date shown (e.g. `v1.0.3 · 2026-11-17`).

## Layout

- Mobile-first, CSS Grid + `clamp()` type, ≥ 44 px tap targets. One column on phones; question navigator beside the question on tablet/desktop.

## API (Worker, `/api/*`)

- `POST /api/quizzes` `{pool, mode, count?, subelements?, name}` → `{pid, token, name, quiz}` (creator joins in the same call)
- `GET /api/quizzes/:code` → quiz info: items, closed?, participants (names, finished)
- `POST /api/quizzes/:code/participants` `{name}` → `{pid, token, name, quiz}`; 409 `name_taken`, 410 `closed`
- `POST /api/quizzes/:code/close` (Bearer token, creator only) → closes and marks everyone finished
- Local dev: `npx wrangler d1 migrations apply popquiz --local`, then `npm run dev` (Vite runs the Worker + local D1)
- Deploy: `npm run deploy` (build → remote migrations → `wrangler deploy`)

## Data (D1)

```sql
quizzes(code PK, pool, pool_version, mode, items_json, created_at, creator_pid, closed_at)
participants(pid PK, code FK, display_name, joined_at, finished_at, score)
answers(pid, q_index, choice, answered_at, PRIMARY KEY(pid, q_index))
```

## Testing

- Vitest: pool parser, quiz builder, scoring, no-peeking rules.
- Manual testing on real phone / tablet / desktop before launch.

## Build order

1. Pool parser → JSON for all three exams ✅
2. Single-person local quiz **+ PWA setup** ✅
3. Worker + D1 + create / join / share ✅
4. Answer sync
5. Results + comparisons
6. Real-device testing
7. Turnstile + rate limits (join/answer) + cron cleanup

## Later (explicitly out of v1)

Leader-paced live mode (Durable Objects), study mode (instant feedback), host-only creator, cross-device resume,
offline solo practice, explanations, push notifications, CI deploys.
