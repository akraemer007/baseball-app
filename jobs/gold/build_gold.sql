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
-- gold_player_expected_stats / gold_team_expected_stats: xwOBA / wOBA / xBA
-- aggregates from silver_pa (one row per plate appearance).
--
-- xwOBA / xBA come straight from Savant's per-PA estimated_woba_using_speedangle
-- and estimated_ba_using_speedangle (averages over events that produced a
-- non-null value — i.e. balls in play + Ks/walks where Savant fills it in).
--
-- wOBA uses the 2025 FanGraphs / Tom Tango wOBA constants:
--     wOBA = (0.69*uBB + 0.72*HBP + 0.89*1B + 1.27*2B + 1.62*3B + 2.10*HR)
--          / (AB + BB - IBB + SF + HBP)
-- where uBB = unintentional walks (events='walk' minus events='intent_walk').
--
-- TODO: these constants drift year-to-year. If we ever ingest multiple
-- seasons or care about cross-year wOBA accuracy, swap the literals for a
-- season-keyed lookup table (one row per season with the six weights and
-- the wOBA scale).
-- ==========================================================================
CREATE OR REPLACE TABLE gold_player_expected_stats AS
WITH pa_clean AS (
    -- Defensive: drop rows with null events so an unclassified Savant value
    -- doesn't poison the AB / wOBA denominators.
    SELECT
        season,
        batter_id AS player_id,
        events,
        estimated_woba_using_speedangle,
        estimated_ba_using_speedangle
    FROM silver_pa
    WHERE events IS NOT NULL
),
agg AS (
    SELECT
        season,
        player_id,
        COUNT(*) AS pa,
        -- AB-eligible PAs: exclude walks, HBP, sacs, intentional walks, catcher's interference.
        SUM(CASE WHEN events NOT IN ('walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','sac_fly_double_play','sac_bunt_double_play','catcher_interf')
                 THEN 1 ELSE 0 END) AS abs,
        -- wOBA numerator components.
        SUM(CASE WHEN events = 'walk' THEN 1 ELSE 0 END) AS bb,
        SUM(CASE WHEN events = 'intent_walk' THEN 1 ELSE 0 END) AS ibb,
        SUM(CASE WHEN events = 'hit_by_pitch' THEN 1 ELSE 0 END) AS hbp,
        SUM(CASE WHEN events = 'single' THEN 1 ELSE 0 END) AS singles,
        SUM(CASE WHEN events = 'double' THEN 1 ELSE 0 END) AS doubles,
        SUM(CASE WHEN events = 'triple' THEN 1 ELSE 0 END) AS triples,
        SUM(CASE WHEN events = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
        SUM(CASE WHEN events IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS sf,
        AVG(estimated_woba_using_speedangle) AS xwoba,
        AVG(estimated_ba_using_speedangle)   AS xba
    FROM pa_clean
    GROUP BY season, player_id
)
SELECT
    CAST(season AS BIGINT)    AS season,
    CAST(player_id AS BIGINT) AS player_id,
    CAST(pa AS BIGINT)        AS pa,
    CAST(abs AS BIGINT)       AS abs,
    xwoba,
    xba,
    CASE
        WHEN (abs + (bb - ibb) + sf + hbp) > 0 THEN
            (0.69 * (bb - ibb)
           + 0.72 * hbp
           + 0.89 * singles
           + 1.27 * doubles
           + 1.62 * triples
           + 2.10 * home_runs)
            / (abs + (bb - ibb) + sf + hbp)
        ELSE NULL
    END AS woba
FROM agg;

CREATE OR REPLACE TABLE gold_team_expected_stats AS
WITH pa_clean AS (
    SELECT
        season,
        batter_team,
        events,
        estimated_woba_using_speedangle,
        estimated_ba_using_speedangle
    FROM silver_pa
    WHERE events IS NOT NULL
),
agg AS (
    SELECT
        pc.season,
        t.team_id,
        COUNT(*) AS pa,
        SUM(CASE WHEN events NOT IN ('walk','intent_walk','hit_by_pitch','sac_fly','sac_bunt','sac_fly_double_play','sac_bunt_double_play','catcher_interf')
                 THEN 1 ELSE 0 END) AS abs,
        SUM(CASE WHEN events = 'walk' THEN 1 ELSE 0 END) AS bb,
        SUM(CASE WHEN events = 'intent_walk' THEN 1 ELSE 0 END) AS ibb,
        SUM(CASE WHEN events = 'hit_by_pitch' THEN 1 ELSE 0 END) AS hbp,
        SUM(CASE WHEN events = 'single' THEN 1 ELSE 0 END) AS singles,
        SUM(CASE WHEN events = 'double' THEN 1 ELSE 0 END) AS doubles,
        SUM(CASE WHEN events = 'triple' THEN 1 ELSE 0 END) AS triples,
        SUM(CASE WHEN events = 'home_run' THEN 1 ELSE 0 END) AS home_runs,
        SUM(CASE WHEN events IN ('sac_fly','sac_fly_double_play') THEN 1 ELSE 0 END) AS sf,
        AVG(pc.estimated_woba_using_speedangle) AS xwoba,
        AVG(pc.estimated_ba_using_speedangle)   AS xba
    FROM pa_clean pc
    JOIN silver_team t ON t.abbrev = pc.batter_team
    GROUP BY pc.season, t.team_id
)
SELECT
    CAST(season AS BIGINT)  AS season,
    CAST(team_id AS BIGINT) AS team_id,
    CAST(pa AS BIGINT)      AS pa,
    CAST(abs AS BIGINT)     AS abs,
    xwoba,
    xba,
    CASE
        WHEN (abs + (bb - ibb) + sf + hbp) > 0 THEN
            (0.69 * (bb - ibb)
           + 0.72 * hbp
           + 0.89 * singles
           + 1.27 * doubles
           + 1.62 * triples
           + 2.10 * home_runs)
            / (abs + (bb - ibb) + sf + hbp)
        ELSE NULL
    END AS woba
FROM agg;

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
-- Statcast-derived expected stats. Joined in via UNION ALL so the rank/z-score
-- machinery below applies to xwoba/woba/xba for free. All three are higher-is-better.
expected_stats_long AS (
    SELECT season, team_id, 'xwoba' AS stat, CAST(xwoba AS DOUBLE) AS val FROM gold_team_expected_stats
    UNION ALL SELECT season, team_id, 'woba',  CAST(woba  AS DOUBLE) FROM gold_team_expected_stats
    UNION ALL SELECT season, team_id, 'xba',   CAST(xba   AS DOUBLE) FROM gold_team_expected_stats
),
stat_all AS (
    SELECT * FROM stat_long
    UNION ALL SELECT * FROM expected_stats_long
),
with_league AS (
    SELECT
        sl.*,
        AVG(val)    OVER (PARTITION BY season, stat) AS league_mean,
        STDDEV(val) OVER (PARTITION BY season, stat) AS league_stddev
    FROM stat_all sl
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

-- ==========================================================================
-- gold_reliever_workload (DERIV-2)
-- Per-reliever rolling 3-day and 7-day workload windows.
-- Drives FEAT-5 (bullpen-usage card on team page).
--
-- Reliever heuristic: at silver_player_game_pitching grain, a pitcher is a
-- 'starter' on a given day iff innings_pitched >= 4, otherwise 'reliever'.
-- (4 IP captures both quality starts and short outings; everything below
-- that — long-relief, openers, multi-inning leverage — counts as bullpen.)
-- Filter to reliever appearances only; aggregate to one row per
-- (player, team, game_date) so multi-inning reliever lines collapse to a
-- single appearance.
-- ==========================================================================
CREATE OR REPLACE TABLE gold_reliever_workload AS
WITH role_flagged AS (
    -- One row per pitching line in a regular-season Final game, with a
    -- starter/reliever flag derived from IP.
    SELECT
        p.game_pk,
        p.game_date,
        p.player_id,
        p.player_name,
        p.team_id,
        p.innings_pitched,
        COALESCE(p.pitches_thrown, 0) AS pitches_thrown,
        CASE WHEN p.innings_pitched >= 4 THEN 'starter' ELSE 'reliever' END AS role
    FROM silver_player_game_pitching p
    JOIN silver_game g USING (game_pk)
    WHERE g.game_type = 'R' AND g.status = 'Final'
),
reliever_days AS (
    -- One row per (reliever, team, date): an appearance plus pitches.
    -- A pitcher who relieved twice on a doubleheader date counts as 2.
    SELECT
        player_id,
        ANY_VALUE(player_name) AS player_name,
        team_id,
        game_date AS as_of_date,
        COUNT(*) AS appearances,
        SUM(pitches_thrown) AS pitches_thrown
    FROM role_flagged
    WHERE role = 'reliever'
    GROUP BY player_id, team_id, game_date
),
windowed AS (
    -- Self-join trailing-window: for each (player, team, as_of_date), sum
    -- appearances/pitches across rows where game_date is within the
    -- inclusive trailing N-day window. Self-join is portability-safe
    -- (Postgres + Databricks); avoids RANGE-INTERVAL syntax differences.
    SELECT
        cur.player_id,
        cur.player_name,
        cur.team_id,
        cur.as_of_date,
        SUM(CASE WHEN prev.as_of_date >= cur.as_of_date - INTERVAL '2' DAY
                 THEN prev.appearances ELSE 0 END) AS appearances_3d,
        SUM(prev.appearances) AS appearances_7d,
        SUM(CASE WHEN prev.as_of_date >= cur.as_of_date - INTERVAL '2' DAY
                 THEN prev.pitches_thrown ELSE 0 END) AS pitches_3d,
        SUM(prev.pitches_thrown) AS pitches_7d,
        MAX(CASE WHEN prev.as_of_date < cur.as_of_date THEN prev.as_of_date END)
            AS last_prior_appearance_date
    FROM reliever_days cur
    JOIN reliever_days prev
        ON prev.player_id = cur.player_id
       AND prev.team_id   = cur.team_id
       AND prev.as_of_date >= cur.as_of_date - INTERVAL '6' DAY
       AND prev.as_of_date <= cur.as_of_date
    GROUP BY cur.player_id, cur.player_name, cur.team_id, cur.as_of_date
)
SELECT
    CAST(team_id AS BIGINT)              AS team_id,
    CAST(player_id AS BIGINT)            AS player_id,
    player_name,
    as_of_date,
    CAST(appearances_3d AS BIGINT)       AS appearances_3d,
    CAST(appearances_7d AS BIGINT)       AS appearances_7d,
    CAST(pitches_3d AS BIGINT)           AS pitches_3d,
    CAST(pitches_7d AS BIGINT)           AS pitches_7d,
    -- days_since_last is computed against the most recent PRIOR appearance
    -- (today doesn't count as "since last"). NULL on a player's first-ever
    -- reliever appearance row, since there is no prior outing.
    CAST(DATEDIFF(as_of_date, last_prior_appearance_date) AS INT) AS days_since_last
FROM windowed;

-- ==========================================================================
-- gold_team_sos (DERIV-3)
-- Per-team running strength of schedule.
-- Drives FEAT-6 (SoS tooltip on team header).
--
-- Convention: opp_win_pct EXCLUDES the subject team's games from each
-- opponent's record. (Otherwise the metric is circular — if A and B only
-- ever play each other, A's SoS would just reflect what B did against A.)
-- For each (subject_team, as_of_date):
--   1. Gather every matchup subject_team played up to and including that
--      date, with the opponent_id and the opponent's record AS OF that
--      date excluding all games vs subject_team.
--   2. opp_win_pct = weighted avg of those opponent win-pcts, weighted by
--      number of games played against each opponent up to as_of_date.
-- ==========================================================================
CREATE OR REPLACE TABLE gold_team_sos AS
WITH game_results AS (
    -- One row per (team, game) for Final regular-season games. side gives
    -- subject vs opponent perspective via two materializations below.
    SELECT
        g.game_pk,
        g.season,
        g.game_date,
        g.home_team_id,
        g.away_team_id,
        g.winner_team_id
    FROM silver_game g
    WHERE g.game_type = 'R' AND g.status = 'Final' AND g.winner_team_id IS NOT NULL
),
matchups AS (
    -- Two rows per game: (subject, opponent, win_flag) for both perspectives.
    SELECT
        season,
        game_date,
        home_team_id AS subject_team_id,
        away_team_id AS opp_team_id,
        CASE WHEN winner_team_id = home_team_id THEN 1 ELSE 0 END AS subject_won
    FROM game_results
    UNION ALL
    SELECT
        season,
        game_date,
        away_team_id AS subject_team_id,
        home_team_id AS opp_team_id,
        CASE WHEN winner_team_id = away_team_id THEN 1 ELSE 0 END AS subject_won
    FROM game_results
),
subject_dates AS (
    -- Distinct (subject_team, season, as_of_date) — every date the team
    -- played at least one Final regular-season game.
    SELECT DISTINCT subject_team_id, season, game_date AS as_of_date
    FROM matchups
),
-- Per (subject_team, opp_team, as_of_date): how many times subject has
-- played opp on or before that date (the weight).
matchup_weights AS (
    SELECT
        sd.subject_team_id,
        sd.season,
        sd.as_of_date,
        m.opp_team_id,
        COUNT(*) AS games_played_vs_opp
    FROM subject_dates sd
    JOIN matchups m
        ON m.subject_team_id = sd.subject_team_id
       AND m.season          = sd.season
       AND m.game_date      <= sd.as_of_date
    GROUP BY sd.subject_team_id, sd.season, sd.as_of_date, m.opp_team_id
),
-- Per (subject_team, opp_team, as_of_date): opp's record EXCLUDING games
-- vs subject_team, on or before as_of_date. This is the "exclude subject"
-- math — we filter matchups where opp was the subject AND its opp was NOT
-- our subject_team.
opp_records AS (
    SELECT
        sd.subject_team_id,
        sd.season,
        sd.as_of_date,
        opp_m.subject_team_id AS opp_team_id,
        SUM(opp_m.subject_won) AS opp_wins_excl,
        COUNT(*)               AS opp_games_excl
    FROM subject_dates sd
    JOIN matchups opp_m
        ON opp_m.season           = sd.season
       AND opp_m.game_date       <= sd.as_of_date
       AND opp_m.opp_team_id     != sd.subject_team_id   -- exclude games vs subject
    GROUP BY sd.subject_team_id, sd.season, sd.as_of_date, opp_m.subject_team_id
),
-- Join weights × opponent records and weight-average.
weighted AS (
    SELECT
        mw.subject_team_id,
        mw.season,
        mw.as_of_date,
        mw.opp_team_id,
        mw.games_played_vs_opp,
        CASE WHEN orr.opp_games_excl > 0
             THEN 1.0 * orr.opp_wins_excl / orr.opp_games_excl
             ELSE NULL END AS opp_win_pct_excl
    FROM matchup_weights mw
    LEFT JOIN opp_records orr
        ON  orr.subject_team_id = mw.subject_team_id
        AND orr.season          = mw.season
        AND orr.as_of_date      = mw.as_of_date
        AND orr.opp_team_id     = mw.opp_team_id
),
sos AS (
    SELECT
        subject_team_id AS team_id,
        season,
        as_of_date,
        -- Weighted avg of opp win-pct, weighted by games played vs opp.
        -- Opponents whose only games so far were against subject have NULL
        -- win-pct (no out-of-matchup record yet); they drop out of the avg.
        SUM(games_played_vs_opp * opp_win_pct_excl)
            / NULLIF(SUM(CASE WHEN opp_win_pct_excl IS NOT NULL
                              THEN games_played_vs_opp ELSE 0 END), 0)
            AS opp_win_pct,
        SUM(CASE WHEN opp_win_pct_excl > 0.5 THEN games_played_vs_opp ELSE 0 END)
            AS games_vs_winning,
        SUM(CASE WHEN opp_win_pct_excl < 0.5 THEN games_played_vs_opp ELSE 0 END)
            AS games_vs_losing
    FROM weighted
    GROUP BY subject_team_id, season, as_of_date
)
SELECT
    CAST(team_id AS BIGINT)         AS team_id,
    CAST(season AS BIGINT)          AS season,
    as_of_date,
    CAST(opp_win_pct AS DOUBLE)     AS opp_win_pct,
    CAST(games_vs_winning AS INT)   AS games_vs_winning,
    CAST(games_vs_losing AS INT)    AS games_vs_losing
FROM sos;
