// Player-page shared types: season line, game log, statcast tiles, and the
// league-wide stat distribution charts rendered on a player/team context.
// Keep this file dependency-free.

export interface PlayerSeasonLine {
  playerId: string;
  playerName: string;
  teamId: string;
  position: string;
  // A few canonical stats; real impl will flesh this out per position.
  avg?: number;
  obp?: number;
  slg?: number;
  ops?: number;
  hr?: number;
  rbi?: number;
  sb?: number;
  era?: number;
  whip?: number;
  so?: number;
  ip?: number;
}

export interface PlayerGameLogRow {
  gameId: string;
  date: string;
  opponentTeamId: string;
  isHome: boolean;
  line: Record<string, number | string | null>;
}

export interface CumulativePoint {
  date: string;
  value: number;
}

export interface StatcastTile {
  exitVeloAvg?: number;
  exitVeloMax?: number;
  barrelPct?: number;
  hardHitPct?: number;
  chasePct?: number;
  whiffPct?: number;
  sprintSpeed?: number;
  // Pitcher-side
  fastballVeloAvg?: number;
  spinRate?: number;
}

export interface PlayerResponse {
  season: number;
  seasonLine: PlayerSeasonLine;
  gameLog: PlayerGameLogRow[];
  cumulative: {
    statKey: string;
    points: CumulativePoint[];
  }[];
  statcast: StatcastTile;
}

export interface StatDistributionEntry {
  teamAbbrev: string;
  teamName: string;
  teamColor: string;
  value: number;
  rank: number;
}

export interface StatDistributionResponse {
  season: number;
  statName: string;
  statLabel: string;
  /** true when lower values are better (ERA, FIP, errors/game, etc.) */
  lowerIsBetter: boolean;
  leagueMean: number;
  entries: StatDistributionEntry[];
}

export interface TeamPlayerDistributionEntry {
  /** MLBAM player id — for linking to Savant. */
  playerId: string;
  playerName: string;
  /** The stat's value for this player on their own scale
   *  (e.g. individual AVG for a hitter, individual HR count for a total). */
  value: number;
  /** Supplementary context: AB for hitters, IP (decimal) for pitchers. */
  playingTime: number;
}

export interface TeamPlayerDistributionResponse {
  season: number;
  teamAbbrev: string;
  statName: string;
  statLabel: string;
  /** Same orientation rule as the team chart. */
  lowerIsBetter: boolean;
  /** Reference line — the team's aggregate value for this stat, shown
   *  as a vertical tick so the user can see who's above/below team avg. */
  teamValue: number;
  /** "hitter" or "pitcher" — drives the eligibility label (AB vs IP). */
  side: 'hitter' | 'pitcher';
  entries: TeamPlayerDistributionEntry[];
}
