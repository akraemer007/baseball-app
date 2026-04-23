-- Gold tables: app-ready, denormalized. Run as the "build_gold" task in the daily job.
-- Parameters (bound by the SQL task):
--   :catalog   e.g. fevm_shared_catalog
--   :schema    e.g. ak_baseball

USE CATALOG IDENTIFIER(:catalog);
USE SCHEMA IDENTIFIER(:schema);

-- ==========================================================================
-- gold_division_trajectory: (season, division, team, date, w_minus_l, games_played)
-- Powers the League page Jon-Bois-style W-L trajectory chart.
-- ==========================================================================
CREATE OR REPLACE TABLE gold_division_trajectory AS
SELECT
    td.season,
    t.league,
    t.division,
    t.team_id,
    t.abbrev AS team_abbrev,
    t.name   AS team_name,
    t.primary_color,
    td.game_date AS as_of_date,
    td.games_played,
    td.cum_wins,
    td.cum_losses,
    td.w_minus_l
FROM silver_team_day td
JOIN silver_team   t  USING (team_id);

-- ==========================================================================
-- gold_player_hr_race: cumulative HR by game # for each (season, player)
-- Powers the Player page and league HR race charts.
-- ==========================================================================
CREATE OR REPLACE TABLE gold_player_hr_race AS
WITH per_game AS (
    SELECT
        g.season,
        b.player_id,
        b.player_name,
        b.team_id,
        g.game_date,
        b.home_runs,
        ROW_NUMBER() OVER (PARTITION BY g.season, b.player_id ORDER BY g.game_date, g.game_pk) AS game_num
    FROM silver_player_game_batting b
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
),
cumulative AS (
    SELECT
        season,
        player_id,
        player_name,
        team_id,
        game_date,
        game_num,
        SUM(home_runs) OVER (PARTITION BY season, player_id ORDER BY game_num) AS cumulative_hr
    FROM per_game
),
season_totals AS (
    SELECT season, player_id, MAX(cumulative_hr) AS final_hr
    FROM cumulative
    GROUP BY season, player_id
),
season_leaders AS (
    SELECT season, player_id, final_hr
    FROM (
        SELECT season, player_id, final_hr,
               RANK() OVER (PARTITION BY season ORDER BY final_hr DESC) AS rk
        FROM season_totals
    )
    WHERE rk <= 20
)
SELECT
    c.season,
    c.player_id,
    c.player_name,
    c.team_id,
    c.game_date,
    c.game_num,
    c.cumulative_hr,
    CASE WHEN c.cumulative_hr = MAX(c.cumulative_hr) OVER (PARTITION BY c.season, c.game_date)
         THEN TRUE ELSE FALSE END AS is_leader
FROM cumulative c
JOIN season_leaders sl USING (season, player_id);

-- ==========================================================================
-- gold_team_stat_vs_league: team season totals with league mean/stddev/rank
-- Powers the Team page percentile chart.
-- ==========================================================================
CREATE OR REPLACE TABLE gold_team_stat_vs_league AS
WITH team_totals AS (
    SELECT
        g.season,
        tg.team_id,
        SUM(tg.runs)       AS runs,
        SUM(tg.hits)       AS hits,
        SUM(tg.home_runs)  AS home_runs,
        SUM(tg.at_bats)    AS at_bats,
        SUM(tg.walks_batting) AS walks_batting,
        SUM(tg.strikeouts_batting) AS strikeouts_batting,
        SUM(tg.earned_runs) AS earned_runs,
        SUM(tg.innings_pitched) AS innings_pitched,
        SUM(tg.strikeouts_pitching) AS strikeouts_pitching,
        SUM(tg.walks_pitching) AS walks_pitching,
        SUM(tg.errors)     AS errors
    FROM silver_team_game tg
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
    GROUP BY g.season, tg.team_id
),
stat_long AS (
    SELECT season, team_id, 'runs_per_game' AS stat, runs / NULLIF((SELECT COUNT(DISTINCT game_pk) FROM silver_team_game tg2 WHERE tg2.team_id = tt.team_id), 0) AS val FROM team_totals tt
    UNION ALL
    SELECT season, team_id, 'hr_per_game', home_runs / NULLIF((SELECT COUNT(DISTINCT game_pk) FROM silver_team_game tg2 WHERE tg2.team_id = tt.team_id), 0) FROM team_totals tt
    UNION ALL
    SELECT season, team_id, 'k_per_9', strikeouts_pitching * 9.0 / NULLIF(innings_pitched, 0) FROM team_totals tt
    UNION ALL
    SELECT season, team_id, 'era', earned_runs * 9.0 / NULLIF(innings_pitched, 0) FROM team_totals tt
    UNION ALL
    SELECT season, team_id, 'errors_per_game', errors * 1.0 / NULLIF((SELECT COUNT(DISTINCT game_pk) FROM silver_team_game tg2 WHERE tg2.team_id = tt.team_id), 0) FROM team_totals tt
),
with_league AS (
    SELECT
        sl.*,
        AVG(val)   OVER (PARTITION BY season, stat) AS league_mean,
        STDDEV(val) OVER (PARTITION BY season, stat) AS league_stddev
    FROM stat_long sl
)
SELECT
    wl.season,
    wl.team_id,
    t.abbrev AS team_abbrev,
    t.name   AS team_name,
    wl.stat  AS stat_name,
    wl.val   AS team_value,
    wl.league_mean,
    wl.league_stddev,
    CASE WHEN wl.league_stddev > 0
         THEN (wl.val - wl.league_mean) / wl.league_stddev
         ELSE 0 END AS z_score,
    -- Rank: lower is better for era, strikeouts_batting, errors_per_game; higher is better for the rest
    RANK() OVER (PARTITION BY wl.season, wl.stat
                 ORDER BY CASE wl.stat
                              WHEN 'era' THEN wl.val
                              WHEN 'errors_per_game' THEN wl.val
                              ELSE -wl.val
                          END) AS rank_in_league
FROM with_league wl
JOIN silver_team t USING (team_id);

-- ==========================================================================
-- gold_player_game_log: denormalized per-game lines (batting or pitching)
-- ==========================================================================
CREATE OR REPLACE TABLE gold_player_game_log AS
SELECT
    g.season,
    g.game_pk,
    g.game_date,
    b.player_id,
    b.player_name,
    b.team_id,
    t.abbrev AS team_abbrev,
    'batting' AS log_type,
    b.at_bats, b.hits, b.runs, b.rbi, b.home_runs, b.doubles, b.triples,
    b.walks, b.strikeouts, b.stolen_bases, b.total_bases,
    NULL AS innings_pitched, NULL AS earned_runs, NULL AS pitching_strikeouts,
    NULL AS wins, NULL AS losses, NULL AS saves
FROM silver_player_game_batting b
JOIN silver_game g USING (game_pk)
JOIN silver_team t ON t.team_id = b.team_id
WHERE g.game_type = 'R'
UNION ALL
SELECT
    g.season,
    g.game_pk,
    g.game_date,
    p.player_id,
    p.player_name,
    p.team_id,
    t.abbrev AS team_abbrev,
    'pitching' AS log_type,
    NULL, NULL, NULL, NULL, NULL, NULL, NULL,
    p.walks, p.strikeouts, NULL, NULL,
    p.innings_pitched, p.earned_runs, p.strikeouts,
    p.wins, p.losses, p.saves
FROM silver_player_game_pitching p
JOIN silver_game g USING (game_pk)
JOIN silver_team t ON t.team_id = p.team_id
WHERE g.game_type = 'R';
