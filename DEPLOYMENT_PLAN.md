# Deployment: plan (not built yet)

**Goal:** managers and admins plan who goes where each day, then send it out. Every worker sees their own deployment in the app (site, time, team, notes) and confirms they've seen it. It has to be fast for the planner and impossible to get wrong for the worker.

---

## 1. How it works for people

### Manager or admin: plan a day (website and phone)

1. Open **Deployment** and pick a date. The default is tomorrow.
2. **Start the day.** Three options:
   - **Copy from:** yesterday, the same weekday last week, or a saved template.
   - **Start empty.**
3. **Day board.**
   - Columns are sites, taken from the one Sites list, active Attendance sites only.
   - A side panel lists **available workers**: in the company, not on approved leave that day, and not already assigned.
   - Assign workers by tapping a worker and then a site. Drag and drop also works on desktop.
   - Each site column has a default **time window**, for example 08:00–17:00. A single worker's time can be changed.
   - Optional per site: a **team lead**, a **vehicle and driver**, a **job reference** (LCB No / Pole ID / JSR), and **notes** such as "bring ladder" or "meet at gate B".
4. **Warnings appear live and block publishing until resolved or overridden:**
   - The worker is on leave that day.
   - The worker is double-booked (overlapping times).
   - The site has no location or QR set up.
   - The worker isn't in the company any more.
   - Nobody has been assigned to a site that was used yesterday. This one is a soft warning.
5. **Publish.**
   - Every assigned worker gets a push notification ("Tomorrow: SLM LTA, 08:00–17:00").
   - The plan locks into **Published**.
6. **Changes after publishing:** edit, then press **Send changes**. Only the affected workers are notified ("Your deployment changed"), and the old version is kept for history.
7. **Tracking:** the board shows who has **seen** or **confirmed** their deployment, so the planner can phone anyone who hasn't.

**On phones:** the board becomes a list grouped by site. "Add workers" opens a searchable multi-select sheet.

### Worker

- The home screen shows a **Today / Tomorrow** card: site name, time, team lead and crew names, notes, a **Directions** button (using the site's saved location), and a **Confirm** button.
- A **My deployments** list covers the past and the next 7 days.
- A push notification arrives when a deployment is published or changed.

### Supervisor (optional)

- Sees the crew deployed to their site for the day: who's expected and who has clocked in.

---

## 2. How it ties into the rest of the app

| Area | Phase 1 (with Deployment) | Later |
| --- | --- | --- |
| Attendance clock-in | The deployed site is suggested | Flag "clocked in at a different site than deployed" |
| Attendance reports | n/a | Planned vs actual per worker, site and day |
| Materials request | Deployed site preselected | n/a |
| Site photos | Deployed site preselected | n/a |
| Leave | Approved leave hides the worker from "available" | Warn the planner when leave is approved for an already-deployed worker |

---

## 3. Data (one backend, `core` schema)

- **`core.deployment_days`:**
  - `date` (unique), `status` (draft or published), `version`, `published_at`, `published_by`, `notes`.
- **`core.deployment_sites`:**
  - `day_id`, `site_id` (core.sites), `start_time`, `end_time`, `team_lead` (employee_id), `vehicle_id`, `job_ref`, `notes`.
- **`core.deployment_assignments`:**
  - `day_id`, `site_row_id`, `employee_id`, `start_time`, `end_time` (defaults from the site row), `role_note`.
  - `seen_at`, `confirmed_at`.
  - A database rule that makes **double-booking the same person at overlapping times impossible**, even if two planners edit at once.
- **`core.deployment_history`:** a snapshot of each published version, so "what was sent" can always be answered.
- **`core.deployment_templates`:** a named set of site rows and workers, reusable as a starting point.
- **Access:** all of it goes through server functions, as with the rest of `core`. The tables are never open to the app directly.
  - Managers and admins plan, using the manager session or admin login.
  - Workers read only their own deployments, using their hub session.
  - Supervisors read their site's crew.
- **Push:** a database trigger on publish or change calls the Attendance push function. This needs the push setup finished first (`migrate.mjs push`).
- **Offline:** workers see the last-loaded deployment even without signal. The planner needs a connection to publish.

---

## 4. Build order

1. **Database and server functions, with automated tests.** Create/copy/publish/republish, overlap rule, leave and in-company checks, access rules. About half a day.
2. **Planner board, website first.** Desktop board with drag and drop plus tap-to-assign, warnings, publish and send changes, seen/confirmed tracking. About 1.5 days.
3. **Planner on phones.** The list-by-site version. About half a day.
4. **Worker side.** Today/Tomorrow card, My deployments, Confirm, Directions, push. About half a day.
5. **Ties to other areas.** Suggested site in clock-in, Materials and Site photos. About half a day.
6. **Later:** planned-vs-actual report, templates manager, a print/WhatsApp summary of the day's deployment, supervisor crew view.

Each phase ends with a signed-in test on the dev server (Cursor) and a phone check before the next one starts.

---

## 5. Decisions needed before building

1. **One site per worker per day,** or can a worker be split between two sites, for example morning at one and afternoon at another? (I'd suggest allowing splits, since the overlap rule keeps it safe.)
2. **Who can publish:** managers and admins both, or admins only?
3. **How far ahead:** day by day, or a whole week at once? (I'd suggest a week view, publishing day by day.)
4. **When workers get notified:** immediately on publish, or at a set time the evening before, for example 6 pm?
5. **Must workers press Confirm,** or is "seen" enough?
6. **Vehicles and drivers:** assign them in the deployment, or leave them out? Vehicles already exist in Attendance.
7. **Supervisors:** should they see their site's crew, and should they be able to edit it?
8. **Sites:** only sites that are on in Attendance, or any site?
