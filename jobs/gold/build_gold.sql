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
        COUNT(DISTINCT tg.game_pk) AS games,
        SUM(tg.runs)       AS runs,
        -- Opponent's runs in the same game = runs_against for this team.
        SUM(opp.runs)      AS runs_against,
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
    JOIN silver_team_game opp ON opp.game_pk = tg.game_pk AND opp.team_id != tg.team_id
    JOIN silver_game g ON g.game_pk = tg.game_pk
    WHERE g.game_type = 'R' AND g.status = 'Final'
    GROUP BY g.season, tg.team_id
),
team_bat_extras AS (
    -- Per-team total_bases (for SLG/OPS); sourced from per-player batting.
    SELECT g.season, b.team_id, SUM(b.total_bases) AS total_bases
    FROM silver_player_game_batting b
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
    GROUP BY g.season, b.team_id
),
team_pit_extras AS (
    -- HR allowed, per-team. Sum of each pitcher's HR-allowed on that team.
    SELECT g.season, p.team_id, SUM(p.home_runs) AS home_runs_allowed
    FROM silver_player_game_pitching p
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
    GROUP BY g.season, p.team_id
),
team_derived AS (
    SELECT
        tt.*,
        tbe.total_bases,
        tpe.home_runs_allowed,
        CASE WHEN tt.at_bats > 0 THEN 1.0 * tt.hits / tt.at_bats ELSE NULL END AS avg,
        -- OBP ignores HBP and SF (we don't ingest those yet); approximation.
        CASE WHEN (tt.at_bats + tt.walks_batting) > 0
             THEN 1.0 * (tt.hits + tt.walks_batting) / (tt.at_bats + tt.walks_batting)
             ELSE NULL END AS obp,
        CASE WHEN tt.at_bats > 0 AND tbe.total_bases IS NOT NULL
             THEN 1.0 * tbe.total_bases / tt.at_bats ELSE NULL END AS slg,
        CASE WHEN tt.innings_pitched > 0
             THEN tt.earned_runs * 9.0 / tt.innings_pitched ELSE NULL END AS era,
        -- Raw FIP without the constant; we add a league-scaled constant below.
        CASE WHEN tt.innings_pitched > 0 AND tpe.home_runs_allowed IS NOT NULL
             THEN (13.0 * tpe.home_runs_allowed
                  + 3.0 * tt.walks_pitching
                  - 2.0 * tt.strikeouts_pitching) / tt.innings_pitched
             ELSE NULL END AS fip_raw
    FROM team_totals tt
    LEFT JOIN team_bat_extras tbe USING (season, team_id)
    LEFT JOIN team_pit_extras tpe USING (season, team_id)
),
league_avg AS (
    SELECT
        season,
        AVG(obp) AS lg_obp,
        AVG(slg) AS lg_slg,
        AVG(era) AS lg_era,
        -- IP-weighted league raw FIP so league FIP == league ERA (sets the constant).
        SUM(fip_raw * innings_pitched) / NULLIF(SUM(innings_pitched), 0) AS lg_fip_raw
    FROM team_derived
    WHERE innings_pitched > 0
    GROUP BY season
),
team_final AS (
    SELECT
        td.*,
        la.lg_obp, la.lg_slg, la.lg_era, la.lg_fip_raw,
        -- FIP constant anchors league FIP to league ERA.
        td.fip_raw + (la.lg_era - la.lg_fip_raw) AS fip,
        td.obp + td.slg AS ops,
        CASE WHEN la.lg_obp > 0 AND la.lg_slg > 0 AND td.obp IS NOT NULL AND td.slg IS NOT NULL
             THEN 100.0 * (td.obp / la.lg_obp + td.slg / la.lg_slg - 1)
             ELSE NULL END AS ops_plus,
        CASE WHEN la.lg_era > 0 AND td.era IS NOT NULL
             THEN 100.0 * td.era / la.lg_era
             ELSE NULL END AS era_minus
    FROM team_derived td
    LEFT JOIN league_avg la USING (season)
),
stat_long AS (
    -- Season-total counting stats (integers in gold; they rank higher = better)
    SELECT season, team_id, 'run_diff'      AS stat, (runs - runs_against) * 1.0 AS val FROM team_final
    UNION ALL SELECT season, team_id, 'hits_total',       hits         * 1.0 FROM team_final
    UNION ALL SELECT season, team_id, 'hr_total',         home_runs    * 1.0 FROM team_final
    UNION ALL SELECT season, team_id, 'walks_total',      walks_batting * 1.0 FROM team_final
    UNION ALL SELECT season, team_id, 'strikeouts_pitching_total', strikeouts_pitching * 1.0 FROM team_final
    -- Rate stats
    UNION ALL SELECT season, team_id, 'runs_per_game',    runs * 1.0 / NULLIF(games, 0) FROM team_final
    UNION ALL SELECT season, team_id, 'hr_per_game',      home_runs * 1.0 / NULLIF(games, 0) FROM team_final
    UNION ALL SELECT season, team_id, 'avg',              avg FROM team_final
    UNION ALL SELECT season, team_id, 'obp',              obp FROM team_final
    UNION ALL SELECT season, team_id, 'slg',              slg FROM team_final
    UNION ALL SELECT season, team_id, 'ops',              ops FROM team_final
    UNION ALL SELECT season, team_id, 'ops_plus',         ops_plus FROM team_final
    UNION ALL SELECT season, team_id, 'era',              era FROM team_final
    UNION ALL SELECT season, team_id, 'era_minus',        era_minus FROM team_final
    UNION ALL SELECT season, team_id, 'fip',              fip FROM team_final
    UNION ALL SELECT season, team_id, 'k_per_9',          strikeouts_pitching * 9.0 / NULLIF(innings_pitched, 0) FROM team_final
    UNION ALL SELECT season, team_id, 'errors_per_game',  errors * 1.0 / NULLIF(games, 0) FROM team_final
),
with_league AS (
    SELECT
        sl.*,
        AVG(val)    OVER (PARTITION BY season, stat) AS league_mean,
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
    -- Rank: lower is better for era/era_minus/fip/errors_per_game; higher is better for the rest.
    RANK() OVER (PARTITION BY wl.season, wl.stat
                 ORDER BY CASE wl.stat
                              WHEN 'era' THEN wl.val
                              WHEN 'era_minus' THEN wl.val
                              WHEN 'fip' THEN wl.val
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


-- ==========================================================================
-- gold_game_recap_input: one row per Final regular-season game with everything
-- the Python interest scorer + LLM writer need. Implemented as a VIEW because
-- input is always derived from source-of-truth silver + gold tables.
-- ==========================================================================
CREATE OR REPLACE VIEW gold_game_recap_input AS
WITH
-- Line score aggregated to a JSON array per game (ordered by inning).
linescore_agg AS (
    SELECT
        game_pk,
        to_json(
            collect_list(named_struct('inning', inning, 'away', away_runs, 'home', home_runs))
        ) AS linescore_json,
        SUM(home_runs) AS home_runs_sum,
        SUM(away_runs) AS away_runs_sum,
        MAX(inning) AS final_inning
    FROM (
        SELECT game_pk, inning, home_runs, away_runs
        FROM silver_linescore
        ORDER BY game_pk, inning
    )
    GROUP BY game_pk
),
-- Per-team running wins/losses ordered by date; used for last-10 + streak.
team_history AS (
    SELECT
        g.game_pk,
        g.game_date,
        tg.team_id,
        tg.side,
        CASE WHEN g.winner_team_id = tg.team_id THEN 1 ELSE 0 END AS is_win
    FROM silver_team_game tg
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
),
-- Last 10 games for each (team, game_date) — only count games BEFORE this game.
last10 AS (
    SELECT
        game_pk,
        team_id,
        SUM(is_win) AS w,
        COUNT(*) - SUM(is_win) AS l
    FROM (
        SELECT
            cur.game_pk,
            cur.team_id,
            prior.is_win,
            ROW_NUMBER() OVER (
                PARTITION BY cur.game_pk, cur.team_id
                ORDER BY prior.game_date DESC, prior.game_pk DESC
            ) AS rn
        FROM team_history cur
        JOIN team_history prior
            ON prior.team_id = cur.team_id
           AND prior.game_date < cur.game_date
    )
    WHERE rn <= 10
    GROUP BY game_pk, team_id
),
-- Streak into the game: count consecutive wins or losses just before it.
streak_ranked AS (
    SELECT
        cur.game_pk,
        cur.team_id,
        prior.is_win,
        ROW_NUMBER() OVER (
            PARTITION BY cur.game_pk, cur.team_id
            ORDER BY prior.game_date DESC, prior.game_pk DESC
        ) AS rn
    FROM team_history cur
    JOIN team_history prior
        ON prior.team_id = cur.team_id
       AND prior.game_date < cur.game_date
),
streak_with_top AS (
    SELECT
        r.*,
        FIRST_VALUE(is_win) OVER (
            PARTITION BY game_pk, team_id ORDER BY rn
        ) AS top_result
    FROM streak_ranked r
),
streak_flip AS (
    -- rn of the first prior game whose result doesn't match the most-recent one
    SELECT game_pk, team_id, MIN(rn) AS first_flip_rn
    FROM streak_with_top
    WHERE is_win != top_result
    GROUP BY game_pk, team_id
),
streak AS (
    SELECT
        tw.game_pk,
        tw.team_id,
        concat(
            CASE WHEN ANY_VALUE(tw.top_result) = 1 THEN 'W' ELSE 'L' END,
            CAST(COALESCE(MIN(sf.first_flip_rn) - 1, MAX(tw.rn)) AS STRING)
        ) AS streak
    FROM streak_with_top tw
    LEFT JOIN streak_flip sf USING (game_pk, team_id)
    GROUP BY tw.game_pk, tw.team_id
),
-- Key performers: any batter with 2+ hits, 2+ RBI, or at least one HR.
key_batters AS (
    SELECT
        b.game_pk,
        b.team_id,
        to_json(
            collect_list(named_struct(
                'player_name', b.player_name,
                'at_bats', b.at_bats,
                'hits', b.hits,
                'home_runs', b.home_runs,
                'rbi', b.rbi,
                'runs', b.runs,
                'walks', b.walks,
                'strikeouts', b.strikeouts,
                'stolen_bases', b.stolen_bases,
                'season_hr', coalesce(ps.home_runs, 0),
                'season_avg', coalesce(ps.avg, 0)
            ))
        ) AS batters_json
    FROM silver_player_game_batting b
    JOIN silver_game g USING (game_pk)
    LEFT JOIN silver_player_season ps
      ON ps.player_id = b.player_id AND ps.season = g.season
    WHERE g.game_type = 'R' AND g.status = 'Final'
      AND (b.hits >= 2 OR b.rbi >= 2 OR b.home_runs >= 1)
    GROUP BY b.game_pk, b.team_id
),
-- Starting pitchers: whoever threw the most innings for each team in the game.
starters AS (
    SELECT game_pk, team_id, player_id, player_name, innings_pitched, hits,
           earned_runs, strikeouts, walks, wins, losses, saves, season
    FROM (
        SELECT
            p.game_pk, p.team_id, p.player_id, p.player_name,
            p.innings_pitched, p.hits, p.earned_runs, p.strikeouts,
            p.walks, p.wins, p.losses, p.saves, g.season,
            ROW_NUMBER() OVER (
                PARTITION BY p.game_pk, p.team_id
                ORDER BY p.innings_pitched DESC
            ) AS rn
        FROM silver_player_game_pitching p
        JOIN silver_game g USING (game_pk)
        WHERE g.game_type = 'R' AND g.status = 'Final'
    )
    WHERE rn = 1
),
starters_json AS (
    SELECT
        s.game_pk,
        to_json(collect_list(named_struct(
            'team_id', s.team_id,
            'player_name', s.player_name,
            'innings_pitched', s.innings_pitched,
            'hits', s.hits,
            'earned_runs', s.earned_runs,
            'strikeouts', s.strikeouts,
            'walks', s.walks,
            'wins', s.wins,
            'losses', s.losses,
            'season_era', coalesce(ps.era, 0)
        ))) AS starting_pitchers_json
    FROM starters s
    LEFT JOIN silver_player_season ps
           ON ps.player_id = s.player_id AND ps.season = s.season
    GROUP BY s.game_pk
)
SELECT
    g.game_pk,
    g.game_date,
    g.season,
    g.home_team_id,
    g.away_team_id,
    ht.abbrev AS home_abbrev,
    at.abbrev AS away_abbrev,
    ht.name   AS home_team,
    at.name   AS away_team,
    ht.division AS home_division,
    at.division AS away_division,
    (ht.division = at.division) AS is_division_game,
    g.venue,
    g.home_score,
    g.away_score,
    g.winner_team_id,
    (CASE WHEN g.winner_team_id = g.home_team_id THEN ht.name ELSE at.name END) AS winner_team,
    (CASE WHEN g.winner_team_id = g.home_team_id THEN at.name ELSE ht.name END) AS loser_team,
    ABS(g.home_score - g.away_score) AS margin,
    coalesce(ls.linescore_json, '[]') AS linescore_json,
    coalesce(ls.final_inning, 9) AS final_inning,
    -- last-10 + streak (may be NULL for season-openers; callers default to "0-0" / "W0")
    concat(coalesce(h10.w, 0), '-', coalesce(h10.l, 0)) AS home_last_10,
    concat(coalesce(a10.w, 0), '-', coalesce(a10.l, 0)) AS away_last_10,
    coalesce(hs.streak, 'W0') AS home_streak,
    coalesce(as_.streak, 'W0') AS away_streak,
    -- pre-game Elo
    e.home_win_prob AS pre_game_elo_home,
    e.winner_implied_win_prob,
    coalesce(e.upset_flag, FALSE) AS upset_flag,
    -- key performers
    coalesce(hb.batters_json, '[]') AS home_key_batters_json,
    coalesce(ab.batters_json, '[]') AS away_key_batters_json,
    coalesce(sp.starting_pitchers_json, '[]') AS starting_pitchers_json
FROM silver_game g
JOIN silver_team ht ON ht.team_id = g.home_team_id
JOIN silver_team at ON at.team_id = g.away_team_id
LEFT JOIN linescore_agg ls ON ls.game_pk = g.game_pk
LEFT JOIN last10 h10 ON h10.game_pk = g.game_pk AND h10.team_id = g.home_team_id
LEFT JOIN last10 a10 ON a10.game_pk = g.game_pk AND a10.team_id = g.away_team_id
LEFT JOIN streak hs  ON hs.game_pk  = g.game_pk AND hs.team_id  = g.home_team_id
LEFT JOIN streak as_ ON as_.game_pk = g.game_pk AND as_.team_id = g.away_team_id
LEFT JOIN gold_game_elo e ON e.game_pk = g.game_pk
LEFT JOIN key_batters hb ON hb.game_pk = g.game_pk AND hb.team_id = g.home_team_id
LEFT JOIN key_batters ab ON ab.game_pk = g.game_pk AND ab.team_id = g.away_team_id
LEFT JOIN starters_json sp ON sp.game_pk = g.game_pk
WHERE g.game_type = 'R' AND g.status = 'Final';
