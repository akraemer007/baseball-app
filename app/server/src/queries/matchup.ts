// SQL-backed implementation of GET /api/matchup/:gamePk.
//
// Pulls together four pieces:
//   1. Probable-pitcher metadata + season ERA/K9 from silver_player_season,
//      keyed off silver_game.{home,away}_probable_pitcher_id.
//   2. Top 3 hitters per team this season (by AB), with last-10-game OPS
//      computed off silver_player_game_batting.
//   3. Head-to-head record between the two teams in the current season.
//   4. League-wide pitcher ERA / K9 distribution so the client can render
//      the spotlight pitcher's dot inside StatDistributionChart.
//
// LHP/RHP pitcher splits: silver_player_game_pitching does not currently
// carry batter handedness (no `bat_side` / `stand` column anywhere in the
// silver layer). We surface `splits = null` and the client omits the line.
// A future pipeline ticket lands handedness; this endpoint will fill in.

import type {
  MatchupH2H,
  MatchupHitter,
  MatchupPitcher,
  MatchupResponse,
  PitcherDistributionEntry,
  PitcherLeagueDistribution,
} from '../../../shared/types/index.js';
import { query } from '../lib/warehouse.js';

// ---- Eligibility cutoffs ---------------------------------------------------
// Match the conventions used in queries/index.ts so the spark plot's
// "qualifying pitcher" definition lines up with the per-team chart.
const PITCHER_IP_PER_GAME = 0.4;
const PITCHER_APPEARANCES_PER_GAME = 0.25;
const PITCHER_MIN_IP = 3;

// ---- Top-level entry point -------------------------------------------------

interface GameRow {
  game_pk: number;
  season: number;
  home_team_id: number;
  away_team_id: number;
  home_abbrev: string;
  away_abbrev: string;
  home_probable_pitcher_id: number | null;
  away_probable_pitcher_id: number | null;
}

export async function getMatchupFromWarehouse(gamePk: number): Promise<MatchupResponse> {
  const [game] = await query<GameRow>(
    `SELECT g.game_pk, g.season,
            g.home_team_id, g.away_team_id,
            h.abbrev AS home_abbrev,
            a.abbrev AS away_abbrev,
            g.home_probable_pitcher_id,
            g.away_probable_pitcher_id
       FROM silver_game g
       JOIN silver_team h ON h.team_id = g.home_team_id
       JOIN silver_team a ON a.team_id = g.away_team_id
      WHERE g.game_pk = ${gamePk}`
  );
  if (!game) {
    throw new Error(`Game not found: ${gamePk}`);
  }

  const [
    homePitcher,
    awayPitcher,
    homeHitters,
    awayHitters,
    h2h,
    eraDist,
    k9Dist,
    fipDist,
  ] = await Promise.all([
    getPitcher(game.home_probable_pitcher_id, game.season),
    getPitcher(game.away_probable_pitcher_id, game.season),
    getTopHitters(game.home_team_id, game.season),
    getTopHitters(game.away_team_id, game.season),
    getH2H(game.home_team_id, game.away_team_id, game.season),
    getPitcherLeagueDistribution(game.season, 'era'),
    getPitcherLeagueDistribution(game.season, 'k_per_9'),
    getPitcherLeagueDistribution(game.season, 'fip'),
  ]);

  return {
    gameId: String(game.game_pk),
    homeTeamId: game.home_abbrev,
    awayTeamId: game.away_abbrev,
    pitcher: { home: homePitcher, away: awayPitcher },
    topHitters: { home: homeHitters, away: awayHitters },
    h2hRecord: h2h,
    pitcherLeague: { era: eraDist, k9: k9Dist, fip: fipDist },
  };
}

// ---- Pitcher --------------------------------------------------------------

interface PitcherRow {
  player_id: number;
  player_name: string;
  innings_pitched: number | null;
  earned_runs: number | null;
  strikeouts_p: number | null;
  walks_p: number | null;
  home_runs_allowed: number | null;
  era: number | null;
}

/** Fielding-Independent Pitching constant — same approximation the team
 *  page uses (queries/index.ts). Keeps absolute values comparable across
 *  surfaces without a real per-season league constant. */
const FIP_CONSTANT = 3.10;

