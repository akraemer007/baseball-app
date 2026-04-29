// Real SQL-backed implementations of each API route.
// Swap route handlers from `../mocks/data.js` to these once the Databricks
// backfill has populated the gold_* tables.
//
// NOTE: None of these are wired in yet — mocks are still in use.
//       Import and call from routes/ when ready.

import type {
  BulkStatDistributionResponse,
  GameSummaryResponse,
  GameType,
  HrRaceResponse,
  LeagueResponse,
  MilestoneEvent,
  PlayerResponse,
  ProjectionsResponse,
  RecapItem,
  RecapsResponse,
  StatDistributionResponse,
  TeamMilestonesResponse,
  TeamPlayerDistributionResponse,
  TeamResponse,
} from '../../../shared/types/index.js';
import { query } from '../lib/warehouse.js';

/** Savant box-score URL — duplicated server-side so we don't import from
 *  client code. Kept in sync with app/client/src/lib/savant.ts. */
function savantBoxScoreUrl(gamePk: string | number): string {
  return `https://baseballsavant.mlb.com/gamefeed?gamePk=${gamePk}&hf=boxScore`;
}

// ---- helpers ---------------------------------------------------------------

/** Pretty label per stat_name emitted by gold_team_stat_vs_league. */
export const STAT_LABELS: Record<string, string> = {
  // Season totals / summary
  run_diff: 'Run Diff',
  hits_total: 'Hits',
  hr_total: 'HR',
  walks_total: 'BB',
  strikeouts_pitching_total: 'K (pitching)',
  // Rates
  runs_per_game: 'R/G',
  hr_per_game: 'HR/G',
  avg: 'AVG',
  obp: 'OBP',
  slg: 'SLG',
  ops: 'OPS',
  ops_plus: 'OPS+',
  xwoba: 'xwOBA',
  woba: 'wOBA',
  xba: 'xBA',
  era: 'ERA',
  era_minus: 'ERA-',
  fip: 'FIP',
  k_per_9: 'K/9',
  errors_per_game: 'E/G',
};

/** Stats where a lower value is better. */
const LOWER_IS_BETTER = new Set(['era', 'era_minus', 'fip', 'errors_per_game']);

/** Stats that should render as whole integers (no decimals). */
const INTEGER_STATS = new Set([
  'run_diff',
  'hits_total',
  'hr_total',
  'walks_total',
  'strikeouts_pitching_total',
]);

/** Which card each stat belongs to on the Team page. */
const STAT_CATEGORIES: Record<string, 'batting' | 'pitching' | 'fielding'> = {
  run_diff: 'fielding',
  hits_total: 'batting',
  hr_total: 'batting',
  walks_total: 'batting',
  avg: 'batting',
  obp: 'batting',
  slg: 'batting',
  ops: 'batting',
  ops_plus: 'batting',
  xwoba: 'batting',
  woba: 'batting',
  xba: 'batting',
  runs_per_game: 'batting',
  hr_per_game: 'batting',
  strikeouts_pitching_total: 'pitching',
  era: 'pitching',
  era_minus: 'pitching',
  fip: 'pitching',
  k_per_9: 'pitching',
  errors_per_game: 'fielding',
};

/** Per-stat value formatting — integers for totals, 3 decimals for slash-line stats, 2 for everything else. */
function formatStatValue(stat: string, raw: number | null | undefined): number {
  if (raw == null) return 0;
  if (INTEGER_STATS.has(stat)) return Math.round(raw);
  const threeDec = new Set(['avg', 'obp', 'slg', 'ops', 'xwoba', 'woba', 'xba']);
  return Number(raw.toFixed(threeDec.has(stat) ? 3 : 2));
}


interface DivisionTrajectoryRow {
  season: number;
  division: string;
  league: string;
  team_id: number;
  team_abbrev: string;
  team_name: string;
  primary_color: string;
  as_of_date: string;
  games_played: number;
  cum_wins: number;
  cum_losses: number;
  w_minus_l: number;
  /** game_pk of the game played on as_of_date for this team. NULL for
   *  rare doubleheader days where the join can't disambiguate, in which
   *  case we pick the smaller game_pk. Drives the click-to-drawer path
   *  in DivisionTrajectoryChart (FEAT-3). */
  game_pk: number | null;
}

// ---- /api/league/divisions -------------------------------------------------

export async function getLeagueFromWarehouse(season: number): Promise<LeagueResponse> {
  // CTE picks one game_pk per (season, date, team) so doubleheader days
  // don't multiply trajectory rows. Plain Postgres-compatible SQL — no
  // Delta-only idioms (per CLAUDE.md pipeline portability rule).
  const rows = await query<DivisionTrajectoryRow>(
    `WITH team_game_pk AS (
       SELECT season, game_date, team_id, MIN(game_pk) AS game_pk
         FROM (
           SELECT season, game_date, home_team_id AS team_id, game_pk
             FROM silver_game WHERE status = 'Final'
           UNION ALL
           SELECT season, game_date, away_team_id AS team_id, game_pk
             FROM silver_game WHERE status = 'Final'
         ) tg
        GROUP BY season, game_date, team_id
     )
     SELECT t.season, t.division, t.league, t.team_id, t.team_abbrev,
            t.team_name, t.primary_color, t.as_of_date, t.games_played,
            t.cum_wins, t.cum_losses, t.w_minus_l, gp.game_pk
       FROM gold_division_trajectory t
       LEFT JOIN team_game_pk gp
         ON gp.season = t.season
        AND gp.game_date = t.as_of_date
        AND gp.team_id = t.team_id
      WHERE t.season = ${season}
      ORDER BY t.division, t.team_abbrev, t.games_played`
  );
  // Group into divisions → teams → trajectory points
  const divisions = new Map<string, { id: string; name: string; league: 'AL' | 'NL'; teams: Map<string, { id: string; abbrev: string; name: string; color: string }> }>();
  const trajectory = new Map<string, { teamId: string; points: { date: string; wMinusL: number; gamesPlayed: number; gamePk?: number }[] }>();
  for (const r of rows) {
    if (!divisions.has(r.division)) {
      divisions.set(r.division, {
        id: r.division.replace(/\s+/g, '-').toUpperCase(),
        name: r.division,
        league: r.league as 'AL' | 'NL',
        teams: new Map(),
      });
    }
    const div = divisions.get(r.division)!;
    if (!div.teams.has(r.team_abbrev)) {
      div.teams.set(r.team_abbrev, {
        id: r.team_abbrev,
        abbrev: r.team_abbrev,
        name: r.team_name,
        color: r.primary_color,
      });
    }
    if (!trajectory.has(r.team_abbrev)) {
      trajectory.set(r.team_abbrev, { teamId: r.team_abbrev, points: [] });
    }
    trajectory.get(r.team_abbrev)!.points.push({
      date: r.as_of_date,
      wMinusL: r.w_minus_l,
      gamesPlayed: r.games_played,
      gamePk: r.game_pk ?? undefined,
    });
  }
  return {
    season,
    divisions: Array.from(divisions.values()).map((d) => ({
      id: d.id,
      name: d.name,
      league: d.league,
      teams: Array.from(d.teams.values()),
    })),
    trajectory: Array.from(trajectory.values()),
  };
}

// ---- /api/league/hr-race ---------------------------------------------------

interface HrRaceRow {
  season: number;
  player_id: number;
  player_name: string;
  team_id: number;
  team_abbrev: string;
  primary_color: string;
  game_date: string;
  game_num: number;
  cumulative_hr: number;
}

