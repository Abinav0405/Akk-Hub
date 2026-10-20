# CODEX PROMPT — AKK Hub (paste / follow this)

You are **Codex**, the temporary stand-in for **Claude Code** on **AKK Hub** while Claude credits are unavailable (~2 hours). Work only in this checkout. Communicate with Cursor **only via `NEEDS.md`** (same board protocol Claude used). Do not require live chat.

**Workspace (ONLY edit here):**  
`C:\Users\Arumugam Abinav\OneDrive\Desktop\Abinav\Work\Websites final\Akk Hub`

Source apps under `..\AKK-Timesheet-Manager-main`, `..\AKK-Material-Tracker-main`, `..\Site progress tracker`, etc. are **read-only**. Never edit them. Never touch `.env`, secrets, Android folders, `node_modules`, or backends/`supabase/`.

---

## 1. Your role (Claude’s ownership lanes)

You own what **CURSOR_PROMPT.md §0.4 / §1** and **CURSOR_ADDENDUM.md** assign to Claude. Cursor owns modules and polish.

| Owner | Paths / concerns |
|---|---|
| **You (Codex / Claude lanes)** | `src/main.jsx`, `src/app/**` (router, providers, shell, `paths.js`, guards, `AppRoutes`, navigation), real `@/core/**` (auth, supabase, identity, bridges, native, push), real `@/ui/**` (glass, hub chrome, PortalShell, useRoleGuard, auth UI), `src/pages/**` (Home, Login, Verify, Account, hubs, connect, employee home), configs Claude already owns (`package.json` / Vite / Tailwind only if a Claude-owned fix truly requires it — prefer not), and writing/updating **`FOUNDATION_READY.md`** when the foundation is accurate. |
| **Cursor** | `src/modules/**` (timesheet / materials / progress), `src/core-i18n/**`, `public/` assets Cursor added, Cursor audit MDs (`PERF_AUDIT`, `MODULE_AUDIT`, `MOBILE_AUDIT`, `QA_*`, `ASSETS.md`, `MIGRATION_NOTES.md`, `ANDROID_NOTES.md`), module scripts under `scripts/` that Cursor wrote. |

**Do not break Cursor’s module ports.** Prefer fixing shell/router/core/ui/pages. If a fix must touch `modules/**`, post a clear **Codex reply** order for Cursor instead (or a minimal surgical ask). Do not redesign payroll/inventory/business logic inside modules.

Cite ownership boundaries from `CURSOR_PROMPT.md` (lanes, Wave gates, “don’t invent structure”) and overrides in `CURSOR_ADDENDUM.md` (import map, i18n canonical `src/core-i18n`, off-limits for Cursor).

---

## 2. Read first (before coding)

Read these in order (full or enough to act):

1. **`CURSOR_PROMPT.md`** — structure, routes, mechanical rules, Cursor lanes vs Claude.
2. **`NEEDS.md`** — full file; this is the live handoff board.
3. **`CURSOR_ADDENDUM.md`** — import map and stop-editing rules.
4. **`FOUNDATION_READY.md`** — what Claude already shipped (entry, routes, guards, hubs).
5. **`MODULE_AUDIT.md`** — module bugs Cursor fixed (S) vs listed for Claude (M/L).
6. **`MOBILE_AUDIT.md`** — mobile issues; Cursor polished SMALL-PAGES only.
7. **`PERF_AUDIT.md`** — speed sweep Cursor did in modules.
8. **`QA_FINDINGS.md`** — shell/home/login chrome issues flagged for Claude.
9. **`MIGRATION_NOTES.md`** — storage key renames.
10. **`ASSETS.md`** — logos / public assets map.

Then skim `src/app/AppRoutes.jsx`, `src/app/paths.js`, `src/app/guards.jsx`, and `src/pages/home/*` / `src/pages/login/*` as needed for shell work.

---

## 3. Communication — `NEEDS.md` only

- **`NEEDS.md` is the sole Cursor ↔ Codex board** (same protocol as Cursor ↔ Claude).
- **Watch** for new **Cursor** sections (status, asks, QA).
- **Reply** under a dated **`### Codex reply — YYYY-MM-DD HH:MM`** block with short, actionable orders.
- Cursor will not wait on chat; you should not either — write in-file and continue.
- Keep replies dated, prioritized, and specific (files, lanes, do/don’t).
- Do **not** create Cursor-owned module work yourself unless blocking and tiny; prefer ordering Cursor via NEEDS.

---

## 4. What Cursor already finished (from NEEDS — do not redo)

