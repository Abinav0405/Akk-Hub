# Cross-database matches (from 02_match_keys.sql, 2026-10-21)

## People — employee ID is a clean global key
- Materials requesters (27) = Site Progress workers (27) — the **same 27 IDs** (Progress also has `test`).
- **All 27 exist in Attendance**, so `employee_id` joins all three. Attendance has **61 workers** (9 local + 52 foreign); 34 of them are Attendance-only (they don't use Materials or Photos).
- Attendance IDs with an `r` suffix (`1019r`, `1020r`, `1047r`, `1051r`) are re-hire records next to `1019`, `1020`, `1047`, `1051`. Keep as separate rows (their shifts and payslips reference them).
- ID **`1018` is both a local worker and a supervisor** → one person with two roles.
- Test data to leave behind: worker `test` (Attendance foreign + Progress), supervisor `test`, site `Test` (Progress).

## Staff (by e-mail hash) — 12 distinct people
| person (hash prefix) | Attendance mgr | Attendance admin | Materials staff | Progress mgr | Progress admin |
| --- | :-: | :-: | :-: | :-: | :-: |
| `591b…` (in all three) | ✓ | ✓ | ✓ | ✓ | ✓ |
| `e5ed…` | ✓ | ✓ | ✓ | | |
| `a9e2…` | ✓ | | ✓ | ✓ | |
| `af4a…` | ✓ | | | ✓ | |
| `a025…` | ✓ | | | ✓ | |
| `ad58…` | | | ✓ | ✓ | |
| `87fd…` | | | ✓ | ✓ | |
| `1aed…` | ✓ | ✓ | | | |
| `5f7d…` | ✓ | | | | |
| `c5a3…` | | ✓ | | | |
| `6653…` | | | | | ✓ |
| `6e43…` | | | | | (Auth user with no admin profile) |
→ one account per person with their roles combined. `6e43…` looks stale; default = leave it out.

## Sites — NOT the same list; three different ideas of "site"
| Attendance (6, GPS/QR clock-in) | Materials (8, where materials go) | Site Progress (8, job / contract schedules) |
| --- | --- | --- |
| Kaki Bukit Office | Kaki Bukit Office | AKK KAKI BUKIT OFFICE AND STORE |
| Pasir Ris Mall | Pasir Ris Mall | PASIR RIS MALL RESI AND COMMERCIAL |
| SLM LTA | SLM LTA | — |
| LCBC LTA | LCB Maintenance *(probably the same)* | — |
| 415c Construction Site, Course | Cycle Path LTA, PPE Individual, TUAS FACTORY, ZEBRA LTA | ACCIDENT POLE REPLACEMENT, AKK SAFETY, TR412C Internal Photos, TR412C Schedule B1 …, TR412C Schedule C …, Test |

Default merge: **one `core.sites` list**, unioned, with these confirmed merges (same name or obvious pair): Kaki Bukit Office, Pasir Ris Mall, SLM LTA, and (to confirm) LCBC LTA ↔ LCB Maintenance. Everything else stays its own row. Each site carries flags for where it is used (clock-in / materials / photos), so no one sees sites that don't apply to them.
