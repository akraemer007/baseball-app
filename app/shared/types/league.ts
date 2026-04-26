// League-wide shared types: teams, divisions, trajectories, HR race.
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
  /** game_pk of the game played on `date`. Optional because
   *  doubleheader edge cases or upstream join misses may leave it null;
   *  click-to-drawer just no-ops when missing. */
  gamePk?: number;
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

export interface GameSummaryResponse {
  gamePk: number;
  /** ISO date (YYYY-MM-DD). */
  gameDate: string;
  home: { abbrev: string; score: number; color: string };
  away: { abbrev: string; score: number; color: string };
  winningPitcher?: { id: string; name: string };
  losingPitcher?: { id: string; name: string };
  /** Game's standout batter — free-form line, e.g. "3-for-4, HR, 2 RBI". */
  topPerformer?: { id: string; name: string; line: string };
  /** Savant box-score URL for this gamePk. */
  boxScoreUrl: string;
}