async function getPitcher(
  pitcherId: number | null,
  season: number,
): Promise<MatchupPitcher | null> {
  if (pitcherId == null) return null;
  const [row] = await query<PitcherRow>(
    `SELECT player_id, player_name, innings_pitched, earned_runs,
            strikeouts_p, walks_p, home_runs_allowed, era
       FROM silver_player_season
      WHERE season = ${season} AND player_id = ${pitcherId}`
  );
  if (!row) return null;
  const ip = row.innings_pitched ?? 0;
  const k9 = ip > 0 && row.strikeouts_p != null
    ? Number(((row.strikeouts_p * 9) / ip).toFixed(2))
    : null;
  const era = row.era != null ? Number(row.era.toFixed(2)) : null;
  // FIP = (13*HR + 3*BB - 2*K) / IP + constant
  const fip =
    ip > 0 &&
    row.home_runs_allowed != null &&
    row.walks_p != null &&
    row.strikeouts_p != null
      ? Number(
          (
            (13 * row.home_runs_allowed + 3 * row.walks_p - 2 * row.strikeouts_p) /
              ip +
            FIP_CONSTANT
          ).toFixed(2),
        )
      : null;
  return {
    id: String(row.player_id),
    name: row.player_name,
    era,
    k9,
    fip,
    // Handedness data not yet in silver — see file header.
    splits: null,
  };
}

// ---- Top hitters ----------------------------------------------------------

interface TopHitterRow {
  player_id: number;
  player_name: string;
  at_bats: number;
}

interface Last10Row {
  player_id: number;
  ab_total: number;
  hits_total: number;
  walks_total: number;
  total_bases: number;
  games: number;
}

async function getTopHitters(
  teamId: number,
  season: number,
): Promise<MatchupHitter[]> {
  // Top 3 hitters by season AB. Note: we only need their ids/names here;
  // last-10 OPS is computed in a separate pass to keep the SQL grain clean.
  const top = await query<TopHitterRow>(
    `SELECT player_id, player_name, at_bats
       FROM silver_player_season
      WHERE season = ${season}
        AND team_id = ${teamId}
        AND at_bats IS NOT NULL
        AND at_bats > 0
      ORDER BY at_bats DESC
      LIMIT 3`
  );
  if (top.length === 0) return [];

  const idList = top.map((r) => r.player_id).join(',');
  // Last-10 game-batting rollup per player. We let SQL pick each player's
  // own most-recent 10 games; OPS approximated as OBP + SLG over those games.
  // Walks/AB/Hits/TotalBases are summed; SLG = TB/AB, OBP = (H+BB)/(AB+BB).
  const last10 = await query<Last10Row>(
    `WITH ranked AS (
       SELECT b.player_id, b.game_date,
              b.at_bats, b.hits, b.walks, b.total_bases,
              ROW_NUMBER() OVER (
                PARTITION BY b.player_id ORDER BY b.game_date DESC
              ) AS rn
         FROM silver_player_game_batting b
         JOIN silver_game g USING (game_pk)
        WHERE g.season = ${season}
          AND g.status = 'Final'
          AND g.game_type = 'R'
          AND b.player_id IN (${idList})
     )
     SELECT player_id,
            SUM(at_bats)     AS ab_total,
            SUM(hits)        AS hits_total,
            SUM(walks)       AS walks_total,
            SUM(total_bases) AS total_bases,
            COUNT(*)         AS games
       FROM ranked
      WHERE rn <= 10
      GROUP BY player_id`
  );
  const last10ByPid = new Map<number, Last10Row>();
  for (const r of last10) last10ByPid.set(r.player_id, r);

  return top.map((h) => {
    const r = last10ByPid.get(h.player_id);
    if (!r || r.games < 10 || r.ab_total <= 0) {
      return {
        id: String(h.player_id),
        name: h.player_name,
        last10Avg: null,
        last10Obp: null,
        last10Slg: null,
        last10Ops: null,
        gamesUsed: r?.games ?? 0,
      };
    }
    const obpDenom = r.ab_total + r.walks_total;
    const avg = r.ab_total > 0 ? r.hits_total / r.ab_total : 0;
    const obp = obpDenom > 0 ? (r.hits_total + r.walks_total) / obpDenom : 0;
    const slg = r.ab_total > 0 ? r.total_bases / r.ab_total : 0;
    return {
      id: String(h.player_id),
      name: h.player_name,
      last10Avg: Number(avg.toFixed(3)),
      last10Obp: Number(obp.toFixed(3)),
      last10Slg: Number(slg.toFixed(3)),
      last10Ops: Number((obp + slg).toFixed(3)),
      gamesUsed: r.games,
    };
  });
}

