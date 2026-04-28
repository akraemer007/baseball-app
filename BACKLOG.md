# ak_baseball — Backlog

Living catalogue of architecture + feature work. Each ticket is
self-contained and dispatchable to a single agent running in a git
worktree. The brainstorm archive lives at `make_it_impressive.md`.

## How to use this doc

1. Read **Open questions** below — some tickets don't run until you
   resolve a question.
2. Pick N tickets from the same **Wave** (see `Wave plan` section).
   Tickets in the same wave have been pre-checked to not touch
   conflicting files.
3. For each ticket, spawn an agent with `isolation: "worktree"` and
   paste the **Agent prompt** verbatim.
4. Merge each agent's branch into main serially, rebasing the others
   if needed. Check the ticket off here; re-evaluate whether blocked
   items have unblocked.
5. Pipeline lane is serialized — only one pipeline ticket in flight
   at a time, because they mutate `silver_*` schemas that every other
   job reads from.

---

## Progress (last updated 2026-04-28)

| Wave | Tickets | Status |
|------|---------|--------|
| 0 | ARCH-1, ARCH-4 | ✅ |
| 1 | ARCH-3, FEAT-2, FEAT-3, FEAT-10, FEAT-14, FEAT-15, FEAT-17 | ✅ |
| 2 | PIPE-0.5, PIPE-1, PIPE-2, PIPE-3 | ✅ (PIPE-4 odds skipped) |
| 3 | DERIV-1, DERIV-2, DERIV-3, DERIV-4, DERIV-5, DERIV-6 | ✅ |
| 4 | FEAT-1, FEAT-4, FEAT-8 | ⏭️ in review (FEAT-5/6/7/13 abandoned) |
| 5 | DERIV-7, DERIV-8, ARCH-2, ARCH-5, FEAT-9, FEAT-12, FEAT-18 | ⏭️ |

Other status:
- **FEAT-11** (recap interest chips) — already-shipped, closed.
- **FEAT-16** (team roster view) — deferred placeholder pending scope.
- **PIPE-4** (sportsbook odds) — optional, skipped per backlog.
- **FEAT-7** (clutch / WPA leaders) — abandoned 2026-04-28. Dispatched and built
  cleanly, but the underlying metric didn't earn its keep on screen: DERIV-4 v1's
  coarse logistic + RE24-delta model produced a starter-bias that made elite
  arms (Skenes, Soriano, Ohtani) look negative while only closers surfaced as
  "leaders." Decided WPA-as-shown doesn't match the voice we want and the v2
  model rewrite (canonical Tango WP table) wasn't worth gating the wave on.
  See FEAT-7 ticket footer for the postmortem.
- **DERIV-2/3/4** (`gold_reliever_workload`, `gold_team_sos`,
  `gold_player_clutch`) — orphaned by FEAT-5/6/7 abandonments.
  Cleanup tracked by **DERIV-8** in Wave 5 (consolidated to cover all
  three tables).
- **FEAT-5** (bullpen fatigue surface) — abandoned 2026-04-28. Built
  cleanly but the user decided the scope wasn't well thought through;
  doesn't earn a card on the team page. `gold_reliever_workload`
  becomes orphaned (see DERIV-8).
- **FEAT-6** (strength of schedule tooltip) — abandoned 2026-04-28.
  Same reason as FEAT-5; SoS as a single-number-with-tooltip didn't
  earn the team-header real estate. `gold_team_sos` becomes orphaned.
- **FEAT-13** (transactions section) — abandoned 2026-04-28 after a
  second pivot. v1 was inline ribbons on recap cards (built and
  discarded mid-review when scope was rethought), v2 was a standalone
  paginated table on the League page (built clean). v2 spot-check
  revealed the typeCode allowlist barely matched the real data —
  IL placements live under `SC` with description text, the real DFA
  code is `DES` not `DFA`, and `IL10/IL15/IL60` don't appear at all.
  Allowlist fix was straightforward but the broader call: a
  transactions feed didn't earn its space. See FEAT-13 ticket footer.
- **PIPE-2** (`silver_transaction` ingest) — orphaned by FEAT-13
  abandonment. Nothing else reads `silver_transaction`. Unlike
  `gold_player_clutch`, the raw transactions data has broader
  potential value (recap enrichment, weekly digest narrative, future
  team news surface). Not deprecating yet; flag if the cost of
  ingesting roster moves becomes noticeable.

**Cleanup pile (`tasks/post_wave3_cleanup.md`):**
✅ ingest tasks parallelized (all 4 from zero, commit `794dda4`) ·
✅ recap generation moved hourly + morning_recaps retired (`9c639f2`) ·
✅ team-abbrev aliases column on `silver_team` (`e02da83`) ·
⏭️ extend backfill.py to cover playByPlay/Statcast/transactions
(deferred until a redeploy is actually planned).

**Hourly pipeline tuning (post-Wave-3):**
- `build_gold` now depends on `refine_silver` again (`490186d`) — gold
  reads current-hour silver, not previous-hour.
- Statcast hourly only re-fetches the trailing 14 days (`ae34f8c`):
  3 windows refreshed per run instead of 9. Older windows are frozen.

**Known data caveats:**
- `gold_weekly_digest` table exists (DERIV-6) but is empty until
  the `weekly_digest_job` fires Sunday 5 AM ET, or it's manually
  triggered with `digest_force=true`.
- Statcast coverage was buggy before commit `56cfc97` (one-week
  windows only); now spans full season-to-date.

---

## Open questions — resolved

All 8 questions from the brainstorm pass have been answered. Record:

1. **Pythagorean expected record.** ✅ Inline on team header.
   Promoted to **FEAT-17** (now unblocked, see below).
2. **"You are here" tick.** ✅ Dropped. Listed under `Scope
   boundary`.
3. **Interest chips on recap cards.** ✅ Already shipped
   (`NewsSection.tsx:328-344`). Ticket FEAT-11 closed as done.
4. **E.3 zoom.** ✅ Trajectory window (drag-to-select a date
   range; strip plots re-compute using games in that window).
   Drafted as **FEAT-18** (unblocked, see below).
5. **Logos for primary-team theming.** ✅ Team-color tints only.
   FEAT-10 ticket body was already written for this — no edits.
6. **News scraping / LLM web-search.** ✅ Deferred to phase 2.
   Listed under `Deferred ideas`.
7. **Team roster view.** ✅ Deferred placeholder FEAT-16 stays.
8. **Statcast ingest route.** ✅ Direct Baseball Savant endpoint
   (CSV or JSON). PIPE-1 ticket body was already written for this
   path — no edits.

### Pipeline portability constraint (carries through all pipeline + derivation tickets)

Per `CLAUDE.md § Pipeline portability constraints`, every pipeline
ticket must produce code that's easy to migrate off Databricks to
Postgres + object storage later. Concretely:

- Prefer plain Python (pandas / psycopg / httpx) over Spark APIs.
- SQL should run on Postgres — no `STRUCT`, `MAP`, Delta-only
  features, or `MERGE INTO` when `INSERT … ON CONFLICT` works.
- If a job legitimately needs Spark, call it out in a comment so
  the migration pass knows to plan for it.

Agents dispatched on pipeline tickets should read CLAUDE.md before
starting.

---

## Guiding decisions

### Is "build all stats, cull later" a good plan?

**Conditional yes.** It works if we ship **ARCH-1 (bulk stat
endpoint) first**. Today each expanded stat row fires its own
`/api/league/stat-distribution?stat=X` request (N+1 from the
client), which is why page load feels slow already. Adding xwOBA,
bullpen fatigue, strength of schedule, etc. on top adds another
50–200ms round trip per stat.

The fix is small: one bulk endpoint
(`/api/league/stat-distributions?stats=avg,obp,slg,...`), one
client query keyed by the stat set, one prefetch on TeamPage mount.
Once that's in, adding a stat is nearly free — and "build all, cull
later" becomes honest: watch your own clicks for a week and kill
what you never touch.

**So: ARCH-1 blocks the stat-add push.** I've sequenced it in
Wave 0. If you'd rather add stats first and pay the perf cost until
it bugs you, say so and I'll reshuffle.

### Voice / aesthetic constraints (unchanged)

Every ticket inherits these; do not break them:

- Light theme, monospace annotations. No off-the-shelf UI kit.
- Strip plots over bar charts. Small multiples over single big ones.
- No gradients, no shadows (except the faintest tooltip shadow).
- No splash screens, no loaders that take over the page.
- The voice is "thoughtful, opinionated, dense-but-not-cluttered."

---

## Scope boundary — what we're explicitly **not** doing

Decisions are final unless you reverse them. Moving an item out of
this list means adding a ticket.

- **Strike-zone heat map · pitch arsenal chart · spray chart**
  (A.4–A.6). Baseball Savant does these better; link out if needed.
- **Live WPA timeline per game** (A.7). Not a real-time app.
- **Park factors** (B.6). Boring.
- **Rest-advantage / days-since-last-game** (B.8). Boring.
- **FanGraphs scraping** (C.3). Skip; compute advanced stats from
  Statcast ourselves if needed.
- **Weather integration** (C.6). Not a real-time app.
- **Shareable PNG recap cards** (D.4). Meh.
- **"You are here" trajectory tick** (D.1). The line always ends at
  today; the tick would be a redundant marker.

---

## Ticket catalogue

### Ticket format

Every ticket below has: title, lane, status (blocked-by / blocks),
scope, acceptance criteria, files expected to change, agent prompt,
notes / risks.

Lanes:

- **A — Architecture.** Cross-cutting, may touch shared code.
- **P — Pipeline.** Serialized. Mutates silver/gold schemas.
- **D — Derivation.** Pure gold / SQL from existing silver. Can
  parallelize once upstream pipeline is stable.
- **F — Feature.** Client or server change on top of existing data.
  Usually parallel-safe.

---

### ARCH-1 — Bulk stat-distribution endpoint + client prefetch restructure

**Lane:** server + client
**Status:** unblocked · **Blocks:** FEAT-1 (soft), FEAT-4, FEAT-5,
FEAT-6, FEAT-7, ARCH-2
**Scope:** Replace per-row `/api/league/stat-distribution?stat=X`
with a bulk `/api/league/stat-distributions?stats=avg,obp,...`
endpoint. Client fetches the full set once on `TeamPage` mount and
each `PercentileRow` reads from the same query cache. Eliminates
the N+1 pattern that makes the team page feel slow.

**Acceptance criteria:**

- New server route returns `{[stat]: StatDistributionResponse}` for
  every requested stat in one round trip.
- Server query batches the underlying gold read (single SQL with
  `stat_name IN (...)` — no per-stat execution).
- `PercentileRow` no longer defines its own `useQuery`; reads from
  a shared query seeded at the page level.
- Old single-stat endpoint stays (don't break callers outside
  `TeamPage`). Mark as deprecated in server comments.
- Team page renders identically; visible perf improvement on first
  load (target: ≥40% reduction in time-to-first-spark).
- Typecheck passes, existing tests (if any) pass.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts` — new
  `getBulkStatDistributionsFromWarehouse(stats: string[], season)`.
- MODIFY `app/server/src/routes/league.ts` — add `/stat-distributions`.
- MODIFY `app/client/src/pages/TeamPage.tsx` — fetch bulk; pass
  per-row data as props instead of inner useQuery.
- MODIFY `app/shared/types.ts` (or the post-ARCH-4 equivalent) — add
  `BulkStatDistributionResponse`.

**Agent prompt:**

```
You are in a git worktree branched off main, working on ARCH-1.
Read BACKLOG.md §ARCH-1 for scope + acceptance criteria.

Current behavior: on the team page, each PercentileRow calls
useQuery for a single stat via GET /api/league/stat-distribution.
That's ~15 parallel requests per expand. Goal: one bulk request.

Implement:
1. Server: a new `getBulkStatDistributionsFromWarehouse(stats,
   season)` in app/server/src/queries/index.ts that runs ONE SQL
   query with `stat_name IN (...)` against gold_team_stat_vs_league,
   groups results by stat_name server-side, returns Record<stat,
   response>. Wire via new route
   `/api/league/stat-distributions?stats=a,b,c&season=2026` in
   routes/league.ts. Keep the old single-stat route working.
2. Shared type: add `BulkStatDistributionResponse` returning
   `Record<string, StatDistributionResponse>`. Put it in whatever
   shared/types module exists (post-ARCH-4 this may be split by
   domain; if types.ts is still monolithic, add there).
3. Client: in pages/TeamPage.tsx, fetch the bulk once using the
   list of stat keys derived from percentileStats. Pass each
   row's distribution down to PercentileRow as a prop. Remove the
   inner useQuery in PercentileRow.

Verify:
- ./scripts/dev.sh, open http://localhost:5173/team/CHC
- Network tab shows ONE /stat-distributions call on page load,
  no per-row stat-distribution calls
- Expanded stat rows still render the 30-team strip plot and the
  per-player chart
- typecheck: cd app && npx tsc --noEmit -p client/tsconfig.json
  and -p server/tsconfig.json

