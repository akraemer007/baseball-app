// Projection shared types: pre-game schedule projections.

import type { ScheduledGame } from './team';

export interface ProjectionsResponse {
  date: string;
  games: ScheduledGame[];
}

// ---- Matchup preview (FEAT-1) ---------------------------------------------

/** League-wide distribution of one pitcher metric (ERA, K/9, or FIP). One
 *  entry per qualifying pitcher in the league. The spotlight pitcher is
 *  identified by pitcherId so the client can highlight that dot. */
export interface PitcherLeagueDistribution {
  /** The metric being plotted. */
  statKey: 'era' | 'k_per_9' | 'fip';
  statLabel: string;
  /** Lower-is-better drives the chart's axis flip (true for ERA + FIP, false for K/9). */
  lowerIsBetter: boolean;
  /** Mean of value across entries — drawn as the league reference tick. */
  leagueMean: number;
  /** One entry per qualifying pitcher, sorted by rank. */
  entries: PitcherDistributionEntry[];
}

export interface PitcherDistributionEntry {
  pitcherId: string;
  pitcherName: string;
  teamAbbrev: string;
  teamColor: string;
  value: number;
  rank: number;
}

export interface MatchupPitcherSplit {
  /** ERA vs LHB. Null when handedness data isn't available cleanly. */
  vsLhpEra: number | null;
  vsRhpEra: number | null;
}

export interface MatchupPitcher {
  id: string;
  name: string;
  era: number | null;
  k9: number | null;
  /** Fielding-Independent Pitching: (13*HR + 3*BB - 2*K)/IP + 3.10. Lower
   *  is better — same convention as ERA. Null when IP = 0. */
  fip: number | null;
  /** Reads "split" because the value is computed against opposing-batter
   *  handedness. Null when silver doesn't carry batter handedness yet. */
  splits: MatchupPitcherSplit | null;
}

/** Top hitter for the matchup panel. The L10 slashline (avg/obp/slg/ops)
 *  is computed over each player's most recent 10 regular-season games.
 *  All four are null when the player has fewer than 10 games — caller
 *  should fall back to "<gamesUsed>/10 G" placeholder. */
export interface MatchupHitter {
  id: string;
  name: string;
  /** Last-10-game AVG (hits / AB). */
  last10Avg: number | null;
  /** Last-10-game OBP — (H + BB) / (AB + BB). HBP/SF excluded. */
  last10Obp: number | null;
  /** Last-10-game SLG — total bases / AB. */
  last10Slg: number | null;
  /** Last-10-game OPS — convenience sum of the above. Used to sort the table. */
  last10Ops: number | null;
  /** Number of games used in the rollup (≤10). */
  gamesUsed: number;
}

export interface MatchupH2H {
  homeWins: number;
  awayWins: number;
  /** ISO date of the last completed meeting this season; null if none yet. */
  lastGameDate: string | null;
}

/** GET /api/matchup/:gamePk response. */
export interface MatchupResponse {
  gameId: string;
  homeTeamId: string;
  awayTeamId: string;
  pitcher: {
    home: MatchupPitcher | null;
    away: MatchupPitcher | null;
  };
  topHitters: {
    home: MatchupHitter[];
    away: MatchupHitter[];
  };
  h2hRecord: MatchupH2H;
  /** League-wide distributions for the three pitcher spark plots, populated
   *  with the same shape regardless of which pitcher the panel is for. */
  pitcherLeague: {
    era: PitcherLeagueDistribution;
    k9: PitcherLeagueDistribution;
    fip: PitcherLeagueDistribution;
  };
}
