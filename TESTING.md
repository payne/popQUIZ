# Real-device test checklist (step 6)

Automated tests (`npm test`) cover the pool parser, quiz building, scoring, the API (with a local D1),
rate limits, the bot check, cleanup, and the sync engine. These checks need real phones and people.
Test on **https://pq.n3pay.net** with at least: one iPhone (Safari), one Android phone (Chrome), and a laptop.

Tick each box; note the device, browser version and anything odd.

## 1. First visit & layout

- [ ] Home loads quickly on cellular; exam cards, Full/Custom, name field and **Start quiz** are usable one-handed.
- [ ] No sideways scrolling on any screen (home, question, results tabs, menu, dialogs).
- [ ] Text is readable without zooming; tap targets are easy to hit.
- [ ] Light and dark mode both look right (☰ → Theme: Auto / Light / Dark).
- [ ] Rotate to landscape and back on a question with a figure — layout holds.
- [ ] Tablet / laptop: the question list sits beside the question.

## 2. Creating & sharing

- [ ] Start a **Custom · 10** quiz. The button briefly says "Checking you're human…", then starts (no visible puzzle normally).
- [ ] ☰ → **Share this quiz** → **Share…** opens the phone's share sheet; texting the link works.
- [ ] **Copy link** works; **Text it** opens Messages with the link filled in (iPhone and Android).
- [ ] ☰ → **QR code**: another phone's camera scans it and opens the quiz.
- [ ] The code chip in the header (e.g. `K7XM2P`) opens the share dialog.

## 3. Joining

- [ ] Open the texted link on a second phone → join screen shows exam, question count, who started it, who's in.
- [ ] Joining with the same name as someone else (any capitalisation) is refused with a clear message.
- [ ] Both phones show the **same questions in the same order** with the **same A–D order**.

## 4. Taking the quiz

- [ ] Answer, go back and change an answer, flag one for review, jump via the question grid (▾ on phones).
- [ ] Figures (e.g. T-1, T-2, T-3) are sharp; tap to enlarge works; close returns to the question.
- [ ] The badge shows **✓ Saved** shortly after answering.
- [ ] ☰ → **Who's in** shows the other person's progress (e.g. `4/10`) updating.
- [ ] Submit with blanks → warning shows the count; submit goes to results.

## 5. Offline (the important one)

- [ ] Mid-quiz, turn on **Airplane mode**. Keep answering: everything works, badge shows "N saved on this device", header shows **Offline**.
- [ ] Close the app/tab completely, reopen it while still offline → the quiz comes back where you left off.
- [ ] Turn Airplane mode off → badge returns to **✓ Saved** within a few seconds; Who's in on the other phone shows the new progress.
- [ ] Submit while offline → results show "your results will be sent when you reconnect"; reconnect → it sends.
- [ ] Offline on the home screen: Start quiz is disabled with "needs a connection".

## 6. Results & comparison

- [ ] After both submit: **Leaderboard** ranks by score then time; PASS/Practice on full exams; you are highlighted.
- [ ] While the other person is still working, they're under "Still working" and the board updates on its own.
- [ ] **Group answers** is locked until you submit, then shows most-missed questions first with counts and bars.
- [ ] Creator: ☰ → **Close quiz** → the other phone (mid-quiz) is auto-submitted with a note; late joiners see "closed" + leaderboard.

## 7. Install as an app (PWA)

- [ ] **Android Chrome**: ☰ → **Install app** shows the install prompt; the app opens full-screen with the PQ icon.
- [ ] **iPhone Safari**: ☰ → **Install app** shows the Share → Add to Home Screen steps; following them adds the PQ icon; it opens full-screen.
- [ ] Installed app works offline from a cold start (Airplane mode, open from home screen).
- [ ] iPhone: a quiz started in Safari is *not* in the home-screen app (expected — the join screen tip explains this).
- [ ] Deploy a new version (`npm run deploy`) → next visit shows **Update available — Reload**; it never reloads by itself mid-quiz.
- [ ] ☰ → **Reload app** (online) reloads and keeps progress; it's disabled offline. Version/date at the bottom of the menu changes after an update.
- [ ] ☰ → **Reset everything** clears "Your quizzes" after the warning.

## 8. Club-meeting scenario (optional, best real-world test)

- [ ] 5+ people on the same Wi-Fi join via the QR code within a minute — nobody is told "Too many requests".
- [ ] Everyone takes a full exam; results page and leaderboard stay responsive.

## Reporting problems

For each issue: device + OS version, browser, quiz code, what you did, what you expected, a screenshot,
and the version from the bottom of the ☰ menu.