Do NOT touch jobs/, resources/, or any pipeline code. Do NOT
merge to main; leave your work on the worktree branch for review.
Commit at a clean point; write a one-paragraph commit body
explaining before/after request count.
```

**Notes / risks:** Shares `types.ts` with many other tickets. Run
this in Wave 0 (solo) so later tickets rebase on top cleanly.

---

### ARCH-2 — Progressive-disclosure pattern for stat cards

**Lane:** client
**Status:** blocked by: ARCH-1 · **Blocks:** none (optional UX layer)
**Scope:** Instead of rendering all 15+ stats always, classify each
stat as `default` / `expanded`. Default stats render; a "+N more"
link at the bottom of each category card (Batting / Pitching /
Other) reveals the rest. User can also pin favorites to
localStorage, which survives page refresh.

**Acceptance criteria:**

- Each STAT_ORDER entry gets a `tier: 'default' | 'expanded'` flag.
- Initial page render shows only `default` stats; `expanded` ones
  are skipped until the "+N more" toggle is clicked.
- Pin/unpin button on each row toggles favorite state; pinned
  stats render first in the default tier; favorites persisted to
  `localStorage` under `ak_baseball.pinned_stats`.
- Bulk endpoint from ARCH-1 still fetches all stats once (no lazy
  fetch — already cheap).
- CSS transitions on expand/collapse match the existing spark ↔
  full evolution tone (280ms ease).

**Files expected to change:**

- MODIFY `app/client/src/pages/TeamPage.tsx` (add tier filter +
  toggle button + localStorage).
- MODIFY `app/client/src/index.css` (new `.percentile-tier-toggle`
  styles).
- MODIFY `app/client/src/lib/preferences.tsx` (add
  `pinnedStats: string[]`).

**Agent prompt:**

```
You are in a git worktree branched off main, working on ARCH-2.
ARCH-1 has already landed; you can assume bulk stat fetching is
in place.

Goal: tier stat rows into "default" (show always) and "expanded"
(hidden behind a '+N more' toggle). Let the user pin any row to
localStorage so it jumps into the default tier.

Implement:
1. Add `tier: 'default' | 'expanded'` to STAT_ORDER or a parallel
   map in TeamPage.tsx. Default tier (starting point):
     batting: avg, obp, slg, ops, hr_total
     pitching: era, k_per_9, fip
     fielding: run_diff
   Everything else → expanded.
2. Add a category-level toggle button "+N more" / "show less" that
   reveals/hides expanded rows. Smooth height transition to match
   existing chart expand (280ms ease).
3. Per-row pin button (small star icon, rightmost slot of row).
   Pinned stats persist via PreferencesContext
   (app/client/src/lib/preferences.tsx) and render first.
4. Respect existing dark-navy / monospace voice. No new colors.

Verify:
- Reload /team/CHC — only default tier renders
- Click "+N more" — expanded rows slide in
- Pin ops_plus — refresh — it renders in default tier
- typecheck passes

Do not touch jobs/, server code, or pipeline. Commit clean.
```

**Notes / risks:** tier assignment is a taste call — expect a
follow-up pass to rebalance.

---

### ARCH-3 — Hide Player tab, ship a placeholder

**Lane:** client
**Status:** unblocked · **Blocks:** none
**Scope:** Remove the Player nav link until the rebuild lands.
Render a "coming back soon" placeholder page so direct-link
access still works without 404.

**Acceptance criteria:**

- NavBar no longer renders the Players link.
- `/players` route still resolves but renders a 1-paragraph
  "under construction" placeholder in the existing card style.
- No broken imports left behind; existing PlayersPage component
  remains in the repo, just not linked.

**Files expected to change:**

- MODIFY `app/client/src/components/NavBar.tsx` (drop the link).
- MODIFY `app/client/src/pages/PlayersPage.tsx` OR replace with a
  new `PlayersPlaceholder.tsx` at the `/players` route (user
  preference — agent decides and documents in commit).

**Agent prompt:**

```
You are in a git worktree branched off main, working on ARCH-3.

Remove the Players nav link from NavBar.tsx. Leave the /players
route working but render a small placeholder:

  "Player profiles are being rebuilt. Check back after the team-
  roster work lands. For now, try /team/CHC."

Keep the voice tight — no emojis, no overly apologetic copy.
Light card, monospace "coming soon" feel consistent with the rest
of the app. No layout taller than ~200px.

Do NOT delete the existing PlayersPage component — we may
cannibalize it later. Either leave it as dead code or rename to
PlayersPage.legacy.tsx at the agent's discretion.

Verify:
- /players renders the placeholder
- NavBar shows League + Team only
- typecheck passes

Commit clean.
```

**Notes / risks:** Pure subtraction; lowest risk ticket in the
backlog.

---

### ARCH-4 — Split `shared/types.ts` by domain + conventions doc

**Lane:** cross-cutting
**Status:** unblocked · **Blocks:** every ticket that edits types
**Scope:** `app/shared/types.ts` is the single biggest merge-conflict
magnet. Split into `app/shared/types/` with one file per domain
(`league.ts`, `team.ts`, `recap.ts`, `projection.ts`, `player.ts`,
`matchup.ts`), plus an `index.ts` that re-exports everything so
existing `from '@shared/types'` imports keep working without edits.
Add a short `CONVENTIONS.md` at repo root describing the split so
future agents know where new types go.

**Acceptance criteria:**

- `app/shared/types.ts` replaced by `app/shared/types/` directory.
- All client and server imports still work (backed by the barrel
  re-export).
- Typecheck passes on both client and server.
- New `CONVENTIONS.md` at repo root (~40 lines): types location
  rules, parallel-worktree etiquette (one domain file per PR,
  avoid touching index.ts unless adding a new domain).

**Files expected to change:**

- NEW `app/shared/types/league.ts`
- NEW `app/shared/types/team.ts`
- NEW `app/shared/types/recap.ts`
- NEW `app/shared/types/projection.ts`
- NEW `app/shared/types/player.ts`
- NEW `app/shared/types/index.ts` (barrel)
- DELETE `app/shared/types.ts`
- NEW `CONVENTIONS.md`

**Agent prompt:**

```
You are in a git worktree branched off main, working on ARCH-4.

Goal: split app/shared/types.ts into per-domain files so parallel
feature agents don't collide on the same file.

Steps:
1. Read app/shared/types.ts and group its exported types by
   domain. Suggested domains:
     - league.ts: Division, LeagueResponse, Team
     - team.ts: TeamResponse, PercentileStat, record/streak types
     - recap.ts: RecapItem, RecapsResponse, GameType
     - projection.ts: ProjectionsResponse, MatchupPreview (if any)
     - player.ts: PlayerResponse, StatDistributionEntry,
       TeamPlayerDistributionEntry, StatDistributionResponse,
       TeamPlayerDistributionResponse, HrRaceResponse
2. Move each into a separate file under app/shared/types/.
3. Create app/shared/types/index.ts that re-exports everything so
   `import type { Foo } from '@shared/types'` still resolves.
4. Delete the old types.ts.
5. Run typecheck on BOTH workspaces:
     cd app && npx tsc --noEmit -p client/tsconfig.json
     cd app && npx tsc --noEmit -p server/tsconfig.json
6. Write CONVENTIONS.md at repo root. Include:
   - Where new types go (match existing domain or add new file).
   - "Don't touch index.ts unless adding a new domain file" rule.
   - "One domain file per PR" guidance.
   - ~40 lines max. Match the CLAUDE.md tone.

Do NOT change any type bodies — this is a pure reshuffle.

Commit as a single clean commit with a body listing which domain
each type landed in.
```

**Notes / risks:** Typescript path resolution must be checked in
both client and server tsconfigs. The `@shared/types` alias needs
to point at the directory (which resolves to index.ts) without
edits.

---

### ARCH-5 — Lightweight test harness for `jobs/recaps/`

**Lane:** cross-cutting (ops)
**Status:** unblocked · **Blocks:** none
**Scope:** Add a minimal pytest harness covering only the two
logic paths that have burned us before: interest-score
classification (`interest.py`) and NOT-EXISTS skip gating
(`generate_recaps.py`). Not a broad coverage push — the point is
a regression net on the two highest-entropy branches.

**Acceptance criteria:**

- `jobs/recaps/tests/test_interest.py` with ≥4 tests: walkoff
  positive, comeback positive, pitching_duel positive, blowout
  positive. Plus ≥2 negative tests.
- `jobs/recaps/tests/test_skip_gating.py` with ≥2 tests: already-
  recapped row skipped, force=True overrides.
- Fixtures are small inline dicts, not live DB calls. No
  Databricks dependency.
- `pytest jobs/recaps/tests/` runs green locally.
- GitHub Actions workflow OR a bash hook that runs these before
  any pipeline deploy (agent picks; documents in commit).

**Files expected to change:**

- NEW `jobs/recaps/tests/test_interest.py`
- NEW `jobs/recaps/tests/test_skip_gating.py`
- NEW `jobs/recaps/tests/conftest.py`
- OPTIONAL NEW `.github/workflows/recaps-tests.yml`

**Agent prompt:**

```
You are in a git worktree branched off main, working on ARCH-5.

Goal: a minimum-viable test harness for jobs/recaps/. Two modules
are in scope — interest.py and the skip-gate logic in
generate_recaps.py. Both have bitten us (silent misclassification,
accidental re-runs).

Steps:
1. Read jobs/recaps/interest.py and identify the 4 positive
   classifiers (walkoff, comeback, pitching_duel, blowout).
2. Build fixture dicts that are the minimum shape each classifier
   reads (innings list, starters list, game dict). Inline, no DB.
3. Write test_interest.py with:
   - 1 positive test per classifier
   - 1 negative test that a standard game returns 'standard'
   - 1 negative test that a walkoff-looking game fails when the
     home team loses (sanity on the direction logic)
4. Read the skip-gate logic in generate_recaps.py (search for
   'gold_game_recap' NOT EXISTS or the python-side filter).
5. Write test_skip_gating.py with 2 tests: skipped-when-present
   and forced-when-force-true.
6. Verify: pytest jobs/recaps/tests/ — all green.
7. If adding a GitHub Action, make it pip-install ONLY what
   jobs/recaps/tests/ needs. Do not pull in Databricks SDK.

Do NOT refactor interest.py or generate_recaps.py beyond what's
necessary to make the logic importable in tests. If a helper is
currently bound to dbutils, wrap it or extract it cleanly.

Commit clean with the test results in the body.
```

**Notes / risks:** If interest.py imports Spark/dbutils at module
level, tests will fail to import. Agent may need a small refactor
to delay that import.

---

### PIPE-1 — Statcast ingest → `silver_pa`, `silver_pitch`

**Lane:** pipeline
**Status:** unblocked (pending open question 8 confirmation) ·
**Blocks:** DERIV-1, FEAT-4
**Scope:** Add a new ingest job that pulls Statcast data from
Baseball Savant's public JSON endpoint. Produces two silver
tables: `silver_pa` (one row per plate appearance, ~190k/season)
and `silver_pitch` (one row per pitch, ~700k/season). Ingest
filters by season only; existing season backfill pattern reused.

**Acceptance criteria:**

- New `jobs/ingest/fetch_statcast.py` (or equivalent) runs as a
  Databricks notebook task with `season` widget.
- Hits Savant's search endpoint
  (`baseballsavant.mlb.com/statcast_search/csv?all=true&...`) with
  the 50ms polite delay already used elsewhere.
- Raw payloads land in `bronze_statcast_pa`, `bronze_statcast_pitch`
  (gzip NDJSON in UC).
- Silver transforms in a new file or appended to
  `silver_transforms.py`: typed columns for PA (batter_id,
  pitcher_id, estimated_woba_using_speedangle, launch_speed,
  launch_angle, description, events, etc.) and Pitch (pitch_type,
  release_speed, plate_x, plate_z, etc.).
- Bundle resource YAML updated: new task in
  `resources/hourly_refresh_job.yml` after `refine_silver` so
  Statcast runs alongside other silver jobs, or a separate job if
  the cadence is different (agent decides; documents choice).
- `databricks bundle validate` passes.
- Manual trigger run on current season populates the silver tables;
  `SELECT COUNT(*) FROM silver_pa WHERE season = 2026` returns a
  reasonable number (~150k if mid-season).

**Files expected to change:**

- NEW `jobs/ingest/fetch_statcast.py`
- MODIFY `jobs/refine/silver_transforms.py` (add PA + pitch
  transforms) OR NEW `jobs/refine/silver_statcast.py`
- MODIFY `resources/hourly_refresh_job.yml`
- MODIFY `jobs/common/mlb_stats_api.py` — if it becomes the shared
  HTTP client, or add a new `jobs/common/savant.py`

**Agent prompt:**

```
You are in a git worktree branched off main, working on PIPE-1.
This is a serialized pipeline ticket — no other pipeline work is
running. Read BACKLOG.md §PIPE-1 carefully.

Goal: ingest Statcast plate-appearance + pitch data from Baseball
Savant's public JSON endpoint into silver_pa + silver_pitch.

Steps:
1. Prototype the Savant request locally: the endpoint is
   https://baseballsavant.mlb.com/statcast_search/csv?all=true&
   type=details&season=2026&hfPT=&hfAB=&hfGT=R|  (full param list
   is visible by watching network traffic at
   https://baseballsavant.mlb.com/statcast_search with a season
   filter). Use the `csv` endpoint — simpler than JSON, still
   public. Respect the 50ms polite delay.
2. Land raw CSV bytes per season-month into bronze_statcast (UC
   table). Keep month partitioning so we can incremental-ingest.
3. Silver: parse CSV into typed rows. Two tables:
   - silver_pa: game_pk, at_bat_number, batter_id, pitcher_id,
     events, description, estimated_woba_using_speedangle,
     launch_speed, launch_angle, hit_distance_sc, total_bases,
     inning, pitcher_team, batter_team, game_date, season
   - silver_pitch: same + pitch_type, release_speed, plate_x,
     plate_z, zone, balls, strikes, pfx_x, pfx_z, sz_top, sz_bot