export async function getHrRaceFromWarehouse(season: number): Promise<HrRaceResponse> {
  const rows = await query<HrRaceRow>(
    `SELECT h.season, h.player_id, h.player_name,
            h.team_id, t.abbrev AS team_abbrev, t.primary_color,
            h.game_date, h.game_num, h.cumulative_hr
       FROM gold_player_hr_race h
       JOIN silver_team t ON t.team_id = h.team_id
      WHERE h.season = ${season}
      ORDER BY h.player_id, h.game_num`
  );
  const leaders = new Map<number, HrRaceResponse['leaders'][number]>();
  for (const r of rows) {
    if (!leaders.has(r.player_id)) {
      leaders.set(r.player_id, {
        playerId: String(r.player_id),
        playerName: r.player_name,
        teamId: r.team_abbrev,
        teamColor: r.primary_color,
        points: [],
        seasonHrTotal: 0,
      });
    }
    const entry = leaders.get(r.player_id)!;
    entry.points.push({ gameNum: r.game_num, cumulativeHr: r.cumulative_hr });
    entry.seasonHrTotal = Math.max(entry.seasonHrTotal, r.cumulative_hr);
  }
  return {
    season,
    leaders: Array.from(leaders.values()).sort(
      (a, b) => b.seasonHrTotal - a.seasonHrTotal
    ),
  };
}

// ---- /api/league/stat-distribution -----------------------------------------

interface StatDistributionRow {
  team_abbrev: string;
  team_name: string;
  primary_color: string;
  team_value: number;
  league_mean: number;
  rank_in_league: number;
}

export async function getStatDistributionFromWarehouse(
  stat: string,
  season: number
): Promise<StatDistributionResponse> {
  const safeStat = stat.replace(/[^a-z0-9_]/gi, '');
  const rows = await query<StatDistributionRow>(
    `SELECT g.team_abbrev, g.team_name, t.primary_color,
            g.team_value, g.league_mean, g.rank_in_league
       FROM gold_team_stat_vs_league g
       JOIN silver_team t ON t.team_id = g.team_id
      WHERE g.season = ${season} AND g.stat_name = '${safeStat}'
      ORDER BY g.rank_in_league`
  );
  return {
    season,
    statName: safeStat,
    statLabel: STAT_LABELS[safeStat] ?? safeStat,
    lowerIsBetter: LOWER_IS_BETTER.has(safeStat),
    leagueMean: rows[0]?.league_mean ?? 0,
    entries: rows.map((r) => ({
      teamAbbrev: r.team_abbrev,
      teamName: r.team_name,
      teamColor: r.primary_color,
      value: formatStatValue(safeStat, r.team_value),
      rank: r.rank_in_league,
    })),
  };
}

// ---- /api/league/stat-distributions (bulk) ---------------------------------

interface BulkStatDistributionRow {
  stat_name: string;
  team_abbrev: string;
  team_name: string;
  primary_color: string;
  team_value: number;
  league_mean: number;
  rank_in_league: number;
}

/** Bulk variant of getStatDistributionFromWarehouse — one SQL round trip for
 *  many stats. Each input stat is sanitized identically (regex strip +
 *  STAT_LABELS whitelist) so injection vectors match the single-stat path.
 *  Rows are grouped by stat_name in JS to produce the same per-stat payload
 *  shape, so callers read `distributions[statName]` and treat each entry like
 *  a StatDistributionResponse. */
export async function getBulkStatDistributionsFromWarehouse(
  stats: string[],
  season: number
): Promise<BulkStatDistributionResponse> {
  const safeStats = Array.from(
    new Set(
      stats
        .map((s) => s.replace(/[^a-z0-9_]/gi, ''))
        .filter(
          (s) =>
            s.length > 0 &&
            Object.prototype.hasOwnProperty.call(STAT_LABELS, s),
        ),
    ),
  );
  if (safeStats.length === 0) {
    return { season, distributions: {} };
  }
  const inList = safeStats.map((s) => `'${s}'`).join(', ');
  const rows = await query<BulkStatDistributionRow>(
    `SELECT g.stat_name, g.team_abbrev, g.team_name, t.primary_color,
            g.team_value, g.league_mean, g.rank_in_league
       FROM gold_team_stat_vs_league g
       JOIN silver_team t ON t.team_id = g.team_id
      WHERE g.season = ${season} AND g.stat_name IN (${inList})
      ORDER BY g.stat_name, g.rank_in_league`
  );
  const grouped = new Map<string, BulkStatDistributionRow[]>();
  for (const r of rows) {
    if (!grouped.has(r.stat_name)) grouped.set(r.stat_name, []);
    grouped.get(r.stat_name)!.push(r);
  }
  const distributions: Record<string, StatDistributionResponse> = {};
  for (const stat of safeStats) {
    const statRows = grouped.get(stat) ?? [];
    distributions[stat] = {
      season,
      statName: stat,
      statLabel: STAT_LABELS[stat] ?? stat,
      lowerIsBetter: LOWER_IS_BETTER.has(stat),
      leagueMean: statRows[0]?.league_mean ?? 0,
      entries: statRows.map((r) => ({
        teamAbbrev: r.team_abbrev,
        teamName: r.team_name,
        teamColor: r.primary_color,
        value: formatStatValue(stat, r.team_value),
        rank: r.rank_in_league,
      })),
    };
  }
  return { season, distributions };
}

// ---- /api/team/:teamId/player-stat-distribution ----------------------------

/** Per-player stat distribution within a team. Drives the second strip plot
 *  that shows up inside the expanded percentile row on the Team page. Only
 *  a subset of stats map to something meaningful at the player grain; team
 *  totals like run_diff or league-indexed rates like OPS+ aren't included. */
const PLAYER_STAT_SPECS: Record<
  string,
  {
    side: 'hitter' | 'pitcher';
    label: string;
    /** SQL expression computing the stat off silver_player_season (alias `p`).
     *  If the expression references `gpes.*`, the query injects a
     *  `LEFT JOIN gold_player_expected_stats gpes` automatically. */
    valueExpr: string;
    lowerIsBetter: boolean;
  }
> = {
  avg:                         { side: 'hitter',  label: 'AVG',           valueExpr: 'p.avg',                                                      lowerIsBetter: false },
  obp:                         { side: 'hitter',  label: 'OBP',           valueExpr: 'p.obp',                                                      lowerIsBetter: false },
  slg:                         { side: 'hitter',  label: 'SLG',           valueExpr: 'p.slg',                                                      lowerIsBetter: false },
  ops:                         { side: 'hitter',  label: 'OPS',           valueExpr: '(p.obp + p.slg)',                                            lowerIsBetter: false },
  // xwOBA / wOBA / xBA live in gold_player_expected_stats (DERIV-1 did
  // not extend silver_player_season); LEFT JOIN below kicks in when the
  // expression references gpes.
  xwoba:                       { side: 'hitter',  label: 'xwOBA',         valueExpr: 'gpes.xwoba',                                                 lowerIsBetter: false },
  woba:                        { side: 'hitter',  label: 'wOBA',          valueExpr: 'gpes.woba',                                                  lowerIsBetter: false },
  xba:                         { side: 'hitter',  label: 'xBA',           valueExpr: 'gpes.xba',                                                   lowerIsBetter: false },
  hits_total:                  { side: 'hitter',  label: 'Hits',          valueExpr: 'p.hits',                                                     lowerIsBetter: false },
  hr_total:                    { side: 'hitter',  label: 'HR',            valueExpr: 'p.home_runs',                                                lowerIsBetter: false },
  walks_total:                 { side: 'hitter',  label: 'BB',            valueExpr: 'p.walks',                                                    lowerIsBetter: false },
  era:                         { side: 'pitcher', label: 'ERA',           valueExpr: 'p.era',                                                      lowerIsBetter: true  },
  fip:                         { side: 'pitcher', label: 'FIP',
    // (13*HR + 3*BB - 2*K) / IP + league-ish constant (~3.10). Same
    // formula as the team-level FIP in gold; constant drifts ~0.1 from
    // the exact dynamic value but the rank order + relative distances
    // are identical, which is what the chart cares about.
    valueExpr: '(13.0 * p.home_runs_allowed + 3.0 * p.walks_p - 2.0 * p.strikeouts_p) / NULLIF(p.innings_pitched, 0) + 3.10',
    lowerIsBetter: true  },
  k_per_9:                     { side: 'pitcher', label: 'K/9',           valueExpr: 'p.strikeouts_p * 9.0 / NULLIF(p.innings_pitched, 0)',        lowerIsBetter: false },
  strikeouts_pitching_total:   { side: 'pitcher', label: 'K (pitching)',  valueExpr: 'p.strikeouts_p',                                             lowerIsBetter: false },
};

