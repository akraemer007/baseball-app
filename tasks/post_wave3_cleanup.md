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