4. Add a new task to resources/hourly_refresh_job.yml that runs
   AFTER refine_silver, in its own step. Or create a separate
   less-frequent job if hourly feels wasteful (Statcast is
   backfilled game-complete only — once per day is probably
   enough).
5. Validate: databricks bundle validate && manual trigger the new
   task. Confirm rows land.

Schema decisions: mirror column names from Savant CSV when
reasonable so future joins are obvious. Use DECIMAL/FLOAT as
appropriate — no silent coercions.

Do NOT modify any app/ files — this ticket is pipeline-only. Do
NOT touch other jobs (fetch_games, build_gold, etc.) beyond
incremental additions.

Commit clean with a body listing exact bronze/silver row counts
from the trigger run.
```

**Notes / risks:** Savant's CSV endpoint rate-limits above a
certain page size. If a season query times out, chunk by
month_filter. Also: Savant data has a 1–2 day lag for the most
recent games while MLB's Statcast ops finalize numbers — document
this in the commit so app code can surface a "data as of" date.

---

### PIPE-0.5 — MLB Stats API `playByPlay` ingest → `silver_play`

**Lane:** pipeline
**Status:** unblocked · **Blocks:** DERIV-4
**Scope:** Pull per-game play-by-play from MLB Stats API's
`/game/{pk}/playByPlay` endpoint. One row per event (pitch,
plate appearance outcome, baserunning event). Required for WPA /
leverage-index derivation without pulling Retrosheet.

**Acceptance criteria:**

- New `jobs/ingest/fetch_playbyplay.py` iterates recent Final
  games and ingests their playByPlay payload into
  `bronze_playbyplay`.
- Silver transform produces `silver_play` with at minimum: game_pk,
  play_index, inning, half_inning, batter_id, pitcher_id, event,
  description, base_state_before, outs_before, home_score_before,
  away_score_before.
- Runs as a task in `hourly_refresh_job.yml` after `refine_silver`.
- `databricks bundle validate` passes; manual trigger populates
  rows.

**Files expected to change:**

- NEW `jobs/ingest/fetch_playbyplay.py`
- MODIFY `jobs/refine/silver_transforms.py` OR NEW
  `jobs/refine/silver_playbyplay.py`
- MODIFY `resources/hourly_refresh_job.yml`

**Agent prompt:**

```
You are in a git worktree branched off main, working on PIPE-0.5.
Serialized pipeline work — no other pipeline tickets in flight.

Goal: ingest MLB Stats API playByPlay per Final game so we can
compute WPA / leverage index downstream.

Endpoint:
  https://statsapi.mlb.com/api/v1/game/{gamePk}/playByPlay
Returns a JSON with `allPlays` (array of plays, each with result,
about, matchup, count, runners, playEvents).

Steps:
1. fetch_playbyplay.py: for each Final game in silver_game this
   season without a bronze_playbyplay entry, fetch + land gzipped
   JSON. Respect the 50ms delay. Idempotent by game_pk.
2. Silver transform: flatten allPlays into silver_play rows.
   Minimum columns listed in BACKLOG.md §PIPE-0.5.
3. Bundle: add a task after refine_silver in
   resources/hourly_refresh_job.yml. No schedule changes.
4. Validate: databricks bundle validate && trigger the task.
   Confirm silver_play row count is ~75 * games_final.

Do NOT compute WPA here — that's DERIV-4's job. This ticket stops
at silver_play being queryable.

Commit clean with counts in the body.
```

**Notes / risks:** playByPlay payloads are ~5–20KB per game, so
full-season bronze is a few hundred MB. Fine for UC.

---

### PIPE-2 — MLB transactions feed → `silver_transaction`

**Lane:** pipeline
**Status:** unblocked · **Blocks:** FEAT-13
**Scope:** Pull the free MLB Stats API transactions feed
(`/transactions?date=YYYY-MM-DD`) and materialize
`silver_transaction`: one row per roster move (IL, call-up, DFA,
trade, option, recall).

**Acceptance criteria:**

- New ingest job iterates the last 30 days daily, lands JSON in
  `bronze_transaction`, parses to `silver_transaction` with at
  minimum: transaction_id, player_id, player_name, from_team_id,
  to_team_id, transaction_date, transaction_type (IL-10, IL-60,
  recall, option, trade, DFA), notes.
- Idempotent — re-running same day's fetch produces no new rows.
- Task runs after `refine_silver` in
  `hourly_refresh_job.yml`. A row's `transaction_date` is ET-aware.
- `databricks bundle validate` passes; manual trigger lands rows.

**Files expected to change:**

- NEW `jobs/ingest/fetch_transactions.py`
- MODIFY `jobs/refine/silver_transforms.py`
- MODIFY `resources/hourly_refresh_job.yml`

**Agent prompt:**

```
You are in a git worktree branched off main, working on PIPE-2.
Serialized pipeline work.

Goal: ingest MLB Stats API transactions into silver_transaction
so injury/call-up context can flow into recaps and the team page.

Endpoint:
  https://statsapi.mlb.com/api/v1/transactions?startDate=YYYY-MM-DD
  &endDate=YYYY-MM-DD
Returns {transactions: [...]} with typeCode, fromTeam, toTeam,
player.id, person.fullName, effectiveDate, resolutionDate, type.

Steps:
1. fetch_transactions.py: for each day in the last 30 days, fetch
   + land JSON in bronze_transaction keyed by transaction_id.
2. Silver transform: map typeCode to a normalized
   transaction_type enum.
3. Add task to hourly_refresh_job.yml after refine_silver.
4. Validate: databricks bundle validate && trigger. Confirm
   silver_transaction rows for recent-day transactions.

Do NOT integrate into any app code — that's FEAT-13. Stop at
silver_transaction being queryable.

Commit clean with row counts.
```

**Notes / risks:** MLB returns transactions before they take
effect sometimes (scheduled moves). Filter on `effectiveDate <=
today`.

---

### PIPE-3 — Multi-year historical backfill (2020+)

**Lane:** pipeline
**Status:** unblocked · **Blocks:** DERIV-5
**Scope:** The existing `backfill.py` widget takes a
`seasons_back` integer (default 3). Extend to 2020+ so we have 6
full seasons of data — enough for meaningful "first-since-X" or
"longest streak since Y" claims.

**Acceptance criteria:**

- Confirm existing `jobs/ingest/backfill.py` actually backfills
  all bronze sources (schedule, boxscore) for arbitrary
  `seasons_back`. If gaps (e.g. playByPlay isn't backfilled),
  extend it.
- Run once with `seasons_back=6`. Verify `silver_game`,
  `silver_player_season`, and `gold_division_trajectory` all have
  rows for 2020–2025 after silver + gold rebuilds.
- Document the run (row counts per season) in the commit body.

**Files expected to change:**

- MODIFY `jobs/ingest/backfill.py` (extend as needed)
- MODIFY `jobs/refine/silver_transforms.py` if gaps exist

**Agent prompt:**

```
You are in a git worktree branched off main, working on PIPE-3.
Serialized pipeline work.

Goal: ensure 2020+ bronze/silver/gold coverage for cross-year
derivations.

Steps:
1. Read jobs/ingest/backfill.py. Note what it covers today
   (schedule + boxscore? more?).
2. Identify gaps: does it backfill playByPlay? transactions?
   Statcast? (The latter two depend on PIPE-0.5 / PIPE-1 / PIPE-2
   landing — out of scope here.)
3. For what backfill DOES cover, run locally via
   databricks bundle run ... --task backfill --param seasons_back=6
   (or invoke the bundle job appropriately). Monitor for UC
   throttling on CREATE TABLE IF NOT EXISTS — that has hit us
   before; retry with backoff if needed (the pattern exists in
   jobs/common/).
4. After backfill, trigger refine_silver + build_gold to roll up.
5. Verify silver_player_season has rows per player-season for
   2020-2025 via a sample SQL query. Record counts.
6. If gaps exist (e.g. boxscore json is partial for an earlier
   year), extend fetch_games to handle older-season quirks.

Do NOT ingest Statcast, transactions, or playByPlay — those are
separate tickets. Bronze_schedule + bronze_boxscore + their
silvers are the target.

Commit with per-season row counts in the body.
```

**Notes / risks:** 2020 was a 60-game season (COVID), so row
counts will look anomalous — document that in the commit so
downstream derivations (streak length, etc.) account for it.

---

### PIPE-4 — Sportsbook odds ingest → `silver_odds` *(optional)*

**Lane:** pipeline · **Priority: LOW**
**Status:** unblocked · **Blocks:** nothing directly
**Scope:** Exploratory. Pull public odds feeds (DraftKings or
FanDuel) and materialize `silver_odds` with pre-game moneyline
and total. Could inform Elo tuning or a "market vs. us" widget.

**Acceptance criteria:**

- New ingest job pulls each game's moneyline pre-game. Polite
  delay. JSON in bronze, normalized rows in `silver_odds` (game_pk,
  home_ml, away_ml, total, source, fetched_at).
- Runs daily (not hourly — odds are stable within a game day).
- `databricks bundle validate` passes.

**Files expected to change:**

- NEW `jobs/ingest/fetch_odds.py`
- MODIFY `jobs/refine/silver_transforms.py`
- MODIFY `resources/hourly_refresh_job.yml` or new daily schedule

**Agent prompt:**

```
You are in a git worktree branched off main, working on PIPE-4.
Low priority — defer unless the user explicitly asks.

Goal: ingest public sportsbook moneyline + total per game into
silver_odds so we can later compare Elo vs market.