/** Dynamic playing-time cutoffs that scale with the team's games-played-so-far.
 *  Hitter = tracks the 3.1 PA/game batting-title rule using AB as a proxy.
 *  Pitcher = OR-split so regular relievers survive early-season IP thresholds:
 *    (a) workload path — IP >= 0.4 * team_games (starters, occasional long men)
 *    (b) appearance path — pitching_games >= 0.25 * team_games (relievers
 *        who appear roughly every 4 team games, with a 3-IP floor so we
 *        don't list September call-ups with one outing).
 */
const HITTER_AB_PER_GAME = 2.7;
const PITCHER_IP_PER_GAME = 0.4;
const PITCHER_APPEARANCES_PER_GAME = 0.25;
const PITCHER_MIN_IP = 3;

interface TeamPlayerDistributionRow {
  player_id: number;
  player_name: string;
  value: number | null;
  playing_time: number | null;
  team_games: number | null;
  team_value: number | null;
}

export async function getTeamPlayerStatDistributionFromWarehouse(
  teamAbbrev: string,
  statKey: string,
  season: number,
): Promise<TeamPlayerDistributionResponse | null> {
  const spec = PLAYER_STAT_SPECS[statKey];
  if (!spec) return null;
  const safeAbbrev = teamAbbrev.toUpperCase().replace(/[^A-Z]/g, '');
  const ptCol = spec.side === 'hitter' ? 'p.at_bats' : 'p.innings_pitched';
  const eligibility = spec.side === 'hitter'
    ? `p.at_bats >= ${HITTER_AB_PER_GAME} * (SELECT games FROM games_played)`
    : `(
         p.innings_pitched >= ${PITCHER_IP_PER_GAME} * (SELECT games FROM games_played)
         OR p.pitching_games >= ${PITCHER_APPEARANCES_PER_GAME} * (SELECT games FROM games_played)
       )
       AND p.innings_pitched >= ${PITCHER_MIN_IP}`;
  // Stats whose valueExpr references gpes.* live in
  // gold_player_expected_stats; pull them in with a LEFT JOIN so a player
  // with no Statcast row simply nulls out (eligibility filter on
  // `(spec.valueExpr) IS NOT NULL` will drop them from the strip plot).
  const needsExpectedJoin = spec.valueExpr.includes('gpes.');
  const expectedJoin = needsExpectedJoin
    ? 'LEFT JOIN gold_player_expected_stats gpes ON gpes.season = p.season AND gpes.player_id = p.player_id'
    : '';

  const rows = await query<TeamPlayerDistributionRow>(
    `WITH team_row AS (
       SELECT team_id FROM silver_team WHERE abbrev = '${safeAbbrev}'
     ),
     games_played AS (
       SELECT COUNT(DISTINCT tg.game_pk) AS games
         FROM silver_team_game tg
         JOIN silver_game g USING (game_pk)
         JOIN team_row t ON t.team_id = tg.team_id
        WHERE g.season = ${season}
          AND g.status = 'Final'
          AND g.game_type = 'R'
     ),
     team_agg AS (
       SELECT tgsl.team_value
         FROM gold_team_stat_vs_league tgsl
         JOIN team_row t ON t.team_id = tgsl.team_id
        WHERE tgsl.season = ${season}
          AND tgsl.stat_name = '${statKey}'
     )
     SELECT
       p.player_id,
       p.player_name,
       ${spec.valueExpr} AS value,
       ${ptCol} AS playing_time,
       (SELECT games FROM games_played) AS team_games,
       (SELECT team_value FROM team_agg)  AS team_value
       FROM silver_player_season p
       JOIN team_row t ON t.team_id = p.team_id
       ${expectedJoin}
      WHERE p.season = ${season}
        AND ${ptCol} IS NOT NULL
        AND ${eligibility}
        AND (${spec.valueExpr}) IS NOT NULL
      ORDER BY value ${spec.lowerIsBetter ? 'ASC' : 'DESC'}`,
  );

  if (rows.length === 0) return null;
  const teamValue = rows[0].team_value ?? 0;

  return {
    season,
    teamAbbrev: safeAbbrev,
    statName: statKey,
    statLabel: spec.label,
    lowerIsBetter: spec.lowerIsBetter,
    teamValue: formatStatValue(statKey, teamValue),
    side: spec.side,
    entries: rows.map((r) => ({
      playerId: String(r.player_id),
      playerName: r.player_name,
      value: formatStatValue(statKey, r.value),
      playingTime: Number((r.playing_time ?? 0).toFixed(1)),
    })),
  };
}

// ---- /api/team/:teamId -----------------------------------------------------

interface TeamSummaryRow {
  season: number;
  team_id: number;
  abbrev: string;
  name: string;
  primary_color: string;
  cum_wins: number;
  cum_losses: number;
  w_minus_l: number;
  games_played: number;
}

interface TeamPercentileRow {
  stat_name: string;
  team_value: number;
  league_mean: number;
  league_stddev: number;
  z_score: number;
  rank_in_league: number;
}

interface RecentGameRow {
  game_pk: number;
  game_date: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_score: number;
  away_score: number;
  winner_team_id: number | null;
}

interface TopPerformerRow {
  game_pk: number;
  kind: 'batter' | 'pitcher';
  player_id: number;
  player_name: string;
  // Batter fields (null for pitcher rows)
  at_bats: number | null;
  hits: number | null;
  home_runs: number | null;
  rbi: number | null;
  // Pitcher fields (null for batter rows)
  innings_pitched: number | null;
  earned_runs: number | null;
  strikeouts: number | null;
  wins: number | null;
}

/** Silver stores IP as true decimal innings (1/3 = 0.333…). Baseball
 *  convention is "X.Y" where Y ∈ {0,1,2} counts outs past the last
 *  completed inning, so 6.667 → "6.2" and 7.0 → "7". */
function formatIP(ip: number): string {
  const outs = Math.round(ip * 3);
  const whole = Math.floor(outs / 3);
  const rem = outs % 3;
  return rem === 0 ? `${whole}` : `${whole}.${rem}`;
}

/** Build {playerName, statLine} for the row's performer. Name is rendered
 *  separately so the client can wrap it in a Savant profile link. */
