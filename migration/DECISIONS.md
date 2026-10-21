# Migration decisions (Abinav, 2026-10-21)

1. **Worker profile = Attendance (Timesheet) worker record.** `worker_details` (foreign) + `local_worker_details` (local) are the master data for every worker. Materials requesters and Site Progress workers are the same people (matched by employee ID) and are *access*, not separate people.
2. **One worker login.** A worker signs in once (Attendance employee ID + password, Face ID / fingerprint as today). Materials and Site Progress accept that session if the worker's account allows it. No "link your account" screens. Materials / Site Progress passwords are no longer used for the hub.
3. **Access per worker, set by admin on the worker's details page:** Materials on/off, Site photos on/off. Start: the 27 workers who already use Materials + Site Progress get both; everyone else Attendance only.
4. **Staff are separate accounts from workers — never linked.** Managers / supervisors / admins keep their own staff profiles (a supervisor `1018` and worker `1018` stay two profiles).
5. **Clients (Export Only) are a separate account type**, outside the worker system.
6. **IDs ending in `r` stay separate profiles** (e.g. `1019` and `1019r` are two profiles).
7. **Sites with almost-identical names are one place.** All shifts, material requests, photo packages, JSRs of those rows belong to that one place; nothing is duplicated. Merges are listed in `config/site-merges.json`.
8. **Never remove or change data in the 3 existing databases.** They are read-only sources; only the new project (`rvejqoxmvcemeebywpzx`) is written to. Everything is copied, test rows included (hide them later rather than lose them).