// ---- H2H ------------------------------------------------------------------

interface H2HRow {
  game_date: string;
  home_team_id: number;
  away_team_id: number;
  winner_team_id: number | null;
}

async function getH2H(
  homeTeamId: number,
  awayTeamId: number,
  season: number,
): Promise<MatchupH2H> {
  const rows = await query<H2HRow>(
    `SELECT game_date, home_team_id, away_team_id, winner_team_id
       FROM silver_game
      WHERE season = ${season}
        AND status = 'Final'
        AND game_type = 'R'
        AND ((home_team_id = ${homeTeamId} AND away_team_id = ${awayTeamId})
          OR (home_team_id = ${awayTeamId} AND away_team_id = ${homeTeamId}))
      ORDER BY game_date DESC`
  );
  let homeWins = 0;
  let awayWins = 0;
  for (const r of rows) {
    if (r.winner_team_id == null) continue;
    if (r.winner_team_id === homeTeamId) homeWins++;
    else if (r.winner_team_id === awayTeamId) awayWins++;
  }
  return {
    homeWins,
    awayWins,
    lastGameDate: rows[0]?.game_date ?? null,
  };
}

// ---- Pitcher league distribution -------------------------------------------
// One entry per qualifying pitcher in the league. Same eligibility rule as
// the per-team pitcher chart in queries/index.ts so the spark stays
// internally consistent.

interface PitcherLeagueRow {
  player_id: number;
  player_name: string;
  team_abbrev: string;
  primary_color: string;
  value: number;
}

async function getPitcherLeagueDistribution(
  season: number,
  metric: 'era' | 'k_per_9' | 'fip',
): Promise<PitcherLeagueDistribution> {
  const valueExpr =
    metric === 'era'
      ? 'p.era'
      : metric === 'k_per_9'
        ? '(p.strikeouts_p * 9.0 / NULLIF(p.innings_pitched, 0))'
        : `((13.0 * p.home_runs_allowed + 3.0 * p.walks_p - 2.0 * p.strikeouts_p) / NULLIF(p.innings_pitched, 0) + ${FIP_CONSTANT})`;
  const lowerIsBetter = metric === 'era' || metric === 'fip';
  const orderDir = lowerIsBetter ? 'ASC' : 'DESC';
  const statLabel =
    metric === 'era' ? 'ERA' : metric === 'k_per_9' ? 'K/9' : 'FIP';

  // Use the league's median games-played as the eligibility scale so a single
  // team having a rain-out doesn't tilt thresholds. Reasonable approximation.
  const rows = await query<PitcherLeagueRow>(
    `WITH team_games AS (
       SELECT tg.team_id, COUNT(DISTINCT tg.game_pk) AS games
         FROM silver_team_game tg
         JOIN silver_game g USING (game_pk)
        WHERE g.season = ${season}
          AND g.status = 'Final'
          AND g.game_type = 'R'
        GROUP BY tg.team_id
     ),
     median_games AS (
       SELECT AVG(games) AS games FROM team_games
     )
     SELECT p.player_id,
            p.player_name,
            t.abbrev AS team_abbrev,
            t.primary_color,
            ${valueExpr} AS value
       FROM silver_player_season p
       JOIN silver_team t ON t.team_id = p.team_id
      WHERE p.season = ${season}
        AND p.innings_pitched IS NOT NULL
        AND p.innings_pitched >= ${PITCHER_MIN_IP}
        AND (
          p.innings_pitched >= ${PITCHER_IP_PER_GAME} * (SELECT games FROM median_games)
          OR p.pitching_games >= ${PITCHER_APPEARANCES_PER_GAME} * (SELECT games FROM median_games)
        )
        AND (${valueExpr}) IS NOT NULL
      ORDER BY value ${orderDir}`
  );

  const entries: PitcherDistributionEntry[] = rows.map((r, i) => ({
    pitcherId: String(r.player_id),
    pitcherName: r.player_name,
    teamAbbrev: r.team_abbrev,
    teamColor: r.primary_color,
    value: Number(r.value.toFixed(2)),
    rank: i + 1,
  }));
  const leagueMean = entries.length === 0
    ? 0
    : Number(
        (entries.reduce((s, e) => s + e.value, 0) / entries.length).toFixed(2),
      );
  return {
    statKey: metric,
    statLabel,
    lowerIsBetter,
    leagueMean,
    entries,
  };
}