function formatTopPerformer(row: TopPerformerRow): {
  playerId: string;
  playerName: string;
  statLine: string;
} {
  // Just the last name for terseness — "Suzuki" beats "S. Suzuki" in a table cell.
  const parts = row.player_name.trim().split(/\s+/);
  const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
  let statLine: string;
  if (row.kind === 'batter') {
    const bits: string[] = [`${row.hits ?? 0}-${row.at_bats ?? 0}`];
    if ((row.home_runs ?? 0) > 0) {
      bits.push(row.home_runs === 1 ? 'HR' : `${row.home_runs} HR`);
    }
    if ((row.rbi ?? 0) > 0) bits.push(`${row.rbi} RBI`);
    statLine = bits.join(', ');
  } else {
    statLine = [
      `${formatIP(row.innings_pitched ?? 0)} IP`,
      `${row.strikeouts ?? 0} K`,
      `${row.earned_runs ?? 0} ER`,
    ].join(', ');
  }
  return { playerId: String(row.player_id), playerName: last, statLine };
}

interface UpcomingGameRow {
  game_pk: number;
  game_date: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_probable_pitcher_id: number | null;
  away_probable_pitcher_id: number | null;
  home_probable_pitcher_name: string | null;
  away_probable_pitcher_name: string | null;
  home_win_prob: number | null;
}

export async function getTeamFromWarehouse(
  teamAbbrev: string,
  season: number
): Promise<TeamResponse> {
  const safeAbbrev = teamAbbrev.toUpperCase().replace(/[^A-Z]/g, '');

  const [summary] = await query<TeamSummaryRow>(
    `SELECT gt.season, gt.team_id, t.abbrev, t.name, t.primary_color,
            gt.cum_wins, gt.cum_losses, gt.w_minus_l, gt.games_played
       FROM gold_division_trajectory gt
       JOIN silver_team t USING (team_id)
      WHERE gt.season = ${season} AND t.abbrev = '${safeAbbrev}'
      ORDER BY gt.as_of_date DESC
      LIMIT 1`
  );
  if (!summary) {
    throw new Error(`Team not found: ${safeAbbrev} in season ${season}`);
  }
  const teamId = summary.team_id;

  const [percentiles, recent, upcoming, leaderRow, runDiffRow, topPerformers] = await Promise.all([
    query<TeamPercentileRow>(
      `SELECT stat_name, team_value, league_mean, league_stddev, z_score, rank_in_league
         FROM gold_team_stat_vs_league
        WHERE season = ${season} AND team_id = ${teamId}`
    ),
    query<RecentGameRow>(
      `SELECT g.game_pk, g.game_date, g.home_team_id, h.abbrev AS home_abbrev,
              g.away_team_id, a.abbrev AS away_abbrev,
              g.home_score, g.away_score, g.winner_team_id
         FROM silver_game g
         JOIN silver_team h ON h.team_id = g.home_team_id
         JOIN silver_team a ON a.team_id = g.away_team_id
        WHERE g.season = ${season}
          AND g.status = 'Final'
          AND (g.home_team_id = ${teamId} OR g.away_team_id = ${teamId})
        ORDER BY g.game_date DESC
        LIMIT 10`
    ),
    query<UpcomingGameRow>(
      `SELECT g.game_pk, g.game_date, g.home_team_id, h.abbrev AS home_abbrev,
              g.away_team_id, a.abbrev AS away_abbrev,
              g.home_probable_pitcher_id, g.away_probable_pitcher_id,
              hp.player_name AS home_probable_pitcher_name,
              ap.player_name AS away_probable_pitcher_name,
              e.home_win_prob
         FROM silver_game g
         JOIN silver_team h ON h.team_id = g.home_team_id
         JOIN silver_team a ON a.team_id = g.away_team_id
         LEFT JOIN gold_game_elo e USING (game_pk)
         LEFT JOIN silver_player_season hp
           ON hp.player_id = g.home_probable_pitcher_id AND hp.season = ${season}
         LEFT JOIN silver_player_season ap
           ON ap.player_id = g.away_probable_pitcher_id AND ap.season = ${season}
        WHERE g.season = ${season}
          AND g.status != 'Final'
          AND (g.home_team_id = ${teamId} OR g.away_team_id = ${teamId})
        ORDER BY g.game_date ASC
        LIMIT 5`
    ),
    // Division leader's latest (cum_wins, cum_losses) — for games-behind.
    query<{ cum_wins: number; cum_losses: number }>(
      `WITH tgt AS (
         SELECT division FROM gold_division_trajectory
         WHERE season = ${season} AND team_id = ${teamId}
         LIMIT 1
       ),
       latest AS (
         SELECT team_id, MAX(as_of_date) AS max_date
         FROM gold_division_trajectory
         WHERE season = ${season}
           AND division = (SELECT division FROM tgt)
         GROUP BY team_id
       )
       SELECT gt.cum_wins, gt.cum_losses
       FROM gold_division_trajectory gt
       JOIN latest l ON l.team_id = gt.team_id AND l.max_date = gt.as_of_date
       WHERE gt.season = ${season} AND gt.division = (SELECT division FROM tgt)
       ORDER BY (gt.cum_wins - gt.cum_losses) DESC
       LIMIT 1`
    ),
    // Run differential = runs scored minus runs allowed, over all finals this season.
    query<{ runs_for: number; runs_against: number }>(
      `SELECT SUM(tg.runs) AS runs_for,
              SUM(opp.runs) AS runs_against
         FROM silver_team_game tg
         JOIN silver_team_game opp
           ON opp.game_pk = tg.game_pk AND opp.team_id != tg.team_id
         JOIN silver_game g ON g.game_pk = tg.game_pk
        WHERE g.season = ${season}
          AND g.status = 'Final'
          AND g.game_type = 'R'
          AND tg.team_id = ${teamId}`
    ),
    // Top performer per recent game: best batter by hits/HR/RBI/walks/runs, or
    // the starting pitcher if they had a "gem" (>=6 IP, <=2 ER). One row per
    // game; NULL if we didn't find either.
    query<TopPerformerRow>(
      `WITH recent AS (
         SELECT g.game_pk
           FROM silver_game g
          WHERE g.season = ${season}
            AND g.status = 'Final'
            AND (g.home_team_id = ${teamId} OR g.away_team_id = ${teamId})
          ORDER BY g.game_date DESC
          LIMIT 10
       ),
       batters AS (
         SELECT b.game_pk, b.player_id, b.player_name,
                b.at_bats, b.hits, b.home_runs, b.rbi,
                (b.hits + b.home_runs * 3.0 + b.rbi * 1.5
                 + b.walks * 0.5 + b.runs * 0.5) AS score
           FROM silver_player_game_batting b
           JOIN recent r USING (game_pk)
          WHERE b.team_id = ${teamId}
       ),
       best_batter AS (
         SELECT game_pk, player_id, player_name, at_bats, hits, home_runs, rbi, score,
                ROW_NUMBER() OVER (PARTITION BY game_pk ORDER BY score DESC) AS rn
           FROM batters
       ),
       pitchers AS (
         SELECT p.game_pk, p.player_id, p.player_name,
                p.innings_pitched, p.earned_runs, p.strikeouts, p.wins
           FROM silver_player_game_pitching p
           JOIN recent r USING (game_pk)
          WHERE p.team_id = ${teamId}
            AND p.innings_pitched >= 6
            AND p.earned_runs <= 2
       ),
       best_pitcher AS (
         SELECT *, ROW_NUMBER() OVER (
                     PARTITION BY game_pk
                     ORDER BY innings_pitched DESC, strikeouts DESC
                   ) AS rn
           FROM pitchers
       )
       SELECT
         COALESCE(bp.game_pk, bb.game_pk) AS game_pk,
         CASE WHEN bp.game_pk IS NOT NULL THEN 'pitcher' ELSE 'batter' END AS kind,
         COALESCE(bp.player_id, bb.player_id) AS player_id,
         COALESCE(bp.player_name, bb.player_name) AS player_name,
         bb.at_bats, bb.hits, bb.home_runs, bb.rbi,
         bp.innings_pitched, bp.earned_runs, bp.strikeouts, bp.wins
       FROM best_batter bb
       FULL OUTER JOIN (SELECT * FROM best_pitcher WHERE rn = 1) bp
         ON bp.game_pk = bb.game_pk
       WHERE COALESCE(bb.rn, 1) = 1`
    ),
  ]);

  // Compute streak from the most-recent games
  let streakType: 'W' | 'L' = 'W';
  let streakLength = 0;
  for (const g of recent) {
    const won =
      g.winner_team_id === teamId ||
      (g.winner_team_id === null && g.home_team_id === teamId && g.home_score > g.away_score);
    const type: 'W' | 'L' = won ? 'W' : 'L';
    if (streakLength === 0) {
      streakType = type;
      streakLength = 1;
    } else if (type === streakType) {
      streakLength++;
    } else {
      break;
    }
  }

  const winPct = summary.cum_wins / Math.max(1, summary.cum_wins + summary.cum_losses);
  const leader = leaderRow[0];
  const gamesBehind = leader
    ? Math.max(
        0,
        ((leader.cum_wins - summary.cum_wins) + (summary.cum_losses - leader.cum_losses)) / 2,
      )
    : 0;

  // Pythagorean expected record: expected_win_pct = RS² / (RS² + RA²),
  // expected_wins = round(pct × games_played). Edge case: if either total
  // is missing or no games have been played, fall back to a 0-0 placeholder.
  const runsFor = runDiffRow[0]?.runs_for ?? 0;
  const runsAgainst = runDiffRow[0]?.runs_against ?? 0;
  const gamesPlayed = summary.cum_wins + summary.cum_losses;
  let expectedWins = 0;
  let expectedLosses = 0;
  if (gamesPlayed > 0 && runsFor + runsAgainst > 0) {
    const expectedWinPct =
      (runsFor * runsFor) / (runsFor * runsFor + runsAgainst * runsAgainst);
    expectedWins = Math.round(expectedWinPct * gamesPlayed);
    expectedLosses = gamesPlayed - expectedWins;
  }

  return {
    season,
    team: {
      id: summary.abbrev,
      abbrev: summary.abbrev,
      name: summary.name,
      color: summary.primary_color,
    },
    record: {
      wins: summary.cum_wins,
      losses: summary.cum_losses,
      winPct: Number(winPct.toFixed(3)),
      runDiff: runDiffRow[0]
        ? Math.round((runDiffRow[0].runs_for ?? 0) - (runDiffRow[0].runs_against ?? 0))
        : 0,
      gamesBehind,
    },
    expectedRecord: { wins: expectedWins, losses: expectedLosses },
    streak: { type: streakType, length: streakLength },
    percentileStats: percentiles.map((p) => ({
      statKey: p.stat_name,
      label: STAT_LABELS[p.stat_name] ?? p.stat_name,
      value: formatStatValue(p.stat_name, p.team_value),
      // Lower rank = better. Convert rank 1-of-30 → 97th percentile.
      leagueRankPercentile: Math.round(((30 - p.rank_in_league + 1) / 30) * 100),
      category: STAT_CATEGORIES[p.stat_name] ?? 'batting',
      leagueMean: formatStatValue(p.stat_name, p.league_mean),
    })),
    recentGames: recent.map((g) => {
      const perf = topPerformers.find((p) => p.game_pk === g.game_pk);
      return {
        gameId: String(g.game_pk),
        date: g.game_date,
        homeTeamId: g.home_abbrev,
        awayTeamId: g.away_abbrev,
        homeScore: g.home_score,
        awayScore: g.away_score,
        isFinal: true,
        winnerTeamId:
          g.winner_team_id === null
            ? null
            : g.winner_team_id === g.home_team_id
              ? g.home_abbrev
              : g.away_abbrev,
        topPerformer: perf ? formatTopPerformer(perf) : undefined,
      };
    }),
    upcomingGames: upcoming.map((g) => ({
      gameId: String(g.game_pk),
      date: g.game_date,
      homeTeamId: g.home_abbrev,
      awayTeamId: g.away_abbrev,
      probableHomePitcherId: g.home_probable_pitcher_id
        ? String(g.home_probable_pitcher_id)
        : null,
      probableAwayPitcherId: g.away_probable_pitcher_id
        ? String(g.away_probable_pitcher_id)
        : null,
      probableHomePitcherName: g.home_probable_pitcher_name,
      probableAwayPitcherName: g.away_probable_pitcher_name,
      impliedHomeWinProb: g.home_win_prob ?? 0.5,
    })),
  };
}

