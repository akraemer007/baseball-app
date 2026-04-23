// Shared types used by both the Express server and the React client.
// Keep this file dependency-free.

export type League = 'AL' | 'NL';

export interface Team {
  id: string;
  abbrev: string;
  name: string;
  color: string; // hex color for charting
}

export interface Division {
  id: string;
  name: string;
  league: League;
  teams: Team[];
}

export interface TrajectoryPoint {
  date: string; // ISO date (YYYY-MM-DD)
  wMinusL: number; // cumulative wins minus losses
  gamesPlayed: number;
}

export interface TeamTrajectory {
  teamId: string;
  points: TrajectoryPoint[];
}

export interface LeagueResponse {
  season: number;
  divisions: Division[];
  trajectory: TeamTrajectory[];
}

export interface TeamRecord {
  wins: number;
  losses: number;
  winPct: number;
  runDiff: number;
  /** Games behind the division leader (0 if this team IS the leader, else positive half-steps). */
  gamesBehind: number;
}

export interface TeamStreak {
  type: 'W' | 'L';
  length: number;
}

export interface PercentileStat {
  statKey: string;
  label: string;
  value: number;
  leagueRankPercentile: number; // 0-100
  category: 'batting' | 'pitching' | 'fielding' | 'overall';
  /** League-wide mean value for this stat (tied to what the median tick represents). */
  leagueMean?: number;
}

export interface GameSummary {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number | null;
  awayScore: number | null;
  isFinal: boolean;
  winnerTeamId: string | null;
}

export interface ScheduledGame {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  probableHomePitcherId: string | null;
  probableAwayPitcherId: string | null;
  impliedHomeWinProb: number; // 0-1
}

export interface TeamResponse {
  season: number;
  team: Team;
  record: TeamRecord;
  streak: TeamStreak;
  percentileStats: PercentileStat[];
  recentGames: GameSummary[];
  upcomingGames: ScheduledGame[];
}

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

export type GameType = 'walkoff' | 'comeback' | 'pitching_duel' | 'blowout' | 'standard';

export interface RecapItem {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  homeScore: number;
  awayScore: number;
  winnerTeamId: string;
  impliedWinProbOfWinner: number; // 0-1, pre-game
  upsetFlag: boolean;
  headline: string;
  /** Dateline prefix, e.g. "NEW YORK — " (includes trailing em-dash + space) */
  dateline: string;
  /** Body paragraph after the dateline. */
  summary: string;
  /** Legacy alias: dateline + summary concatenated (kept for the mock path). */
  blurb: string;
  /** Python-classified game shape (used to sort and label). */
  gameType?: GameType;
  /** 1-10 reader-interest score; higher sorts first within a date. */
  interestScore?: number;
  /** short | medium | long — matches the length the writer aimed for. */
  recapLength?: 'short' | 'medium' | 'long';
  /** One-sentence story the writer was asked to land. */
  narrativeSpine?: string;
}

export interface RecapsDayGroup {
  date: string;
  recaps: RecapItem[];
}

export interface RecapsResponse {
  /** Single-date mode returns this. */
  date?: string;
  /** Multi-day (?days=N) mode returns this. Groups are date-desc, recaps inside each are interest-desc. */
  days?: RecapsDayGroup[];
  recaps: RecapItem[];
}

export interface ProjectionsResponse {
  date: string;
  games: ScheduledGame[];
}

export interface HealthResponse {
  status: 'ok';
  version: string;
  uptimeSeconds: number;
}

export interface HrRaceEntry {
  playerId: string;
  playerName: string;
  teamId: string;
  teamColor: string;
  /** cumulative HR by game number */
  points: { gameNum: number; cumulativeHr: number }[];
  seasonHrTotal: number;
}

export interface HrRaceResponse {
  season: number;
  leaders: HrRaceEntry[];
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
