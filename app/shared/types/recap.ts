// Recap / news shared types: per-game recap items and day groups.
// Keep this file dependency-free.

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