// ---- /api/team/:teamId/milestones ------------------------------------------

interface TeamMilestoneRow {
  subject_type: 'team' | 'player';
  subject_id: number;
  subject_name: string;
  event_kind: MilestoneEvent['eventKind'];
  event_text: string;
  streak_length: number | null;
  comparison_year: number | null;
  happened_on: string;
}

/**
 * Pull this team's last-7-days milestone callouts from
 * `gold_milestone_events` (DERIV-5).
 *
 * Filtering:
 *   - team_winning_streak rows: subject_id matches the team's id directly.
 *   - player rows: only include if the player batted for THIS team on
 *     `happened_on` — joined through `silver_player_game_batting`. A
 *     traded player's prior-team streak therefore won't surface on the
 *     new team's page.
 *
 * Sort: rarity first (NULL `comparison_year` → rarest, sorted as the
 * smallest possible year via COALESCE to a sentinel), then most-recent
 * first. Top 3.
 */
export async function getTeamMilestonesFromWarehouse(
  teamAbbrev: string,
): Promise<TeamMilestonesResponse> {
  const safeAbbrev = teamAbbrev.toUpperCase().replace(/[^A-Z]/g, '');

  const rows = await query<TeamMilestoneRow>(
    `WITH team_row AS (
       SELECT team_id FROM silver_team WHERE abbrev = '${safeAbbrev}'
     ),
     team_milestones AS (
       SELECT m.subject_type, m.subject_id, m.subject_name,
              m.event_kind, m.event_text, m.streak_length,
              m.comparison_year, m.happened_on
         FROM gold_milestone_events m
         JOIN team_row t ON t.team_id = m.subject_id
        WHERE m.subject_type = 'team'
          AND CAST(m.happened_on AS DATE) >= current_date() - INTERVAL '7' DAY
     ),
     player_milestones AS (
       SELECT DISTINCT m.subject_type, m.subject_id, m.subject_name,
              m.event_kind, m.event_text, m.streak_length,
              m.comparison_year, m.happened_on
         FROM gold_milestone_events m
         JOIN silver_player_game_batting b
           ON b.player_id = m.subject_id
          AND CAST(b.game_date AS DATE) = CAST(m.happened_on AS DATE)
         JOIN team_row t ON t.team_id = b.team_id
        WHERE m.subject_type = 'player'
          AND CAST(m.happened_on AS DATE) >= current_date() - INTERVAL '7' DAY
     ),
     unioned AS (
       SELECT * FROM team_milestones
       UNION ALL
       SELECT * FROM player_milestones
     )
     SELECT subject_type, subject_id, subject_name, event_kind, event_text,
            streak_length, comparison_year, happened_on
       FROM unioned
      -- NULL comparison_year = rarest (no prior comp). COALESCE to a sentinel
      -- so it sorts smallest among ints; older prior_year next; recency last.
      ORDER BY COALESCE(comparison_year, -2147483648) ASC,
               happened_on DESC
      LIMIT 3`,
  );

  return {
    teamId: safeAbbrev,
    milestones: rows.map((r) => ({
      subjectType: r.subject_type,
      subjectId: String(r.subject_id),
      subjectName: r.subject_name,
      eventKind: r.event_kind,
      eventText: r.event_text,
      streakLength: r.streak_length,
      comparisonYear: r.comparison_year,
      happenedOn: r.happened_on,
    })),
  };
}

