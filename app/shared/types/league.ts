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
