// Real SQL-backed implementations of each API route.
// Swap route handlers from `../mocks/data.js` to these once the Databricks
// backfill has populated the gold_* tables.
//
// NOTE: None of these are wired in yet — mocks are still in use.
//       Import and call from routes/ when ready.

import type {
  GameType,
  HrRaceResponse,
  LeagueResponse,
  PlayerResponse,
  ProjectionsResponse,
  RecapItem,
  RecapsResponse,
  StatDistributionResponse,
  TeamResponse,
} from '../../../shared/types.js';
import { query } from '../lib/warehouse.js';

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
  const threeDec = new Set(['avg', 'obp', 'slg', 'ops']);
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
}

// ---- /api/league/divisions -------------------------------------------------

export async function getLeagueFromWarehouse(season: number): Promise<LeagueResponse> {
  const rows = await query<DivisionTrajectoryRow>(
    `SELECT season, division, league, team_id, team_abbrev, team_name,
            primary_color, as_of_date, games_played, cum_wins, cum_losses, w_minus_l
       FROM gold_division_trajectory
      WHERE season = ${season}
      ORDER BY division, team_abbrev, games_played`
  );
  // Group into divisions → teams → trajectory points
  const divisions = new Map<string, { id: string; name: string; league: 'AL' | 'NL'; teams: Map<string, { id: string; abbrev: string; name: string; color: string }> }>();
  const trajectory = new Map<string, { teamId: string; points: { date: string; wMinusL: number; gamesPlayed: number }[] }>();
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

interface UpcomingGameRow {
  game_pk: number;
  game_date: string;
  home_team_id: number;
  home_abbrev: string;
  away_team_id: number;
  away_abbrev: string;
  home_probable_pitcher_id: number | null;
  away_probable_pitcher_id: number | null;
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

  const [percentiles, recent, upcoming, leaderRow, runDiffRow] = await Promise.all([
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
              e.home_win_prob
         FROM silver_game g
         JOIN silver_team h ON h.team_id = g.home_team_id
         JOIN silver_team a ON a.team_id = g.away_team_id
         LEFT JOIN gold_game_elo e USING (game_pk)
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
    recentGames: recent.map((g) => ({
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
    })),
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
      impliedHomeWinProb: g.home_win_prob ?? 0.5,
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
  return { date: safeDate, recaps: rows.map(rowToRecap) };
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

// ---- /api/projections/today ------------------------------------------------

interface ProjectionRow {
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

export async function getProjectionsFromWarehouse(): Promise<ProjectionsResponse> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = await query<ProjectionRow>(
    `SELECT g.game_pk, g.game_date,
            g.home_team_id, h.abbrev AS home_abbrev,
            g.away_team_id, a.abbrev AS away_abbrev,
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
        AND g.status != 'Final'
      ORDER BY g.game_pk`
  );
  return {
    date: today,
    games: rows.map((g) => ({
      gameId: String(g.game_pk),
      date: g.game_date,
      homeTeamId: g.home_abbrev,
      awayTeamId: g.away_abbrev,
      probableHomePitcherId:
        g.home_probable_pitcher_name ??
        (g.home_probable_pitcher_id ? String(g.home_probable_pitcher_id) : null),
      probableAwayPitcherId:
        g.away_probable_pitcher_name ??
        (g.away_probable_pitcher_id ? String(g.away_probable_pitcher_id) : null),
      impliedHomeWinProb: g.home_win_prob ?? 0.5,
    })),
  };
}