// ---- /api/player/:playerId -------------------------------------------------

interface PlayerSeasonRow {
  player_id: number;
  player_name: string;
  team_id: number;
  team_abbrev: string;
  position: string | null;
  avg: number | null;
  obp: number | null;
  slg: number | null;
  home_runs: number | null;
  rbi: number | null;
  era: number | null;
  innings_pitched: number | null;
  strikeouts_p: number | null;
}

interface PlayerGameLogRow {
  game_pk: number;
  game_date: string;
  log_type: 'batting' | 'pitching';
  team_abbrev: string;
  at_bats: number | null;
  hits: number | null;
  home_runs: number | null;
  rbi: number | null;
  walks: number | null;
  strikeouts: number | null;
  innings_pitched: number | null;
  earned_runs: number | null;
  pitching_strikeouts: number | null;
}

export async function getPlayerFromWarehouse(
  playerId: number,
  season: number
): Promise<PlayerResponse> {
  const [season_row] = await query<PlayerSeasonRow>(
    `SELECT ps.player_id, ps.player_name, ps.team_id, t.abbrev AS team_abbrev,
            NULL AS position,
            ps.avg, ps.obp, ps.slg, ps.home_runs, ps.rbi,
            ps.era, ps.innings_pitched, ps.strikeouts_p
       FROM silver_player_season ps
       LEFT JOIN silver_team t ON t.team_id = ps.team_id
      WHERE ps.season = ${season} AND ps.player_id = ${playerId}`
  );
  if (!season_row) {
    throw new Error(`Player not found: ${playerId} in season ${season}`);
  }

  const gameLogRows = await query<PlayerGameLogRow>(
    `SELECT game_pk, game_date, log_type, team_abbrev,
            at_bats, hits, home_runs, rbi, walks, strikeouts,
            innings_pitched, earned_runs, pitching_strikeouts
       FROM gold_player_game_log
      WHERE season = ${season} AND player_id = ${playerId}
      ORDER BY game_date`
  );

  // Cumulative HR or K per game_num
  let running = 0;
  const isPitcher = (season_row.innings_pitched ?? 0) > 20 && !season_row.avg;
  const cumulativeStat = isPitcher ? 'so' : 'hr';
  const cumulative = [
    {
      statKey: cumulativeStat,
      points: gameLogRows.map((g) => {
        running +=
          (isPitcher ? g.pitching_strikeouts : g.home_runs) ?? 0;
        return { date: g.game_date, value: running };
      }),
    },
  ];

  return {
    season,
    seasonLine: isPitcher
      ? {
          playerId: String(season_row.player_id),
          playerName: season_row.player_name,
          teamId: season_row.team_abbrev,
          position: 'P',
          era: season_row.era ?? undefined,
          so: season_row.strikeouts_p ?? undefined,
          ip: season_row.innings_pitched ?? undefined,
        }
      : {
          playerId: String(season_row.player_id),
          playerName: season_row.player_name,
          teamId: season_row.team_abbrev,
          position: 'OF',
          avg: season_row.avg ?? undefined,
          obp: season_row.obp ?? undefined,
          slg: season_row.slg ?? undefined,
          hr: season_row.home_runs ?? undefined,
          rbi: season_row.rbi ?? undefined,
        },
    gameLog: gameLogRows.map((g) => ({
      gameId: String(g.game_pk),
      date: g.game_date,
      opponentTeamId: g.team_abbrev, // TODO: compute actual opponent
      isHome: true, // TODO: compute
      line: {
        ab: g.at_bats,
        h: g.hits,
        hr: g.home_runs,
        rbi: g.rbi,
        bb: g.walks,
        so: g.strikeouts,
      },
    })),
    cumulative,
    statcast: {}, // TODO: wire in Baseball Savant enrichment once we add the ingest
  };
}

// ---- /api/news/recaps ------------------------------------------------------

interface RecapRow {
  game_pk: number;
  game_date: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_score: number;
  away_score: number;
  winner_team_id: number | null;
  winner_abbrev: string | null;
  headline: string;
  dateline: string;
  summary: string;
  upset_flag: boolean;
  winner_implied_win_prob: number | null;
  game_type: string | null;
  interest_score: number | null;
  recap_length: string | null;
  narrative_spine: string | null;
}

function rowToRecap(r: RecapRow): RecapItem {
  return {
    gameId: String(r.game_pk),
    date: r.game_date,
    homeTeamId: r.home_abbrev,
    awayTeamId: r.away_abbrev,
    homeScore: r.home_score,
    awayScore: r.away_score,
    winnerTeamId: r.winner_abbrev ?? r.home_abbrev,
    impliedWinProbOfWinner: r.winner_implied_win_prob ?? 0.5,
    upsetFlag: !!r.upset_flag,
    headline: r.headline,
    dateline: r.dateline,
    summary: r.summary,
    blurb: `${r.dateline}${r.summary}`,
    gameType: (r.game_type as GameType | null) ?? undefined,
    interestScore: r.interest_score ?? undefined,
    recapLength: (r.recap_length as 'short' | 'medium' | 'long' | null) ?? undefined,
    narrativeSpine: r.narrative_spine ?? undefined,
  };
}

const RECAP_SELECT = `
  SELECT g.game_pk, g.game_date,
         g.home_team_id, h.abbrev AS home_abbrev,
         g.away_team_id, a.abbrev AS away_abbrev,
         g.home_score, g.away_score, g.winner_team_id,
         w.abbrev AS winner_abbrev,
         r.headline, r.dateline, r.summary,
         r.upset_flag, r.winner_implied_win_prob,
         r.game_type, r.interest_score, r.recap_length, r.narrative_spine
    FROM gold_game_recap r
    JOIN silver_game g USING (game_pk)
    JOIN silver_team h ON h.team_id = g.home_team_id
    JOIN silver_team a ON a.team_id = g.away_team_id
    LEFT JOIN silver_team w ON w.team_id = g.winner_team_id
`;

export async function getRecapsFromWarehouse(date: string): Promise<RecapsResponse> {
  const safeDate = /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10);
  const rows = await query<RecapRow>(
    `${RECAP_SELECT}
     WHERE g.game_date = '${safeDate}'
     ORDER BY coalesce(r.interest_score, 0) DESC, g.game_pk`,
  );
  const recaps = rows.map(rowToRecap);
  await Promise.all([attachMilestones(recaps, rows), attachPlayers(recaps, rows)]);
  return { date: safeDate, recaps };
}

/** Multi-day recap fetch: returns the most-recent N calendar dates that
 *  have any recap rows. Within each date, games are sorted by interest_score
 *  desc so the upsets and walk-offs surface first. */
