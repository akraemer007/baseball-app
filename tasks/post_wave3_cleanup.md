# Post-Wave 3 cleanup (user-flagged 2026-04-27)

1. **Parallelize ingest tasks in hourly_refresh_job.yml.**
   Today: ingest_playbyplay, ingest_statcast, ingest_transactions all
   `depends_on: refine_silver`. They don't all need to. Statcast and
   transactions don't read silver_game at all. PlayByPlay reads
   silver_game.status='Final' but could read MLB Stats API
   schedule directly to discover Finals. Wire all three parallel to
   refine_silver (after ingest_schedule_and_games). Should cut hourly
   wall clock by ~2-3 min.

2. **Move recap generation into hourly.** Kill morning_recaps_job.
   The recap script already skips already-recapped games; running
   hourly means recaps land within an hour of a game finishing
   instead of waiting for 5 AM ET. West Coast games finish ~1 AM ET
   during the 0-4 ET hourly window, so the cadence works.
   Watch out for: LLM cost per hour (~$0.08/day still, but spread
   across hours), and the existing morning-job's full-chain
   belt-and-suspenders behavior for missed games.

3. **Extend backfill for new data sources.** jobs/ingest/backfill.py
   today only does bronze_schedule + bronze_boxscore. The new
   sources (silver_play, silver_pa/pitch, silver_transaction) only
   have current-season data. For a fresh redeploy elsewhere we'd
   lose prior years. Extend backfill to cover playByPlay, Statcast,
   transactions per the same seasons_back knob.
   Statcast in particular: 6 seasons × ~30 weekly windows × ~25k
   rows = 4.5M pitches; heavy lift but worth it for migration cost.

4. **Missing 2 team abbrevs in gold_team_expected_stats.** Currently
   shows 28 of 30 teams. Likely Statcast's `batter_team` uses an
   abbreviation that doesn't match silver_team.abbrev. Probable
   suspect: ATH (Statcast) vs OAK (silver_team) for the Athletics,
   or similar 2024+ rename. Diff the two sets and add an alias map
   if needed.

---

## Status (2026-04-27 update)

**✅ Done:**
- (1) Parallelize ingest — Statcast + transactions now depend on
  ingest_schedule_and_games instead of refine_silver. PlayByPlay
  still depends on refine_silver (reads silver_game.status='Final').
  Commit `9c639f2`.
- (2) Move recap generation hourly — generate_recaps appended to
  hourly_refresh_job.yml (mode=all-missing default), morning_recaps
  job retired. Commit `9c639f2`.
- (4) Missing 2 team abbrevs — TEAM_META gains aliases column,
  silver_team picks up `aliases ARRAY<STRING>`. gold_team_expected_stats
  joins on `t.abbrev = src.abbrev OR ARRAY_CONTAINS(t.aliases, src.abbrev)`.
  Pre-populated AZ↔ARI, ATH↔OAK plus a few common others (KCR, SDP,
  SFG, TBR, CHW, WAS, WSN). Commit `e02da83`.

**⏭️ Deferred:**
- (3) Extend backfill.py for new data sources (playByPlay, Statcast,
  transactions). Not urgent until a redeploy is actually planned.
  Note: existing seasons-back backfill only covers schedule + boxscore.
  PIPE-3-style multi-year for playByPlay would 6× the API call volume
  (~16k games × playByPlay ≈ ~80k requests at 50ms = ~70 min). Statcast
  for 6 seasons via weekly windows would be ~180 weekly requests
  (~30 min wall clock). Transactions multi-year is small. Worth
  bundling into a single one-shot backfill_all.py later.

**Open follow-up worth tracking:**
- ingest_playbyplay can also run parallel to refine_silver if
  fetch_playbyplay.py reads bronze_schedule (which has the same
  status info) instead of silver_game. ~30 min refactor, optional
  pipeline-portability win.