Research first: pick one source that publishes a free JSON feed.
Options:
  - The Odds API (https://the-odds-api.com/) — free tier, needs API
    key, has MLB coverage
  - Scraping a book directly — likely ToS-grey, avoid
  - Vegas Insider or a public aggregator — more fragile

Recommend: The Odds API free tier. Add ODDS_API_KEY secret to the
bundle.

Steps (if user approves source):
1. fetch_odds.py pulls today's + upcoming games' moneylines and
   totals. Lands JSON in bronze_odds.
2. Silver transform: game_pk match against silver_game by
   date+teams. Produces silver_odds.
3. Runs once per day pre-first-pitch. Add to a daily or morning
   job; NOT hourly.
4. Document cost + rate limits in the commit body.

Stop here. Do not build a UI on top — market-vs-us visualization
is a separate future ticket.
```

**Notes / risks:** Do not check any API key into git; use bundle
secrets.

---

### DERIV-1 — xwOBA / wOBA / xBA gold aggregate

**Lane:** derivation
**Status:** blocked by: PIPE-1 · **Blocks:** FEAT-4
**Scope:** Aggregate per-batter xwOBA, wOBA, xBA at season level
from `silver_pa`. Surface in `gold_player_expected_stats` with a
companion team-level rollup in `gold_team_stat_vs_league` under
new `stat_name` values `xwoba`, `woba`, `xba`.

**Acceptance criteria:**

- SQL view or materialized gold table with per-player and per-team
  xwOBA / wOBA / xBA for the current season.
- `gold_team_stat_vs_league` has rows with `stat_name IN ('xwoba',
  'woba', 'xba')` so the existing stat-distribution UI can pick
  them up for free.
- wOBA weights sourced from the 2025 FanGraphs constants table
  (publicly known, hardcode in `build_gold.sql` with a comment
  citing source + year).
- xwOBA pulls `estimated_woba_using_speedangle` from Statcast
  directly (Savant computes it already).
- `databricks bundle run build_gold` succeeds; new rows visible
  in `gold_team_stat_vs_league`.

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql`

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-1.
PIPE-1 has landed; silver_pa exists.

Goal: produce xwOBA / wOBA / xBA gold aggregates.

Steps:
1. Read silver_pa schema to confirm
   estimated_woba_using_speedangle is present (xwOBA per PA).
2. Extend jobs/gold/build_gold.sql:
   - Add `gold_player_expected_stats` materialization per
     (player_id, season): sum(xwoba_num) / count(pa), etc.
   - Team rollup: weighted by team PAs.
   - Insert team-level rows into gold_team_stat_vs_league with
     stat_name IN ('xwoba', 'woba', 'xba').
3. wOBA formula (classic):
   wOBA = (0.69*uBB + 0.72*HBP + 0.89*1B + 1.27*2B + 1.62*3B +
   2.1*HR) / (AB + BB - IBB + SF + HBP)
   Use 2025 constants; cite source in a SQL comment.
4. xBA: use events-based hit expectancy (events classification
   already in silver_pa). Simpler proxy: events in
   {'single','double','triple','home_run'} → hit=1 else 0, divide
   by AB. Not strictly xBA; document as "batting_avg_events".
   If Savant also publishes estimated_ba_using_speedangle,
   prefer that.
5. Trigger build_gold; verify rows:
   SELECT stat_name, COUNT(*) FROM gold_team_stat_vs_league
    WHERE season = 2026 AND stat_name IN ('xwoba','woba','xba')
    GROUP BY 1;
   Expect ~30 per stat.

Do not touch app/ code. FEAT-4 handles UI surfacing.

Commit clean with row counts in the body.
```

**Notes / risks:** wOBA constants drift year over year — use a
fixed 2025 set and note in the commit we should revisit if
adding 2024 backfill.

---

### DERIV-2 — Bullpen fatigue gold aggregate

**Lane:** derivation
**Status:** unblocked · **Blocks:** FEAT-5
**Scope:** Compute 3-day and 7-day appearance + pitch count per
reliever from existing boxscore data. Produces
`gold_reliever_workload`.

**Acceptance criteria:**

- New gold table `gold_reliever_workload` with columns: player_id,
  team_id, as_of_date, appearances_3d, appearances_7d,
  pitches_3d, pitches_7d, days_since_last.
- A reliever = non-starter (flag from existing silver data:
  starter heuristic IP/appearance ≥ 4).
- Materialization in `build_gold.sql`; runs in the hourly chain.
- Sample query validates: for the last 7 days, top 5 relievers
  by appearances_7d match intuition.

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql`

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-2.

Goal: materialize gold_reliever_workload from existing
silver_player_game_pitching data. Pure SQL, no new ingest.

Steps:
1. Define a reliever filter: at silver_player_game_pitching
   level, a pitcher's role on that day = 'starter' if
   innings_pitched >= 4, else 'reliever'. Add it as a derived
   column in a CTE.
2. For each reliever-team-date combo, compute rolling 3d and 7d
   sums over appearances and pitches_thrown ending at that date.
3. Materialize as gold_reliever_workload (player_id, team_id,
   as_of_date, appearances_3d, appearances_7d, pitches_3d,
   pitches_7d, days_since_last).
4. Validate: for 2026-04-23 ish (yesterday), top-5 relievers
   across MLB by appearances_7d should look like closers or
   setup men.

Do NOT surface this in app/ — that's FEAT-5.

Commit clean with example row output in the body.
```

**Notes / risks:** `pitches_thrown` exists per
silver_player_game_pitching row already.

---

### DERIV-3 — Strength of schedule gold aggregate

**Lane:** derivation
**Status:** unblocked · **Blocks:** FEAT-6
**Scope:** Per-team running strength-of-schedule: cumulative
opponent win% weighted by games played. Produces
`gold_team_sos`.

**Acceptance criteria:**

- `gold_team_sos` with columns: team_id, season, as_of_date,
  opp_win_pct, games_vs_winning_teams, games_vs_losing_teams.
- opp_win_pct is computed using each opponent's OTHER-team
  record (so CHC's SoS excludes CHC games from opponents' totals
  — canonical convention).
- Runs in build_gold.sql after silver/gold base tables.

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql`

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-3.

Goal: materialize gold_team_sos with running strength-of-schedule
per team per date.

Convention: opp_win_pct excludes the subject team's games from
each opponent's record. (Otherwise the metric is circular.)

Steps:
1. CTE: for each (subject_team, game_date), the list of
   opponents faced up to and including that date, weighted by how
   many times each was played.
2. CTE: each opponent's win% as of that date, EXCLUDING games vs
   subject_team.
3. Weighted sum → opp_win_pct.
4. Materialize as gold_team_sos.

Validate: on a team with an early-season brutal slate, opp_win_pct
should be >0.55 in April.

Commit clean with sample values for CHC and TEX in the body.
```

**Notes / risks:** The "exclude subject team" math is a common
gotcha — ensure the window function excludes subject_team games
from each opponent's totals, not just the matchup itself.

---

### DERIV-4 — WPA / clutch leaders gold aggregate

**Lane:** derivation
**Status:** blocked by: PIPE-0.5 · **Blocks:** FEAT-7
**Scope:** From `silver_play`, compute per-event win probability
(WPA) and leverage index. Aggregate into
`gold_player_clutch`: player_id, season, wpa_total, leverage_avg,
plate_appearances_in_leverage_above_2.

**Acceptance criteria:**

- WPA computed via a base-state × outs × score-differential
  win-probability table. Either hardcode a published table (Tom
  Tango's 1969-92 table is public, updated versions also
  published) or compute from silver_play empirically on the
  multi-year backfill (requires PIPE-3).
- Leverage index = (home_win_prob_change + away_win_prob_change)
  / average_change_league.
- `gold_player_clutch` materialized; top 20 by wpa_total for the
  current season look plausible.

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql`
- OPTIONAL NEW `jobs/gold/wpa_table.sql` (if hardcoding lookup)

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-4.
PIPE-0.5 landed; silver_play exists.

Goal: WPA / leverage / clutch leaders from play-by-play.

There are two implementation paths:
  A. Hardcode a public win-probability table (base-state × outs ×
     score_diff → win_prob) and look up each play's delta.
  B. Compute the table empirically from silver_play over the
     multi-year backfill, averaging outcomes.

Recommend path A for v1 (fewer moving parts, faster). Use Tom
Tango's 1969-2000 table as the reference; cite in a SQL comment.

Steps:
1. Encode the lookup as a static SQL array or a tiny reference
   table.
2. For each silver_play row, compute home_win_prob_before and
   home_win_prob_after. wpa = after - before for the team at
   bat; batter gets signed wpa, pitcher gets inverse.
3. Leverage index: normalize change magnitude against league avg.
4. Aggregate by (batter_id, season) for batter_clutch and
   (pitcher_id, season) for pitcher_clutch.
5. Materialize gold_player_clutch with the union.

Validate: top 20 current-season WPA leaders should include the
big names on good teams — sanity eyeball only.

Commit clean.
```

**Notes / risks:** The WPA lookup table is well-documented;
don't invent your own.

---

### DERIV-5 — Milestone / "first-since" scanner

**Lane:** derivation
**Status:** blocked by: PIPE-3 · **Blocks:** FEAT-8
**Scope:** Scan historical silver data (requires multi-year
backfill) for first-since-X events of the last 7 days:
team-level (winning streaks, run differential benchmarks) and
player-level (first multi-HR game since X, first shutout since X,
hitting streaks).

**Acceptance criteria:**

- New gold table `gold_milestone_events`: row per detected
  milestone in the last 7 days, with narrative-ready fields
  (team_or_player, event_text, comparison_year, happened_on).
- At least 3 classifier kinds implemented: team winning streak
  (N-game), player hitting streak (N-game), player multi-HR
  game since X.
- Re-running is idempotent (no dupes).
- Populates after DERIV-5 runs nightly (or hourly — agent choose).

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql` OR NEW
  `jobs/gold/milestones.sql`
- POSSIBLY NEW `jobs/gold/milestone_classifiers.py` if SQL-only
  gets unwieldy

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-5.
PIPE-3 landed; 2020+ bronze/silver exists.

Goal: detect narrative-ready milestone events from the last 7
days with historical "first since X" context.

Minimum classifier set:
  1. Team winning streak of N games — look back to find the most
     recent longer streak.
  2. Player hitting streak of N games — same lookup.
  3. Player multi-HR game — most recent prior multi-HR game for
     that player; if none, "first of career".

Steps:
1. Design gold_milestone_events columns:
   subject_type ('team'|'player'), subject_id, event_kind,
   event_text, comparison_year (nullable), happened_on, season.
2. SQL or Python — your call. SQL is cleaner if the lookbacks can
   be expressed as window functions; Python is cleaner if the
   narrative templating gets gnarly.
3. Idempotency: upsert keyed on (subject_id, event_kind,
   happened_on).
4. Run on the current season. Eyeball 5 generated rows for
   plausibility.

Commit clean with 5 example rows in the body.
```

**Notes / risks:** The 2020 shortened season will generate some
false "first since 2020" claims that are really artifacts of
that year. Optionally filter out or flag in `notes`.

---

### DERIV-6 — Weekly digest LLM job

**Lane:** derivation (mixed — uses LLM)
**Status:** unblocked · **Blocks:** FEAT-9
**Scope:** Sunday 5:00 ET job runs a new LLM prompt per primary
team, producing a single-paragraph "this week in X baseball"
summary from last-7-days gold data.

**Acceptance criteria:**

- New table `gold_weekly_digest`: row per (team_id, week_start).
- Prompt assembles: weekly record, run differential, streaks,
  milestone events from DERIV-5 if present, recap headlines from
  `gold_game_recap`.
- Reuses existing Haiku/Anthropic infra (Databricks Foundation
  Model Serving) — same pattern as `generate_recaps.py`.
- Runs from a new Sunday-scheduled bundle job OR a conditional
  task in `morning_recaps_job.yml`.
- Idempotent: re-running skips weeks already populated (unless
  `force=True`).

**Files expected to change:**

- NEW `jobs/digest/generate_weekly_digest.py`
- NEW `jobs/digest/prompts/weekly_digest.md`
- NEW `resources/weekly_digest_job.yml` OR modify
  `resources/morning_recaps_job.yml`

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-6.

Goal: a Sunday 5:00 ET LLM job that writes "this week in CHC
baseball" paragraphs and persists them.

Steps:
1. Mirror the structure of jobs/recaps/generate_recaps.py —
   same Databricks Foundation Model Serving pattern. Do NOT
   rewrite that file; copy the idioms.
2. New prompt at jobs/digest/prompts/weekly_digest.md. Input
   variables: team_name, week_record, week_run_diff,
   best_win_detail, worst_loss_detail, streaks_text,
   milestones_text, top_performer_text. Output: single
   paragraph, 80-120 words, same voice as the recap prompt
   (AP-wire, no em-dashes, first team mention = full name, no
   forbidden words list identical to v2).
3. new_weekly_digest_job.yml scheduled
   `0 0 5 ? * MON *` America/New_York. Runs after the Monday
   hourly refresh + morning recap complete.
4. Idempotent gating: skip weeks where gold_weekly_digest
   already has a row for (team_id, week_start=Monday).
5. Backfill flag: --force rewrites.

Only produce digests for primary_team values actually pinned by
real users (for now, CHC and whatever secondary teams end up in
preferences). Don't generate for all 30.

Do not surface in UI — that's FEAT-9.

Commit clean.
```

**Notes / risks:** LLM cost is ~$0.01 per digest; generating for
30 teams every week is ~$1.50/mo — fine even at MLB-wide scale.
v1 only generates for primary-team picks; DERIV-7 extends to all 30
once FEAT-9 needs them.

---

### DERIV-7 — Extend weekly digest job to all 30 teams

**Lane:** derivation (LLM)
**Status:** unblocked · **Blocks:** FEAT-9
**Scope:** Today `weekly_digest_job` only generates rows for primary
teams pinned by real users (CHC + occasional secondary). Extend it to
write a digest for every team_id every Sunday so FEAT-9 can render on
any team page, not just the primary's.

**Acceptance criteria:**

- `gold_weekly_digest` has a row for every active team_id at the
  most recent week_start.
- `--force` rewrites all teams; default skips weeks already populated
  per (team_id, week_start).
- Prompt framing no longer assumes "primary team" — works for any
  team name. Voice unchanged.
- Cost stays in the ~$0.30/Sunday / ~$1.50/month range already noted
  in DERIV-6's risks (no batching needed).

**Files expected to change:**

- MODIFY `jobs/digest/generate_weekly_digest.py`
- MODIFY `jobs/digest/prompts/weekly_digest.md` (if framing changes)

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-7.

Goal: weekly_digest_job currently iterates over a hardcoded short list
of primary teams (see generate_weekly_digest.py). Replace that loop
with the full set of active team_ids from silver_team for the current
season. Everything else stays the same — prompt, idempotency,
scheduling, output table.

Steps:
1. Replace the primary-team source with a query against silver_team
   (active teams for the current season).
2. Audit the prompt template at jobs/digest/prompts/weekly_digest.md
   for any "primary team" framing — neutralize so it reads naturally
   for the Rockies, Royals, etc.
3. Confirm idempotency gate keys on (team_id, week_start) — should
   already be the case.
4. Run a one-shot --force backfill against the most recent week and
   spot-check 3 random non-primary teams' digest_text quality.

Do not change the schedule or surface in UI — FEAT-9 handles surfacing.

Commit clean.
```

**Notes / risks:** None — cost was already vetted in DERIV-6.

---

### DERIV-8 — Deprecate orphaned gold tables (FEAT-5/6/7 cleanup)

**Lane:** derivation (cleanup)
**Status:** unblocked · **Blocks:** none
**Scope:** Three derivation tables lost their only UI consumers when
Wave 4 features were abandoned. All three are leaves in the
dependency map — no downstream gold or app query reads them.

| Table | DERIV ticket | Abandoned consumer |
|---|---|---|
| `gold_player_clutch` | DERIV-4 | FEAT-7 (clutch leaders widget) |
| `gold_team_sos` | DERIV-3 | FEAT-6 (SoS tooltip) |
| `gold_reliever_workload` | DERIV-2 | FEAT-5 (bullpen fatigue) |

**Don't blanket-deprecate.** When this ticket runs, the agent must
prompt the user per-table: keep building it (might be used in a
future feature) or actually drop it (clear it out). The agent should
not delete any CTE block or run any `DROP TABLE` until the user
confirms per-table — some of these metrics may earn a different
home later and the user wants the choice.

PIPE-2 (`silver_transaction`, orphaned by FEAT-13) follows the same
"ask first" rule. Mention it in the prompt and let the user decide
whether to keep ingesting roster moves.

**Acceptance criteria:**

- Each table's CTE block removed from `jobs/gold/build_gold.sql`.
  For `gold_player_clutch`, that's ~250 lines (header through
  spot-check, including base_out_re / plays_with_after / plays_pa /
  league_avg / plays_lev / batter_agg / pitcher_agg / all_agg).
  `gold_team_sos` and `gold_reliever_workload` are smaller blocks.
- All three live tables dropped from UC after the next hourly run
  confirms nothing else regresses.
- DERIV-2/3/4 tickets marked deprecated in BACKLOG.md.
- Dependency map + Wave 3 progress row footnote each as
  retired-by-DERIV-8.

**Files expected to change:**

- MODIFY `jobs/gold/build_gold.sql` (delete three CTE blocks)
- MODIFY `BACKLOG.md` (mark DERIV-2/3/4 deprecated)
- One-shot SQL:
  - `DROP TABLE IF EXISTS gold_player_clutch`
  - `DROP TABLE IF EXISTS gold_team_sos`
  - `DROP TABLE IF EXISTS gold_reliever_workload`

**Agent prompt:**

```
You are in a git worktree branched off main, working on DERIV-8.

Goal: clean up gold tables orphaned by abandoned Wave 4 features
— BUT don't assume "abandoned consumer" means "drop the table."
The user wants to decide per-table because some of these metrics
might find a future home.

STEP 0 — Ask the user (BEFORE any code or SQL changes):

Present this list and ask for a per-row decision (drop / keep):

  - gold_player_clutch (DERIV-4) → consumer FEAT-7 abandoned
  - gold_team_sos       (DERIV-3) → consumer FEAT-6 abandoned
  - gold_reliever_workload (DERIV-2) → consumer FEAT-5 abandoned
  - silver_transaction  (PIPE-2)  → consumer FEAT-13 abandoned
                                    (mention but ingest path is
                                    different from gold tables)

For each, the user picks one of:
  (a) DROP   — delete the build block from build_gold.sql / refine
               job, drop the live table, mark the DERIV/PIPE ticket
               deprecated.
  (b) KEEP   — leave the build alone, add a one-line "kept pending
               future use" note on the DERIV/PIPE ticket so a
               future reviewer knows it's deliberately orphaned.

WAIT for the user's answer before touching anything.

STEP 1 — For each table the user said DROP:
  - Remove its CTE block from jobs/gold/build_gold.sql (or for
    silver_transaction, neutralize the refine job — easier path is
    leaving the ingest off-schedule rather than deleting code).
  - Verify no other CTE references the deleted block.
  - Run `databricks bundle validate` to confirm SQL parses.

STEP 2 — Drop the live tables the user picked DROP for, AFTER the
next hourly pipeline run confirms the SQL change didn't regress
anything. Use:
  DROP TABLE IF EXISTS
    production_forecasting_catalog.ak_baseball.<table>;

STEP 3 — BACKLOG.md updates:
  - For DROP tables: mark the source DERIV/PIPE ticket deprecated
    with reason "Consumer FEAT-X abandoned; table removed via
    DERIV-8".
  - For KEEP tables: add a one-line note on the source ticket
    ("Kept pending future use — orphaned 2026-04-XX, no current
    consumer").
  - Strike any remaining stale dependency-map / unblocked-list
    references.

Do not touch app/ — FEAT-5/6/7 UI work was already discarded with
their branches.

Commit clean.
```

**Notes / risks:** The blanket "drop everything" instinct is wrong
here — the user wants explicit per-table calls because some metrics
may resurface. Worst case for KEEP tables: ~hourly compute cost on
data nobody reads, which is negligible.

---

### FEAT-1 — Matchup preview on Today's Games

**Lane:** server + client
**Status:** unblocked (soft-blocked on ARCH-1 for perf feel)
**Scope:** Clicking a projection card on the League page expands
it inline to show matchup context: probable pitcher's ERA / K9
(percentile tick vs league), top 3 hitters per team with
last-10-game OPS, head-to-head season record, pitcher LHP/RHP
split.

**Acceptance criteria:**

- Click on a projection card → inline expansion. Second click or
  ESC → collapse. At most one card expanded at a time.
- Pitcher's ERA and K/9 each render as a spark strip-plot
  (reuse `StatDistributionChart` detail='spark') with the
  pitcher's dot highlighted.
- Top-3 hitters per team shown as a mini table: player name,
  last-10-game OPS (formatted MLB-style no-leading-zero).
- H2H record shown as `CHC 3-4 vs TEX · last: Apr 14`.
- LHP/RHP split only renders when backend returns both — else
  omit the line.
- No layout shift of adjacent projection cards (grid preserves
  their positions — expand happens below the clicked card,
  pushing subsequent rows down).

**Files expected to change:**

- NEW `app/server/src/routes/matchup.ts`
- NEW `app/server/src/queries/matchup.ts`
- NEW `app/client/src/components/MatchupPanel.tsx`
- MODIFY `app/client/src/components/NewsSection.tsx`
- MODIFY `app/shared/types/projection.ts` (post-ARCH-4) OR
  `types.ts` (pre-ARCH-4) — add `MatchupResponse`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-1.
Read BACKLOG.md §FEAT-1 for full scope.

Build a new GET /api/matchup/:gamePk endpoint returning:
{
  pitcher: {home, away}        // each: id, name, era, k9,
                               //       lhp/rhp splits if available
  topHitters: {home, away}     // each: array of 3 {id, name,
                               //       last10_ops}
  h2hRecord: {homeWins, awayWins, lastGameDate}
}

Server side:
- matchup.ts queries silver_player_season (pitcher + top 3
  hitters by AB qualifying) and silver_game (h2h in this season).
- Last-10 OPS comes from silver_player_game_batting aggregated
  over last 10 games. Guard for players with <10 games.
- LHP/RHP split: check silver_player_game_pitching for batter
  handedness. If the data isn't cleanly split, return null and
  client omits the line.

Client side:
- MatchupPanel.tsx takes a projection row and renders the
  expanded UI.
- Reuse StatDistributionChart in detail='spark' for each pitcher
  metric tick. No new chart components.
- Wire into NewsSection.tsx: onClick of a projection card toggles
  expansion state; panel slides in below the card.

Style: existing light theme, monospace, no gradients. Matchup
panel takes the full card width when expanded.

Verify:
- ./scripts/dev.sh, open /, click a projection, confirm panel
  renders with real data.
- ESC closes the panel.
- Network tab shows one GET /api/matchup/:gamePk call per
  expansion.

Do NOT touch jobs/ or pipeline. Commit clean.
```

**Notes / risks:** LHP/RHP split data may not exist in current
silver schema; if so, return null and document in commit —
future pipeline ticket handles it.

---

### FEAT-2 — Team-vs-team trajectory + strip-plot overlay

**Lane:** client
**Status:** unblocked · **Blocks:** none
**Scope:** On the team page, a "Compare to [dropdown]" control
adds a second trajectory line and a second set of outlined
callouts across all strip plots. The other team's data piggybacks
on already-fetched league/team queries.

**Acceptance criteria:**

- New "Compare to" select dropdown above the trajectory,
  populated with all 30 teams (grouped by division).
- Selected team's trajectory line renders alongside the current
  team's. Color = that team's primary color. Same hover behavior.
- On every strip plot, the compared team's dot gains a secondary-
  tier outline (reuse the existing `primary` feature kind
  styling).
- Sticky: compared team persists via PreferencesContext as
  `comparisonTeam` (distinct from `secondaryTeam`).
- "Clear" option removes the comparison.

**Files expected to change:**

- MODIFY `app/client/src/pages/TeamPage.tsx`
- MODIFY `app/client/src/charts/DivisionTrajectoryChart.tsx`
- MODIFY `app/client/src/lib/preferences.tsx`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-2.

Goal: add a "Compare to <team>" comparison on the team page. One
dropdown, one extra trajectory line, one outlined callout on
every strip plot. Reuses existing data.

Implementation notes:
- The compared team's trajectory is already in leagueQ.data — no
  new fetch needed.
- DivisionTrajectoryChart accepts a `trajectories` array. Pass
  both the current team's and the compared team's (filtering
  other teams out if the user is in 'yoy' mode; in 'division'
  mode keep all team lines and just highlight the compared one).
- StatDistributionChart already supports primary/secondary
  callouts. Feed the comparison team as the `secondary` prop on
  the component so its dot picks up the existing outlined style.
- Persist selection in PreferencesContext under `comparisonTeam`
  (can reuse localStorage key convention).

Visual: on strip plots, the current team stays the biggest +
darkest-outlined dot; compared team is one tier down. No new
color system.

Verify:
- /team/CHC, pick TEX from the Compare dropdown.
- Trajectory shows two lines.
- Each expanded stat row shows CHC's big dot + TEX's outlined
  dot.
- Reload → comparison survives.

Do not touch server code or pipeline. Commit clean.
```

**Notes / risks:** Coordinate with FEAT-10 (theming) — both
touch `preferences.tsx`. Rebase the later of the two.

---

### FEAT-3 — Clickable game on trajectory → drawer

**Lane:** server + client
**Status:** unblocked · **Blocks:** none
**Scope:** Clicking a specific GAME point on a trajectory line
(not the label / team abbrev) opens a drawer with that game's
final score, box-score link, top performer, and (if available)
Elo-delta. Clicking the team ABBREV (end-of-line label)
continues to navigate to the team page. This resolves the
conflict noted in the brainstorm.

**Acceptance criteria:**

- New hit zones in `DivisionTrajectoryChart`: each game point
  gets a small invisible click hit area distinct from the
  existing wide line hover.
- Clicking the game point opens a drawer (fixed at the bottom of
  the chart area) with:
  - Final score (e.g., `CHC 7 – TEX 3 · Apr 15`)
  - Winning pitcher / losing pitcher
  - Top performer (from existing `gold_game_recap_input`)
  - Link to Savant box score
  - Close button + click-outside to dismiss
- Clicking the end-of-line team abbrev still navigates to that
  team's page (existing behavior preserved).
- Clicking the line away from a point still highlights the team
  (existing behavior).

**Files expected to change:**

- MODIFY `app/client/src/charts/DivisionTrajectoryChart.tsx`
- NEW `app/client/src/components/GameDrawer.tsx`
- MODIFY `app/server/src/routes/game.ts` OR
  `app/server/src/routes/league.ts` to expose
  `GET /api/game/:gamePk/summary`
- NEW `app/server/src/queries/game.ts` (if not already present)

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-3.

Goal: clicking a single game point on a trajectory opens a
drawer with that game's summary. Disambiguate from:
  - clicking the line (currently: highlights the team)
  - clicking the team abbrev at the end (currently: navigates)

Approach:
1. Add an invisible <circle r={6} fill=transparent> per point in
   DivisionTrajectoryChart. Clicking it opens the drawer.
2. Stop click propagation so the outer group's line-click
   navigation doesn't fire.
3. GameDrawer.tsx: bottom-anchored panel inside the chart card.
   Smooth slide up/down, 280ms ease — match existing transitions.
4. Server: new GET /api/game/:gamePk/summary returning
   {score, winningPitcher, losingPitcher, topPerformer,
   boxScoreUrl} from silver_game + gold_game_recap_input +
   silver_player_game_batting/pitching.
5. Use the Savant URL helper in app/client/src/lib/savant.ts
   for the box-score link.

Do not break existing hover crosshair or end-of-line abbrev
nav. Write a one-liner test path in the commit body that you
clicked (a) line, (b) point, (c) abbrev — and each did the right
thing.

Commit clean.
```

**Notes / risks:** SVG click precedence can be finicky; use
`onClick` + `stopPropagation` carefully. If hover and click fight
each other, hover wins unless the click target is above the
line in DOM order.

---

### FEAT-4 — xwOBA / wOBA card on team page

**Lane:** client
**Status:** blocked by: DERIV-1, ARCH-1 · **Blocks:** none
**Scope:** Surface xwOBA, wOBA, xBA in the team page stat cards.
With ARCH-1's bulk endpoint in place, this is mostly a matter of
adding the three stats to STAT_ORDER and confirming they render.

**Acceptance criteria:**

- `xwoba`, `woba`, `xba` rows appear in the `batting` category
  on the team page.
- Values render MLB-style (no leading zero).
- Strip plots (30-team) and player-level distribution work out
  of the box via existing infrastructure.
- Tier assignment (ARCH-2, if shipped): `xwoba` default, `woba`
  and `xba` expanded.

**Files expected to change:**

- MODIFY `app/client/src/pages/TeamPage.tsx` (add to STAT_ORDER,
  STAT_DEFINITIONS)
- MODIFY `app/server/src/queries/index.ts` (extend
  `PLAYER_STAT_SPECS` for player-level distribution)

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-4.
DERIV-1 has landed; xwoba/woba/xba rows exist in
gold_team_stat_vs_league. ARCH-1 has landed; bulk endpoint is
in place.

Steps:
1. Add to STAT_ORDER + STAT_DEFINITIONS in
   app/client/src/pages/TeamPage.tsx:
     xwoba: 'xwOBA — "earned" weighted on-base based on contact
             quality. Good for spotting regression candidates.'
     woba: 'wOBA — weighted on-base average.'
     xba:  'xBA — expected batting average from contact quality.'
   Category: batting.
2. Extend PLAYER_STAT_SPECS in
   app/server/src/queries/index.ts so the expanded row's
   player-level distribution query works. Point at
   silver_player_season fields (assuming DERIV-1 populated
   player-level xwoba there — if not, point at
   gold_player_expected_stats).
3. If ARCH-2 shipped, set tier: xwoba → default, woba/xba →
   expanded.
4. Verify: /team/CHC, scroll to batting, confirm three new rows
   render with strip plots and percentiles.

Do not touch pipeline / gold. Commit clean.
```

**Notes / risks:** If DERIV-1 stored per-player xwoba in
`gold_player_expected_stats` (not `silver_player_season`), the
player-distribution query needs to join accordingly.

---

### FEAT-5 — Bullpen fatigue surface on team page — **ABANDONED 2026-04-28**

**Lane:** client + server
**Status:** abandoned · **Blocks:** none

**Why abandoned:** Built cleanly (worktree commit `d7c1c64`) but the
scope didn't survive review. User's call: not enough thought went
into whether a bullpen-usage card earned its place on the team page.
`gold_reliever_workload` (DERIV-2) becomes orphaned; cleanup folded
into DERIV-8.

**Tables that powered the runtime query** (preserved for context):
- `gold_reliever_workload` (DERIV-2 output)
- `silver_team`
**Scope:** A compact card below the next-game projection showing
the team's high-leverage relievers' 3-day / 7-day usage so the
fan can intuit "we might not have Alzolay tonight."

**Acceptance criteria:**

- New card section on team page titled "Bullpen usage — last 7
  days".
- Table: player, appearances (3d / 7d), pitches (3d / 7d), days
  since last appearance.
- Sorted by 7d appearances desc.
- Only top 7 relievers shown (avoid clutter).
- Hover on a player name links out to Savant profile.

**Files expected to change:**

- NEW `app/server/src/routes/bullpen.ts`
- NEW `app/server/src/queries/bullpen.ts`
- NEW `app/client/src/components/BullpenUsage.tsx`
- MODIFY `app/client/src/pages/TeamPage.tsx`
- MODIFY `app/shared/types/team.ts`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-5.
DERIV-2 has landed; gold_reliever_workload exists.

Steps:
1. Server: GET /api/team/:teamId/bullpen → array of top-7
   relievers by appearances_7d, each with name, appearances_3d,
   appearances_7d, pitches_3d, pitches_7d, days_since_last.
2. Client: BullpenUsage.tsx renders a compact table in the
   existing card style. No new charts — just text + monospace.
3. Slot it below the trajectory card on the team page.
4. Savant link on player name using existing helper.

Styling: match the "Last 10" games table shape that already
exists on the team page. Rows shouldn't get their own dots or
charts — this is a text card by design.

Verify:
- /team/CHC, scroll below trajectory, see bullpen usage table.
- Names are real. Numbers pass sniff test (closers appear
  frequently).

Commit clean.
```

**Notes / risks:** Very unused relievers should still appear if
they're on the roster — cap the sort before returning top 7,
don't filter-out early in SQL.

---

### FEAT-6 — Strength of schedule tooltip — **ABANDONED 2026-04-28**

**Lane:** client + server
**Status:** abandoned · **Blocks:** none

**Why abandoned:** Built cleanly (worktree commit `e6a45c1`) but the
scope didn't survive review. User's call: SoS as a single-number-
with-tooltip didn't earn its real estate on the team header.
`gold_team_sos` (DERIV-3) becomes orphaned; cleanup folded into
DERIV-8.

**Tables that powered the runtime query** (preserved for context):
- `gold_team_sos` (DERIV-3 output)
- `silver_team` (already on the page)
**Scope:** Small tooltip on the team record line showing
current-season SoS: `55-45 (SoS: .547)` with hover explaining
what SoS means and flagging whether it's tough / easy / average.

**Acceptance criteria:**

- Team page header record line now includes `· SoS: .547` after
  the existing record + expected (if FEAT-17 Pythagorean
  shipped).
- Hovering the SoS value shows a tooltip: "Opponent win% against
  other teams. League average is .500. Higher = tougher slate."
- Color flag: .520+ red-accent, .480- green-accent, neutral
  otherwise. Subtle — no badge, just text tint.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts` — extend team
  response with `strengthOfSchedule`.
- MODIFY `app/shared/types/team.ts`
- MODIFY `app/client/src/pages/TeamPage.tsx`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-6.
DERIV-3 has landed; gold_team_sos exists.

Steps:
1. Server: add strengthOfSchedule to getTeamFromWarehouse's
   response — just a number 0..1, plus classification
   ('tough'|'easy'|'average').
2. Client: TeamPage header updates to include SoS. Tooltip on
   hover with the explanation above.
3. Subtle color tint only — no badges, no icons.

Verify on /team/CHC: SoS shows a real value; hover explains.

Commit clean.
```

**Notes / risks:** Keep the tooltip copy short and information-
dense — match the voice everywhere else.

---

### FEAT-7 — Clutch / WPA leaders widget — **ABANDONED 2026-04-28**

**Lane:** client + server
**Status:** abandoned · **Blocks:** none
**Scope:** On the League page or Team page (TBD after
placement review), a small section titled "Clutch leaders"
showing the top 5 MLB batters by wpa_total, and the top 5
pitchers. Each row: player, team color, wpa_total.

**Why abandoned (postmortem):** Implementation worked end-to-end; the
problem was the metric itself in our v1 form. DERIV-4's coarse
logistic + RE24-delta WP model has a known starter-bias (acknowledged
in the SQL header TODO) that's sharp enough to flip the leaderboard:
- Per warehouse spot-check: 1318/1829 batters net-positive WPA, but
  only 141/1489 pitchers. Avg pitcher WPA −0.36 vs avg batter +0.30.
- Spot-check elite 2026 arms in our data: José Soriano (LAA) −0.07,
  Ohtani −0.39, Skenes −0.66, Riley O'Brien −0.84, Boyd −1.35. Those
  read wrong even after acknowledging WPA's ordinary starter penalty.
- Top-5 pitchers became a closer-only list (Iglesias, Helsley, Mason
  Miller). Honest reading of what the model measures, but reads weird
  to a user expecting "best pitcher" semantics.

We considered: (A) shipping with a "based on internal leverage model"
disclaimer, (B) splitting starters/closers, (C) gating the ticket on a
DERIV-4 v2 with canonical Tango WP tables. Decided none of those was
worth the screen real estate or the v2 work right now.

**Tables that powered the runtime query** (in case clutch data finds
a different home later):
- `gold_player_clutch` (DERIV-4 output)
- `silver_player_season` (team_id, plus at_bats / innings_pitched /
  pitching_games for qualifier)
- `silver_team` (abbrev, primary_color)
- `silver_team_game` + `silver_game` (per-team games-played, for the
  qualifier scaling — added late in review)

**Acceptance criteria:**

- Small section below the HR race widget OR as a sibling card.
- 5 batters + 5 pitchers, named, with wpa_total as a monospace
  signed number.
- Clickable → Savant player page.
- Primary team's top clutch player bolded if in the top 5.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts` — add
  `getClutchLeadersFromWarehouse`.
- MODIFY `app/server/src/routes/league.ts`
- NEW `app/client/src/components/ClutchLeaders.tsx`
- MODIFY `app/client/src/pages/LeaguePage.tsx`
- MODIFY `app/shared/types/league.ts`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-7.
DERIV-4 has landed; gold_player_clutch exists.

Steps:
1. Server: GET /api/league/clutch-leaders returning
   {batters: [...], pitchers: [...]} each top-5 by wpa_total.
2. Client: ClutchLeaders.tsx — two stacked mini-tables side by
   side on wide screens, stacked vertically on phones. No charts.
3. Placement: League page, below HR race. No new nav entry.

Keep it text-dense, monospace, small font for stats.

Verify on /, scroll below HR race, confirm 10 real players
render with sensible numbers.

Commit clean.
```

**Notes / risks:** WPA units are in wins (decimal, e.g., +2.1).
Format as `+2.1` with signed leading.

(Original notes preserved above for context. Ticket abandoned —
see header postmortem.)

---

### FEAT-8 — Milestone callouts on home page

**Lane:** client + server
**Status:** blocked by: DERIV-5 · **Blocks:** none
**Scope:** Above the Today's Games card, a short narrative
strip: "CHC won their 5th in a row — longest streak since 2017
(8 games). Pete Crow-Armstrong hit his first career grand slam
yesterday." Rotates through the most recent milestones. Max 3
shown at once.

**Acceptance criteria:**

- New section at top of home page, above Today's Games.
- Pulls last 7 days of milestone events, prioritized by:
  (1) primary team involvement, (2) rarity (older "first since"),
  (3) recency.
- Max 3 items, each ~1 sentence.
- Styling: card with light team-primary tint when about the
  primary team.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts`
- MODIFY `app/server/src/routes/league.ts`
- NEW `app/client/src/components/MilestoneStrip.tsx`
- MODIFY `app/client/src/pages/LeaguePage.tsx`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-8.
DERIV-5 has landed; gold_milestone_events exists.

Steps:
1. Server: GET /api/league/milestones → top 3 recent milestones,
   sorted per the priority rule in BACKLOG.md.
2. Client: MilestoneStrip.tsx — one row per milestone, each
   rendering the event_text verbatim from gold_milestone_events.
3. Primary team milestones get a subtle team-color left border
   (existing pattern from recap cards).

Keep copy tight. No illustrations.

Commit clean.
```

**Notes / risks:** Make sure 2020-season artifacts
("first since 2020") are either suppressed or prefixed with
"(short season)" — DERIV-5's commit noted this.

---

### FEAT-9 — Weekly digest card on team page

**Lane:** client + server
**Status:** blocked by: DERIV-7 · **Blocks:** none
**Scope:** A prose "this week in <team name> baseball" card on every
team page, sourced from `gold_weekly_digest`. Replaces the original
home-page-primary-only design — surfacing on team page lets every
team have one without requiring the user to pin them.

**Acceptance criteria:**

- New card on team page below the header / above the trajectory chart
  (placement TBD during review).
- Server route `GET /api/team/:teamId/digest` returns the most recent
  digest row for that team, or 404 if none.
- Card hides when API returns 404 OR when today > week_end + 4 days
  (i.e. Friday onward of the new week — so Sun–Thu of the new week
  still render the prior Mon–Sun digest).
- Voice: serif body slightly larger than recap-body so it reads as
  prose; monospace byline like `WEEKLY DIGEST · ATL`.
- Tint: subtle team-color tint + 3px left border on the user's
  primary team only. Other team pages: neutral border.
- Opening-day / pre-first-Sunday: card silently absent.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts`
- MODIFY `app/server/src/routes/team.ts`
- NEW `app/client/src/components/WeeklyDigest.tsx`
- MODIFY `app/client/src/pages/TeamPage.tsx`
- MODIFY `app/shared/types/team.ts`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-9.
DERIV-7 has landed; gold_weekly_digest is populated for every team.

Steps:
1. Server: add GET /api/team/:teamId/digest. Most-recent row by
   week_start desc, joined to silver_team for name + primary_color.
   Return 404 when no row.
2. Client: WeeklyDigest.tsx takes teamId + isPrimary as props. Card
   with monospace byline ("WEEKLY DIGEST · <abbrev>"), headline
   ("This week in <team name> baseball"), subtitle ("Week ending
   <Month Day>"), serif body at 1.1rem.
3. Mount on TeamPage above the trajectory chart. Compute isPrimary
   from PreferencesContext; pass to component.
4. Hide-after threshold: today > week_end + 4 days, computed
   client-side via DST-safe component math (mirror NewsSection's
   shiftIsoDate helper).

Visual style: serif body, monospace byline. Primary-team tint =
border-left 3px team-color + linear-gradient(to right, ${color}14,
var(--bg-elev) 40%). Non-primary teams: 1px neutral border.

Add WeeklyDigestResponse to app/shared/types/team.ts. Barrel
auto-re-exports.

Verify: cd app && npm run build clean. Visit /team/CHC and
/team/COL — both render their own digests when present.

Commit clean with message:
  FEAT-9: weekly digest card on team page
```

**Notes / risks:** Originally scoped as a home-page card for the
primary team only (Wave 4); rescoped after first attempt revealed
the "30 teams or 1?" question. Per-team coverage handled by DERIV-7.

---

### FEAT-10 — Primary-team theming (subtle tints)

**Lane:** client
**Status:** unblocked (pending open question 5 on logos) ·
**Blocks:** none
**Scope:** Tint a handful of UI elements with the primary team's
color at 8–12% opacity: card backgrounds on team page, active
nav, left border on relevant recap cards.

**Acceptance criteria:**

- Team page hero card and trajectory card gain a subtle
  team-color tint (8% opacity background overlay).
- NavBar active link has a team-color underline or dot (pick
  one — match the existing minimal aesthetic).
- No tint on cards not about this team.
- CSS custom property `--primary-team-accent` populated at the
  page root so children can use it.

**Files expected to change:**

- MODIFY `app/client/src/pages/TeamPage.tsx` (set CSS var on
  page root)
- MODIFY `app/client/src/index.css`
- MODIFY `app/client/src/components/NavBar.tsx`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-10.

Goal: subtle primary-team color theming without breaking the
monochrome voice.

Implementation:
1. On TeamPage (and LeaguePage if the primary team is selected),
   set a CSS custom property --primary-team-accent on the page
   root, sourced from the team's primary_color.
2. Tint: card backgrounds gain an overlay of
   `rgba(var(--primary-team-accent-rgb), 0.08)`. The existing
   light theme stays legible.
3. NavBar active link: team-color underline, 2px, same color
   but full opacity.

No logos — per open question 5 we are using team-color dots /
monograms only.

No new dependencies. No animations.

Verify on /team/CHC: subtle blue tint across hero+trajectory
cards. Navigate to /team/TEX: tint changes to red. Home page
still untinted.

Commit clean.
```

**Notes / risks:** CSS custom property inheritance: the page
root sets it, children consume it. Make sure it's not set
globally (body) or it'd tint every page.

---

### FEAT-11 — ~~Interest chips on recap cards~~ *(Already shipped)*

**Status:** **already done.** `NewsSection.tsx:328-344` renders
the game-type pill (WALK-OFF, COMEBACK, PITCHING DUEL, BLOWOUT)
and interest score. The interest classifier is single-label by
design (elif chain in `jobs/recaps/interest.py`). Closing this
ticket.

*(If you want multi-label chips — e.g. "walkoff" + "rivalry" +
"last game of series" — that's a pipeline + prompt change. Lives
in `Deferred ideas` below.)*

---

### FEAT-12 — Recap inline player hyperlinks + tooltips

**Lane:** client + server
**Status:** unblocked · **Blocks:** none
**Scope:** In recap prose, convert every mentioned player name
into a link to their Savant profile. V2: hovering shows a
tooltip with season line (BA/HR/RBI for batters, W-L/ERA/K for
pitchers).

**Acceptance criteria:**

- Recap rendering pass detects player names (from the game's
  box score) and replaces with `<a href={savantPlayerUrl(id)}>`.
- Works for full names and common short references (e.g.,
  "Crow-Armstrong" after first-mention of "Pete Crow-Armstrong").
- V2 (may land as follow-up): hovering the link shows a tooltip
  with the player's season slash line or pitching line.
- No broken links: if a name can't be confidently matched to a
  player_id from that game's box score, leave it as plain text.

**Files expected to change:**

- MODIFY `app/client/src/components/NewsSection.tsx` OR new
  `app/client/src/lib/recapRenderer.ts`
- NEW `app/client/src/components/PlayerLink.tsx`
- MODIFY `app/server/src/queries/index.ts` — enrich recap
  response with a map `{playerName → playerId}` from the box
  score

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-12.

Goal: turn player mentions in recap text into Savant links.

Implementation:
1. Server: enrich the recap response with `players` — a map of
   `playerName → playerId` scoped to that game's box score (both
   teams). Already have the data; just format it.
2. Client: new `recapRenderer.ts` that takes (recap_text,
   players) and returns JSX with replaced <a> tags. Match on
   full name first, then a second pass on last-name-only.
3. PlayerLink component. V1: plain <a target="_blank"
   rel="noopener noreferrer"> to Savant. No tooltip yet (V2).
4. Style: underline on hover only, no default underline. Link
   color = text color. Don't break prose flow.

Edge cases:
- Two players with the same last name on the same team — fall
  back to plain text.
- Name already inside a quote — still link (Mark Grace says
  "Carson Kelly can hit" → Carson Kelly links).

Verify: click three different recap cards, confirm player names
are linked, non-player words (team names, locations) are not.

Commit clean with a note that V2 tooltip work is a follow-up.
```

**Notes / risks:** Name matching is fuzzy. Start conservative
(full name first, then unambiguous last-name). False positives
are worse than misses.

---

### FEAT-13 — Recent transactions section on League page — **ABANDONED 2026-04-28**

**Lane:** client + server
**Status:** abandoned · **Blocks:** none
**Scope:** A small paginated table below the recap section on the
League page showing the last 7 days of significant MLB roster moves
across all 30 teams. Single chronological list, most recent first.
Each row tagged with the affected team's primary color.

**Why abandoned (postmortem):** Two pivots before landing here, then a
third reconsideration killed it.
- v1 was inline ribbons on recap cards (`relevantTransactions` per
  game). Built clean, then discarded mid-review when "the scope feels
  wrong" surfaced — better as a section than a per-card ribbon.
- v2 was this standalone paginated table. Built clean, dev spot-check.
  The typeCode allowlist (`IL10/IL15/IL60/ACT/ACTV/DFA/SE/CU/RECALL/
  TR`) only matched ~66 rows over 7 MLB days because:
  - IL placements actually live under `SC` (Status Change) with the IL
    detail in the description text, not `IL10/IL15/IL60`.
  - The real DFA code in this data is `DES` (19 rows in 7d), not `DFA`
    (only 5 stale-format rows remained).
  - `ACT/ACTV/RECALL` don't appear in `silver_transaction` at all.
  Hybrid filter fix (`type IN (CU, SE, DES, DFA, TR, CLW) OR (type='SC'
  AND description LIKE '%injured list%')`) was a straightforward 2-line
  edit and would have lifted coverage to ~138 rows / 7d.
- Decided the broader question — does a transactions feed deserve
  screen real estate at all on this app? — was no. The recap cards
  already mention notable injuries inline when relevant, and the
  League page doesn't need another competing list.

**Tables that powered the runtime query** (in case transactions data
finds a different home later, e.g. recap enrichment):
- `silver_transaction` (PIPE-2 output)
- `silver_team` (abbrev, primary_color, plus implicit MLB-only filter
  via JOIN since silver_team is 30 MLB teams)

**Acceptance criteria:**

- New section below `NewsSection` on the League page titled
  "Recent transactions" (or similar — agent can pick).
- Server route `GET /api/league/transactions?days=7` returns all
  significant transactions in the last 7 days, sorted desc by
  effective_date then transaction_id. Capped to ~50 rows server-side.
- "Significant" filter on `transaction_type` (start with this
  allowlist; widen at review if useful types are missing):
    `IL10`, `IL15`, `IL60` — injury list placements
    `ACT`, `ACTV`        — activations off IL
    `DFA`                — designated for assignment
    `SE`                 — released
    `CU`, `RECALL`       — call-ups from minors
    `TR`                 — trades
  Exclude minor-league assignments, options to AAA, contract status
  noise.
- Display: small table with columns `date · player · team · move`.
  Date as "Apr 22"; team rendered as a small abbrev pill tinted in
  the team's primary color; move = `description` (fallback to
  `<typeCode>` if description is null).
- Pagination: client-side, 10 rows per page. Prev/Next pills below
  the table only when total > pageSize. No URL state.
- Empty array → section silently absent.

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts` (new
  `getRecentTransactionsFromWarehouse`)
- MODIFY `app/server/src/routes/league.ts` (new route)
- MODIFY `app/server/src/mocks/data.ts` (deterministic mock)
- NEW `app/client/src/components/RecentTransactions.tsx`
- MODIFY `app/client/src/pages/LeaguePage.tsx` (mount below
  `NewsSection`)
- MODIFY `app/shared/types/league.ts` (`TransactionEvent` +
  `RecentTransactionsResponse`)

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-13.
PIPE-2 has landed; silver_transaction exists.

CRITICAL DISCIPLINE: stay inside your worktree. Run `pwd` first
and confirm you are in `.claude/worktrees/agent-XXX/`. Use ONLY
relative paths in Edit / Write / Read / Bash. Do NOT touch
absolute paths like /Users/andrew.kraemer/projects/0_personal_repos/
ak_baseball/... — those leak edits into the main project tree.

Goal: a small paginated table on the League page showing the last
7 days of significant MLB roster moves across all 30 teams.

Steps:
1. Server: new getRecentTransactionsFromWarehouse(days=7) selecting
   from silver_transaction joined to silver_team for primary_color
   + abbrev. Filter on transaction_type IN allowlist:
     IL10, IL15, IL60, ACT, ACTV, DFA, SE, CU, RECALL, TR
   Order by effective_date DESC, transaction_id DESC. Cap to ~50
   rows server-side; client paginates within that.

2. Server: new route GET /api/league/transactions?days=7. Default
   days=7. Validate days as a small integer (1-30). Response shape:
   { transactions: TransactionEvent[] }.

3. Mocks: deterministic ~12 fake transactions in mocks/data.ts so
   dev mode renders the table.

4. Client: RecentTransactions.tsx — small text-dense table.
   Columns: date · player · team · move.
   Date format "Apr 22" (use a local plain-string parse like the
   FEAT-13-prior NewsSection.tsx had — no Date(), no timezone drift).
   Team column = small monospace abbrev pill with background color
   = primary_color at low opacity (e.g. ${color}1f), text in
   primary_color or contrast text. Pattern like an existing recap
   card's team-color treatment.
   Pagination: useState page index, 10 rows per page. Prev/Next
   pills below the table when total > pageSize.

5. Mount on LeaguePage.tsx below the existing NewsSection. Hide
   the entire section when the response is empty.

6. Voice: monospace for date and team-abbrev pill; sans for the
   description text. Small font (~0.78rem) consistent with other
   text-dense tables.

Add types to app/shared/types/league.ts:
  TransactionEvent {
    transactionId, playerId, playerName,
    transactionType, description, effectiveDate,
    teamAbbrev, teamColor
  }
  RecentTransactionsResponse { transactions: TransactionEvent[] }

DO NOT: touch jobs/, pipeline, or recap card files. The previous
FEAT-13 attempt (now discarded) tried to inline this on recap
cards — that's not the design anymore.

Verify: cd app && npm run build clean.

Commit in your worktree with message:
  FEAT-13: recent transactions section on League page
DO NOT push.

Report: branch, commit SHA, files changed (`git diff main --stat`),
build result, the SQL written, transaction_type counts you observed
in dev (helpful for tuning the allowlist), any caveats.
```

**Notes / risks:** Allowlist is a starting guess. If a frequently-
populated useful type is missing (or a noisy one slips through),
adjust at review time — easy one-line change.

Originally scoped (Wave 4 first attempt) as inline ribbons on
recap cards; rescoped after first impl revealed it read better as
a standalone league-wide section.

---

### FEAT-14 — Sum-stat chart UI fix (drop team-total line)

**Lane:** client
**Status:** unblocked · **Blocks:** none
**Scope:** On the expanded stat row for summed totals (Hits, HR,
BB, K-pitching), the current layout includes both a player-dot
chart and a team-total line chart. The team-total line makes
player dots cram together. Fix: remove the team-total line;
tooltip on each dot shows "X hits · Y% of team total".

**Acceptance criteria:**

- For stats in `SUM_STAT_KEYS` (hits_total, hr_total,
  walks_total, strikeouts_pitching_total), the lower chart
  renders only the player distribution — no team-total reference.
- Tooltip on each player dot adds a line: "Y% of team total"
  where Y = player_value / team_total × 100.
- Chart height stays the same or shrinks slightly; no weird
  whitespace.

**Files expected to change:**

- MODIFY `app/client/src/charts/TeamPlayerDistribution.tsx`
- MODIFY `app/client/src/pages/TeamPage.tsx` (adjust prop wiring
  for sum stats)

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-14.

Goal: for summed stats (HR, hits, walks, K-pitching), the
player chart should not include a team-total reference line.
Replace with % of team total in the hover tooltip.

Implementation:
1. TeamPlayerDistribution takes a new prop `hideTeamValue?:
   boolean` (default false). When true, skip rendering the
   team-value dashed tick.
2. In TeamPage.tsx, for SUM_STAT_KEYS pass hideTeamValue={true}
   AND pass teamValue (still needed for tooltip math).
3. Update the hover tooltip to include "Y% of team total" when
   hideTeamValue=true. Compute Y = value / teamValue * 100,
   format as one decimal.

Do NOT touch the non-sum stat path — it should keep showing
the team reference tick.

Verify: click HR on team page, confirm player chart has no
dashed line, dots are spread out, hover shows "% of team total".

Commit clean.
```

**Notes / risks:** None.

---

### FEAT-15 — "How to use" toggleable overlay

**Lane:** client
**Status:** unblocked · **Blocks:** none
**Scope:** A small `?` button in the nav opens a semi-transparent
overlay that annotates clickable / hoverable elements on the
current page. Dismiss with the same button or ESC.

**Acceptance criteria:**

- Small help icon in the NavBar (right-aligned, muted).
- Click toggles an overlay with subtle text callouts pointing at
  things the user might not know are interactive: "Hover a line
  for record at that date", "Click a dot to go to that team",
  "Click the ▸ chevron to expand stat details".
- Page-specific callouts: overlay knows which page it's on and
  annotates only relevant elements.
- Overlay dims the page behind it lightly so text stays
  readable; no blocking modal.
- ESC closes.

**Files expected to change:**

- NEW `app/client/src/components/HelpOverlay.tsx`
- MODIFY `app/client/src/components/NavBar.tsx`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-15.

Goal: a toggleable help overlay that points out interactive
elements on the current page.

Implementation:
1. HelpOverlay.tsx uses absolutely-positioned callouts (small
   arrows + labels) pointing at specific elements on the page.
   Label positions are hand-coded per page.
2. Content is context-aware — read the current route via
   useLocation and load the right callout set.
3. Pages to support at minimum: LeaguePage, TeamPage.
4. Dim background at ~30% opacity; overlay text is bright
   enough to read without hiding page state.
5. NavBar gets a help icon (a small circled ?). Click toggles.
6. ESC closes via useEffect + keyup listener.

Style: match the voice. No emojis, no cutesy copy. Tight,
informative: "Hover a line to see record at that date.",
"Click a stat row to expand details."

Commit clean.
```

**Notes / risks:** Callout coordinates will drift if UI moves.
Use data attributes (`data-help-anchor="trajectory-line"`)
that the overlay queries, not hardcoded x/y.

---

### FEAT-16 — Team roster view *(deferred placeholder)*

**Lane:** client + server
**Status:** deferred · **Blocks:** none
**Scope:** Placeholder. User has flagged this as interesting but
wants to shape the design before committing. Not building yet.

**Open questions before promotion:**

- Data scope: 26-man active + top 10 minor-leaguers? Just
  active?
- Narrative content: per-player last-10 summary? Positional
  depth chart? Hot/cold indicators?
- Placement: new `/team/:teamId/roster` page? Tab inside
  TeamPage?

Will be written up as a full ticket once scope is clear.

---

### FEAT-17 — Pythagorean expected record (inline on team header)

**Lane:** server + client
**Status:** unblocked · **Blocks:** none
**Scope:** Add an inline "expected" record to the team header
derived from the classic Pythagorean formula so you can spot
teams over- or under-performing their run differential at a
glance. Small touch, no new card, no new chart.

**Acceptance criteria:**

- Team response (`GET /api/team/:teamId`) gains an
  `expectedRecord: { wins: number; losses: number }` field.
- Computation:
  `expected_win_pct = rs² / (rs² + ra²)` ·
  `expected_wins = round(expected_win_pct × games_played)` ·
  `expected_losses = games_played − expected_wins`. Uses the team's
  cumulative runs-scored / runs-allowed from existing silver/gold
  (no new tables).
- Team page header line renders
  `"55-45 (.549) · expected 58-42"` after existing record + before
  the GB pill. Muted text weight (not bolded).
- On mobile, still fits on the header line without wrapping; if
  space constrained, keep expected and hide GB.
- Tooltip on hover of "expected 58-42": "Pythagorean expected
  record from runs scored and allowed. League average is 0."

**Files expected to change:**

- MODIFY `app/server/src/queries/index.ts` — add expectedRecord
  to `getTeamFromWarehouse`. Pure SQL; no new gold table.
- MODIFY `app/shared/types/team.ts` (post-ARCH-4) or `types.ts`.
- MODIFY `app/client/src/pages/TeamPage.tsx` — render inline,
  add tooltip.

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-17.

Goal: add an inline Pythagorean expected record on the team page
header. Existing silver/gold tables have runs_scored and
runs_allowed per team-season; no new tables needed.

Server:
1. In getTeamFromWarehouse (app/server/src/queries/index.ts),
   extend the SELECT with cumulative RS/RA for the season.
2. Compute expected_wins = round(rs² / (rs² + ra²) * games). If
   rs + ra = 0 (zero-game edge), default to 0-0.
3. Add expectedRecord: {wins, losses} to the TeamResponse type in
   app/shared/types/ (domain: team).

Client:
1. In TeamPage.tsx, update the record line to include
   `· expected ${wins}-${losses}` after the existing
   `(.winPct)` block and before ` · GB `.
2. Use the existing muted text class for the expected fragment.
3. Small tooltip on hover of the 'expected' fragment explaining
   the Pythagorean formula.

Do NOT create a new card. Do NOT add a chart. This is one line
of prose on the existing header.

Verify on /team/CHC: expected record renders, math checks out
vs runsScored²/(runsScored²+runsAllowed²) · games.

Commit clean.
```

**Notes / risks:** Pythagorean math assumes a full game-level
signal; early-season with few games can look weird. Not a
problem because the value is a fact, not a prediction.

---

### FEAT-18 — Trajectory window zoom (drag-to-select a date range)

**Lane:** client
**Status:** unblocked · **Blocks:** none
**Scope:** Let the user drag-select a horizontal range on the
trajectory chart's x-axis (games played) to zoom into a window
of the season. Stat strip plots on the same page re-compute
using only games inside the window. A "reset" button clears the
window.

**Acceptance criteria:**

- Drag on the trajectory chart's plot area to select a range of
  games played. Visual: a translucent gray rectangle follows the
  drag; releasing commits the selection.
- Upon selection, all strip plots on the team page (batting,
  pitching, other) re-render using only games in the window.
  Percentile ticks are recomputed.
- A small "Reset window" button appears in the trajectory card
  header when a window is active.
- ESC also clears the window.
- Window state is local (not persisted across navigation). If
  user navigates to another team, window resets.

**Files expected to change:**

- MODIFY `app/client/src/charts/DivisionTrajectoryChart.tsx`
  (drag handling, selection rectangle, emit range to parent)
- MODIFY `app/client/src/pages/TeamPage.tsx` (own the window
  state, pass down to stat components)
- MODIFY `app/server/src/queries/index.ts` — add an optional
  `gameWindow=A,B` query param to the stat-distribution endpoints
  that filters aggregation to a games-played window. Needs to
  work with ARCH-1's bulk endpoint too.
- MODIFY `app/shared/types/league.ts`

**Agent prompt:**

```
You are in a git worktree branched off main, working on FEAT-18.

Goal: drag-to-select a window on the trajectory chart; all
downstream strip plots recompute using only games in that
window.

Implementation:
1. In DivisionTrajectoryChart.tsx, add drag handlers
   (onMouseDown / onMouseMove / onMouseUp) on the plot area.
   Render a translucent <rect> during drag. On mouseup, convert
   pixel range → games-played range using the x-scale.
2. Emit the selection via a new prop
   `onWindowSelect(range: [number, number] | null)`.
3. In TeamPage.tsx, own the window state. When set, pass
   `gameWindow` to the stat distribution fetch.
4. Server: extend the stat-distribution endpoint(s) to accept
   an optional ?gameWindow=A,B param. When present, the
   underlying query filters silver_player_game_* events and
   re-aggregates. Plays well with ARCH-1's bulk endpoint —
   window applies to every stat in the bulk request.
5. Add a Reset button + ESC handler.
6. Smooth visual: the strip-plot dots should transition to new
   positions (their x-values change), reusing existing CSS
   transition primitives (280ms ease).

Do NOT persist the window in preferences or URL state for v1 —
keep it purely local.

Do NOT touch pipeline code.

Verify on /team/CHC:
- Drag-select April on the trajectory → all strip plots update
  to reflect April-only performance.
- Click Reset → everything snaps back.
- Navigate away + back → window is cleared.

Commit clean.
```

**Notes / risks:** Server-side stat aggregation over a window
is real work — it can't use pre-computed `gold_team_stat_vs_league`
rows (those are season-to-date). The endpoint needs to hit silver
game-level data and aggregate on the fly. Measure perf; if slow,
consider materializing daily gold snapshots and interpolating.

---

## Dependency map

```
ARCH-4 (types split) ─> everyone (merge safety)
ARCH-1 (bulk stats)  ─┬─> FEAT-4, FEAT-5, FEAT-6, FEAT-7
                      └─> ARCH-2 (optional progressive UX)
ARCH-3 (hide Player tab) — standalone
ARCH-5 (tests) — standalone

PIPE-0.5 (silver_play) ─> DERIV-4 ─> FEAT-7
PIPE-1 (Statcast)      ─> DERIV-1 ─> FEAT-4
PIPE-2 (transactions)  ─> FEAT-13
PIPE-3 (backfill 2020+) ─> DERIV-5 ─> FEAT-8
PIPE-4 (odds) — optional, no downstream

DERIV-2 (bullpen) ─> FEAT-5 ABANDONED        (orphan, see DERIV-8)
DERIV-3 (SoS)     ─> FEAT-6 ABANDONED        (orphan, see DERIV-8)
DERIV-6 (weekly digest, primary-team v1) ─> DERIV-7 ─> FEAT-9

Unblocked right now (post-Wave-3, 2026-04-27):
  ARCH-5  — recap test harness (cleanup)
  ARCH-2  — progressive disclosure (optional UX layer)
  FEAT-1  — matchup preview on Today's Games
  FEAT-4  — xwOBA card on team page          (DERIV-1 done)
  FEAT-5  — ABANDONED 2026-04-28 (scope didn't earn its space)
  FEAT-6  — ABANDONED 2026-04-28 (scope didn't earn its space)
  FEAT-7  — ABANDONED 2026-04-28 (metric didn't earn screen real estate)
  FEAT-8  — milestone callouts on home page  (DERIV-5 done)
  DERIV-7 — extend weekly digest job to all 30 teams (blocks FEAT-9)
  FEAT-9  — weekly digest card on team page  (blocked by DERIV-7)
  FEAT-12 — recap inline player hyperlinks
  FEAT-13 — ABANDONED 2026-04-28 (transactions feed didn't earn screen real estate)
  FEAT-18 — trajectory window zoom
  (FEAT-11 already shipped; FEAT-16 deferred for scope; FEAT-17
   already done in Wave 1)
```

---

## Wave plan

### Wave 0 — "get foundations right, solo" ✅ done

Two tickets, run one at a time (they both touch shared code):

1. **ARCH-4** (types split)
2. **ARCH-1** (bulk stat endpoint) — rebase onto ARCH-4 once it
   lands, then ship.

Everything after Wave 0 assumes these are merged.

### Wave 1 — "parallel small wins" ✅ done (incl. FEAT-2/10/15 in Wave 1.5)

After Wave 0, these can run in parallel worktrees — disjoint
files:

- FEAT-2 · team-vs-team overlay (DivisionTrajectoryChart)
- FEAT-3 · trajectory game drawer (GameDrawer + small
  trajectory edit)
- FEAT-10 · primary-team theming (CSS + NavBar + TeamPage root
  var)
- FEAT-14 · sum-stat chart UI fix
  (TeamPlayerDistribution)
- FEAT-15 · how-to overlay (HelpOverlay + NavBar)
- FEAT-17 · Pythagorean inline (server + TeamPage header)
- ARCH-3 · hide Player tab (NavBar + /players placeholder)

**Conflict watch:** FEAT-2 and FEAT-3 both edit
`DivisionTrajectoryChart.tsx`. Run FEAT-3 first (more invasive —
adds point hit zones), then FEAT-2 rebases. Alternatively: do
FEAT-2 solo in its own wave.

### Wave 2 — "pipeline push, sequential" ✅ done (PIPE-4 odds skipped)

Only one pipeline ticket runs at a time. Between each, let the
hourly refresh prove the schema is healthy before starting the
next.

1. PIPE-0.5 (silver_play)
2. PIPE-1 (Statcast)
3. PIPE-2 (transactions)
4. PIPE-3 (backfill 2020+)
5. PIPE-4 (odds — optional)

While Wave 2 is running, Wave 1 tickets that weren't done yet
can continue in parallel worktrees since they don't touch
pipeline.

### Wave 3 — "derivations (parallel-safe post-pipeline)" ✅ done

After the relevant pipeline tickets land:

- DERIV-1 (needs PIPE-1)
- DERIV-2 (no blocker)
- DERIV-3 (no blocker)
- DERIV-4 (needs PIPE-0.5)
- DERIV-5 (needs PIPE-3)
- DERIV-6 (no blocker)

All six can run in parallel since each produces a different gold
table. They only write, don't read each other.

### Wave 4 — "surface the new data" ⏭️ NEXT

After derivations, these light up:

- FEAT-4 (xwOBA card) — needs DERIV-1
- FEAT-5 (bullpen usage) — needs DERIV-2
- FEAT-6 (SoS tooltip) — needs DERIV-3
- FEAT-7 (clutch leaders) — needs DERIV-4
- FEAT-8 (milestones) — needs DERIV-5

Also parallel-safe (each hits a different route + component).

### Wave 5 — "tests, tidy, and the team-page digest"

- DERIV-7 (per-team weekly digest pipeline) — must land before FEAT-9.
- DERIV-8 (deprecate `gold_player_clutch`) — FEAT-7 cleanup. Quick
  pipeline-side change; can land first or last.
- FEAT-9 (weekly digest on team page) — needs DERIV-7.
- ARCH-5 (recap tests) — drop in at any point once pipeline is
  stable.
- FEAT-12 (player hyperlinks) — can be done earlier; slot when
  there's appetite.
- FEAT-18 (trajectory window zoom) — can land anytime but feels
  most useful once historical backfill (PIPE-3) lets you zoom
  into prior months.
- ARCH-2 (progressive disclosure) — ship only if the team page
  feels too dense after Wave 4.

---

## Execution playbook

### Dispatching a wave

1. User confirms which tickets are in the next wave (usually
   just "everything unblocked in the lane").
2. Claude sends a single message with `N` parallel Agent tool
   calls, each with `isolation: "worktree"` and the ticket's
   agent prompt verbatim.
3. Each agent runs in its own worktree branched off main.
   Agents commit locally but do not push.
4. Agents return summaries. User reviews diffs one at a time;
   pipeline diffs go first because downstream derivations rebase
   onto merged pipeline schemas.
5. For every merge, update this doc: check the ticket, move
   unblocked downstream items up.

### Pipeline merge protocol

Before merging a pipeline ticket:

1. Confirm `databricks bundle validate` passes in the worktree.
2. Manually trigger the new silver/gold task on the dev bundle.
3. Verify expected rows land (count query).
4. Only then merge. This avoids main ever pointing at SQL that
   doesn't compile.

### Handling conflicts

If two parallel agents end up touching the same file despite
lane planning:

- First to merge wins.
- Second agent rebases against main and resolves. The agent
  prompt already covers rebase etiquette via "commit at a clean
  point, don't push."

### Wave transitions

Between waves, the user should:

- Confirm all merged work still runs (`./scripts/dev.sh` + spot
  check).
- Push main to origin (optional; required if other machines
  touch this repo).
- Update CLAUDE.md / this BACKLOG.md to reflect current state.

---

## Deferred ideas (not in current scope)

These are real, just not top-of-pile. Write a ticket when you're
ready.

- **Multi-label interest classification on recap cards** —
  right now `interest.py` picks one label via `elif`. Making it
  multi-label would let a game carry "walkoff" + "rivalry" +
  "last of series" chips. Pipeline + prompt change.
- **Pitcher workload curve (B.7)** — 5-game rolling pitch count
  per starter vs career norm. Needs Statcast or extended silver
  already in place. "Interesting but not chomping at the bit."
- **Retrosheet historical deep backfill (C.2)** — only if we
  want milestones reaching further than 2020.
- **Real MLB team logos (FEAT-10 extension)** — bends the
  monochrome voice. Reconsider after seeing FEAT-10 theming
  land.
- **News scraping / LLM web-search for recap enrichment (E)** —
  phase-2 infra. Needs its own design pass (tool integration,
  source trust, cost).
- **Shareable PNG recap cards (D.4)** — user said meh; left as a
  "might bring back" footnote only.