export async function getRecapsDaysFromWarehouse(days: number): Promise<RecapsResponse> {
  const n = Math.max(1, Math.min(30, Math.floor(days)));
  const rows = await query<RecapRow>(
    `${RECAP_SELECT}
     WHERE g.game_date IN (
       SELECT DISTINCT game_date
         FROM gold_game_recap
        ORDER BY game_date DESC
        LIMIT ${n}
     )
     ORDER BY g.game_date DESC, coalesce(r.interest_score, 0) DESC, g.game_pk`,
  );
  const allRecaps = rows.map(rowToRecap);
  await Promise.all([attachMilestones(allRecaps, rows), attachPlayers(allRecaps, rows)]);
  const byDate = new Map<string, RecapItem[]>();
  for (const r of allRecaps) {
    if (!byDate.has(r.date)) byDate.set(r.date, []);
    byDate.get(r.date)!.push(r);
  }
  return {
    recaps: allRecaps,
    days: Array.from(byDate.entries()).map(([date, recaps]) => ({ date, recaps })),
  };
}

// ---- milestone enrichment (FEAT-19) ---------------------------------------

interface RecapMilestoneRow {
  game_pk: number;
  subject_type: string;
  subject_id: number;
  subject_name: string;
  event_kind: string;
  event_text: string;
  streak_length: number | null;
  comparison_year: number | null;
  happened_on: string;
}

/** Attach DERIV-5 milestones to recap items in place. One round-trip:
 *  build a VALUES list of (game_pk, game_date, away_team_id, home_team_id)
 *  tuples from the recap rows, then INNER JOIN gold_milestone_events on
 *  (happened_on = game_date AND team_id IN (home, away)). For player
 *  subjects we resolve player→team via silver_player_game_batting on
 *  the same game_pk — restricting to batters who actually appeared in
 *  the game guarantees the milestone is attributed to one of the two
 *  teams playing.
 *
 *  Mirrors the abandoned attachTransactions pattern (FEAT-13 v1):
 *  one CTE-driven SQL, results mapped back onto recap items in JS.
 *
 *  Decorative — wrapped in try/catch. A failure here MUST NOT take
 *  down the recap response. */
async function attachMilestones(recaps: RecapItem[], rows: RecapRow[]): Promise<void> {
  if (recaps.length === 0) return;
  try {
    // Build the (game_pk, date, away_id, home_id) tuple list. Numeric ids
    // are coerced to int and date is whitelisted regex-style — both
    // come from our own DB, but we belt-and-suspenders here anyway.
    const tuples = rows
      .filter((r) => /^\d{4}-\d{2}-\d{2}$/.test(r.game_date))
      .map(
        (r) =>
          `(${Number(r.game_pk)}, DATE '${r.game_date}', ${Number(r.away_team_id)}, ${Number(r.home_team_id)})`,
      );
    if (tuples.length === 0) return;
    // recap_games CTE: one row per recap with both teams' int ids.
    // game_teams: unpivot to one row per (game, team) so milestones can
    //             attach symmetrically.
    // team_milestones: subject_type='team' joined on team_id.
    // player_milestones: subject_type='player' joined to
    //             silver_player_game_batting on (game_pk, player_id) so
    //             we only attribute a player milestone to the team
    //             whose roster actually batted that day.
    const sql = `
      WITH recap_games(game_pk, game_date, away_team_id, home_team_id) AS (
        VALUES ${tuples.join(', ')}
      ),
      game_teams AS (
        SELECT game_pk, game_date, away_team_id AS team_id FROM recap_games
        UNION ALL
        SELECT game_pk, game_date, home_team_id AS team_id FROM recap_games
      ),
      team_milestones AS (
        SELECT gt.game_pk,
               m.subject_type, m.subject_id, m.subject_name,
               m.event_kind, m.event_text,
               m.streak_length, m.comparison_year, m.happened_on
          FROM gold_milestone_events m
          JOIN game_teams gt
            ON gt.game_date = m.happened_on
           AND gt.team_id   = m.subject_id
         WHERE m.subject_type = 'team'
      ),
      player_milestones AS (
        SELECT gt.game_pk,
               m.subject_type, m.subject_id, m.subject_name,
               m.event_kind, m.event_text,
               m.streak_length, m.comparison_year, m.happened_on
          FROM gold_milestone_events m
          JOIN silver_player_game_batting b
            ON b.player_id = m.subject_id
          JOIN game_teams gt
            ON gt.game_pk = b.game_pk
           AND gt.team_id = b.team_id
           AND gt.game_date = m.happened_on
         WHERE m.subject_type = 'player'
      )
      SELECT * FROM team_milestones
      UNION ALL
      SELECT * FROM player_milestones
    `;
    const milestoneRows = await query<RecapMilestoneRow>(sql);
    if (milestoneRows.length === 0) return;
    // Group by game_pk; dedupe — a player who batted for both halves of
    // a doubleheader would otherwise show twice.
    const byGame = new Map<string, MilestoneEvent[]>();
    const seen = new Map<string, Set<string>>();
    for (const m of milestoneRows) {
      const key = String(m.game_pk);
      const dedupeKey = `${m.subject_type}|${m.subject_id}|${m.event_kind}|${m.happened_on}`;
      if (!seen.has(key)) seen.set(key, new Set());
      if (seen.get(key)!.has(dedupeKey)) continue;
      seen.get(key)!.add(dedupeKey);
      const list = byGame.get(key) ?? [];
      list.push({
        subjectType: m.subject_type === 'team' ? 'team' : 'player',
        subjectId: String(m.subject_id),
        subjectName: m.subject_name,
        // SQL row's event_kind is typed `string`; gold_milestone_events
        // only emits the three classifier values, so the cast is safe.
        eventKind: m.event_kind as MilestoneEvent['eventKind'],
        eventText: m.event_text,
        streakLength: m.streak_length ?? null,
        comparisonYear: m.comparison_year ?? null,
        happenedOn: m.happened_on,
      });
      byGame.set(key, list);
    }
    for (const r of recaps) {
      const list = byGame.get(r.gameId);
      if (list && list.length > 0) r.relevantMilestones = list;
    }
  } catch (err) {
    // Decorative enrichment must never take the recap response down.
    // Swallow + log; clients see no relevantMilestones field.
    console.warn('[attachMilestones] failed; recap response will omit milestones:', err);
  }
}

// ---- player enrichment (FEAT-12) ------------------------------------------

interface RecapPlayerRow {
  game_pk: number;
  player_id: number;
  player_name: string;
}

/** Attach a `playerName → playerId` map per recap from that game's box
 *  score. Drives FEAT-12 inline player hyperlinks on the client.
 *
 *  Source: `silver_player_game_batting` UNION `silver_player_game_pitching`
 *  for the recap row's `game_pk`s — covers both teams, batters and
 *  pitchers, in one round trip.
 *
 *  Decorative — wrapped in try/catch. A failure here MUST NOT take down
 *  the recap response. */
async function attachPlayers(recaps: RecapItem[], rows: RecapRow[]): Promise<void> {
  if (recaps.length === 0) return;
  try {
    const gamePks = Array.from(new Set(rows.map((r) => Number(r.game_pk))));
    if (gamePks.length === 0) return;
    const inList = gamePks.join(', ');
    const playerRows = await query<RecapPlayerRow>(
      `SELECT game_pk, player_id, player_name
         FROM silver_player_game_batting
        WHERE game_pk IN (${inList})
          AND player_name IS NOT NULL
        UNION
       SELECT game_pk, player_id, player_name
         FROM silver_player_game_pitching
        WHERE game_pk IN (${inList})
          AND player_name IS NOT NULL`,
    );
    if (playerRows.length === 0) return;
    // Build per-game maps. Same player_name on both teams within a game
    // would collide; last write wins for the map (the client's
    // recapRenderer falls back to plain text on its own ambiguity check
    // when two box-score entries share a last name).
    const byGame = new Map<string, Record<string, string>>();
    for (const p of playerRows) {
      const key = String(p.game_pk);
      if (!byGame.has(key)) byGame.set(key, {});
      byGame.get(key)![p.player_name] = String(p.player_id);
    }
    for (const r of recaps) {
      const map = byGame.get(r.gameId);
      if (map && Object.keys(map).length > 0) r.players = map;
    }
  } catch (err) {
    // Decorative enrichment must never take the recap response down.
    console.warn('[attachPlayers] failed; recap response will omit players:', err);
  }
}