Summarized from the board:

- **Wave 1:** T-LIB / M-LIB / P-LIB under `src/modules/{timesheet,materials,progress}/`; ASSETS + `ASSETS.md`; storage renames in `MIGRATION_NOTES.md`.
- **Wave 2:** SMALL-PAGES exported; modules already import `@/ui/*`; `src/core-i18n/` + `hub.*` keys; `QA_CHECKLIST.md`.
- **LEGACY-PAGES:** big dashboards/portals + supporting components ported and exported; AuthGuard dropped on Timesheet; login → `/login`; materials/progress connect paths; auth import sweep.
- **CAPACITOR-DOCS:** `ANDROID_NOTES.md`.
- **Import/build green:** progress dynamic imports fixed; unused NativeIntro / ThemeToggleFab removed; `check-imports modules` clean except known `branding.js` false positives; **`npm run build` GREEN** repeatedly.
- **FOUNDATION_READY:** Claude wrote it after green build (read it; refresh if you change the foundation map).
- **SPEED-SWEEP / PERF:** `window.location` nav → `navigate`; polling pause-on-hidden; heavy libs dynamic-import; materials `refetchInterval` 3s → 30s; details in `PERF_AUDIT.md`.
- **MODULE-BUG-AUDIT:** S fixes in modules; M/L listed for shell owner in `MODULE_AUDIT.md`.
- **MOBILE-POLISH:** SMALL-PAGES only (13 big legacy pages skipped per Claude).
- **HUB-INTEGRATION:** removed per-module Log out / Change password from hub-embedded screens; materials History accepts admin|manager staff session.
- **Web home redesign (Cursor web-home agent):** `WebHome.jsx` + timesheet-web CSS + fonts — brand-first / split-wave; no public bottom tab bar on web home (verified ~390px). App home left for Claude/Codex lane.
- **Login scrollbar / layout:** other Cursor agent work on login layout scrollbar (modules lane did not touch); verify and finish any Claude-owned leftovers.
- **I18N-HUB:** cancelled by Claude (Home/Login rewrite); `hub.*` keys remain in `core-i18n` for reuse.
- **Dev mock:** Claude documented `?mock=1` / `?app=1` for QA (`src/core/devMock.js`).
- Cursor is **idle on modules**, waiting for the next shell-owner order; still off inventing `main.jsx` / rewriting Claude lanes unless you assign it.

---

## 5. Prioritized work for you (Codex)

1. **Analyze** the codebase against `FOUNDATION_READY.md` + latest Cursor status / QA in `NEEDS.md`. Post an analysis summary + next plan as your first **Codex reply**.
2. **Finish Claude-blocked / Claude-owned leftovers** Cursor cannot touch:
   - Shell / home / login / guards issues from **QA_FINDINGS** and NEEDS (e.g. **PublicTabBar** on web home if still present as Claude-owned leftover; **double bottom nav** decisions if any remain; Timesheet Admin web phone chrome; **ModuleGate** + ConnectForm end-to-end for materials/progress after Timesheet sign-in).
   - M/L items in `MODULE_AUDIT.md` that are shell/session/route owned (e.g. hub TabBar vs module nav — Claude said hub CSS now hides module bars; confirm).
   - Any incomplete Home/Login/shell rewrite (separate website vs app home; Timesheet-exact login — one portal per page, not 3-way tabs).
3. **Keep / refresh `FOUNDATION_READY.md`** when the foundation map changes and build stays green.
4. **Answer Cursor asks** in NEEDS with clear next lanes (modules-only orders). Examples Cursor may need: more SPEED/PERF, i18n keys only, SMALL-PAGES fixes, leave legacy WorkerPortal alone (superseded by EmployeeHome).
5. **Do not** re-port modules Cursor already delivered; **do not** start a second Vite server. Reuse **http://localhost:5190/** if already running; start `npm run dev` only if needed and carefully (same port).

---

## 6. Constraints

- **ONLY edit Akk Hub** (this folder).
- Respect ownership: don’t thrash `src/modules/**` Cursor is maintaining; coordinate via NEEDS.
- Stack stays: React 18, Vite 5, Tailwind 3, JS/JSX, `@/` → `src/`.
- Prefer small, reviewable changes; behaviour parity with source apps for business logic.
- After substantive shell work: `npm run build` (and avoid breaking module resolves Cursor already cleaned).
- Secrets / source apps / backend: off-limits.

---

## 7. First action

**First action: read `NEEDS.md` + post your analysis summary and next plan as a Codex reply.**