// ---- /api/projections/today ------------------------------------------------

interface ProjectionRow {
  game_pk: number;
  game_date: string;
  /** First-pitch ISO timestamp (UTC), e.g. "2026-04-28T22:10:00Z".
   *  Null when MLB hasn't published a start time yet. */
  game_datetime: string | null;
  status: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_score: number | null;
  away_score: number | null;
  winner_team_id: number | null;
  home_probable_pitcher_id: number | null;
  away_probable_pitcher_id: number | null;
  home_probable_pitcher_name: string | null;
  away_probable_pitcher_name: string | null;
  home_win_prob: number | null;
}

/** "Today" in scoreboard terms — anchored to the user's wall-clock in
 *  Central Time. ET would roll over at 11 PM CT (midnight ET), hiding
 *  the late-CT games that just finished. Going one tz west lets the
 *  user keep tonight's slate visible until their own midnight. */
function todayCt(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function getProjectionsFromWarehouse(): Promise<ProjectionsResponse> {
  const today = todayCt();
  const rows = await query<ProjectionRow>(
    `SELECT g.game_pk, g.game_date,
            CAST(g.game_datetime AS STRING) AS game_datetime,
            g.status,
            g.home_team_id, h.abbrev AS home_abbrev,
            g.away_team_id, a.abbrev AS away_abbrev,
            g.home_score, g.away_score, g.winner_team_id,
            g.home_probable_pitcher_id, g.away_probable_pitcher_id,
            hp.player_name AS home_probable_pitcher_name,
            ap.player_name AS away_probable_pitcher_name,
            e.home_win_prob
       FROM silver_game g
       JOIN silver_team h ON h.team_id = g.home_team_id
       JOIN silver_team a ON a.team_id = g.away_team_id
       LEFT JOIN silver_player_season hp
         ON hp.player_id = g.home_probable_pitcher_id AND hp.season = g.season
       LEFT JOIN silver_player_season ap
         ON ap.player_id = g.away_probable_pitcher_id AND ap.season = g.season
       LEFT JOIN gold_game_elo e USING (game_pk)
      WHERE g.game_date = '${today}'
      ORDER BY g.game_pk`
  );
  return {
    date: today,
    games: rows.map((g) => ({
      gameId: String(g.game_pk),
      date: g.game_date,
      gameDateTime: g.game_datetime,
      homeTeamId: g.home_abbrev,
      awayTeamId: g.away_abbrev,
      probableHomePitcherId: g.home_probable_pitcher_id
        ? String(g.home_probable_pitcher_id)
        : null,
      probableAwayPitcherId: g.away_probable_pitcher_id
        ? String(g.away_probable_pitcher_id)
        : null,
      probableHomePitcherName: g.home_probable_pitcher_name,
      probableAwayPitcherName: g.away_probable_pitcher_name,
      impliedHomeWinProb: g.home_win_prob ?? 0.5,
      status: g.status,
      homeScore: g.home_score,
      awayScore: g.away_score,
      winnerTeamId:
        g.winner_team_id === null
          ? null
          : g.winner_team_id === g.home_team_id
            ? g.home_abbrev
            : g.away_abbrev,
    })),
  };
}

// ---- /api/game/:gamePk/summary --------------------------------------------

interface GameRow {
  game_pk: number;
  game_date: string;
  home_team_id: number;
  home_abbrev: string;
  home_color: string;
  home_score: number;
  away_team_id: number;
  away_abbrev: string;
  away_color: string;
  away_score: number;
}

interface PitcherDecisionRow {
  player_id: number;
  player_name: string;
  wins: number | null;
  losses: number | null;
}

interface BatterLineRow {
  player_id: number;
  player_name: string;
  at_bats: number | null;
  hits: number | null;
  doubles: number | null;
  triples: number | null;
  home_runs: number | null;
  rbi: number | null;
  total_bases: number | null;
}

/** Build a free-form batter line, e.g. "3-for-4, HR, 2 RBI". */
function formatBatterLine(row: BatterLineRow): string {
  const ab = row.at_bats ?? 0;
  const h = row.hits ?? 0;
  const bits: string[] = [`${h}-for-${ab}`];
  const hr = row.home_runs ?? 0;
  if (hr > 0) bits.push(hr === 1 ? 'HR' : `${hr} HR`);
  const tr = row.triples ?? 0;
  if (tr > 0) bits.push(tr === 1 ? '3B' : `${tr} 3B`);
  const db = row.doubles ?? 0;
  if (db > 0) bits.push(db === 1 ? '2B' : `${db} 2B`);
  const rbi = row.rbi ?? 0;
  if (rbi > 0) bits.push(`${rbi} RBI`);
  return bits.join(', ');
}

export async function getGameSummaryFromWarehouse(
  gamePk: number,
): Promise<GameSummaryResponse> {
  const [game] = await query<GameRow>(
    `SELECT g.game_pk, g.game_date,
            g.home_team_id, h.abbrev AS home_abbrev, h.primary_color AS home_color,
            g.home_score,
            g.away_team_id, a.abbrev AS away_abbrev, a.primary_color AS away_color,
            g.away_score
       FROM silver_game g
       JOIN silver_team h ON h.team_id = g.home_team_id
       JOIN silver_team a ON a.team_id = g.away_team_id
      WHERE g.game_pk = ${gamePk}
        AND g.status = 'Final'
      LIMIT 1`,
  );
  if (!game) {
    throw new Error(`Game not found or not final: gamePk=${gamePk}`);
  }

  const [decisions, batters] = await Promise.all([
    query<PitcherDecisionRow>(
      `SELECT player_id, player_name, wins, losses
         FROM silver_player_game_pitching
        WHERE game_pk = ${gamePk}
          AND (COALESCE(wins, 0) = 1 OR COALESCE(losses, 0) = 1)`,
    ),
    // Top performer = highest total_bases; if tied/null, fall back to most hits.
    query<BatterLineRow>(
      `SELECT player_id, player_name,
              at_bats, hits, doubles, triples, home_runs, rbi, total_bases
         FROM silver_player_game_batting
        WHERE game_pk = ${gamePk}
          AND COALESCE(at_bats, 0) > 0
        ORDER BY COALESCE(total_bases, 0) DESC,
                 COALESCE(hits, 0) DESC,
                 COALESCE(rbi, 0) DESC
        LIMIT 1`,
    ),
  ]);

  const win = decisions.find((d) => (d.wins ?? 0) === 1);
  const loss = decisions.find((d) => (d.losses ?? 0) === 1);
  const top = batters[0];

  return {
    gamePk: game.game_pk,
    gameDate: game.game_date,
    home: {
      abbrev: game.home_abbrev,
      score: game.home_score,
      color: game.home_color,
    },
    away: {
      abbrev: game.away_abbrev,
      score: game.away_score,
      color: game.away_color,
    },
    winningPitcher: win
      ? { id: String(win.player_id), name: win.player_name }
      : undefined,
    losingPitcher: loss
      ? { id: String(loss.player_id), name: loss.player_name }
      : undefined,
    topPerformer: top
      ? {
          id: String(top.player_id),
          name: top.player_name,
          line: formatBatterLine(top),
        }
      : undefined,
    boxScoreUrl: savantBoxScoreUrl(game.game_pk),
  };
}
