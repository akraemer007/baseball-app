// Recap / news shared types: per-game recap items and day groups.
// Keep this file dependency-free.

export type GameType = 'walkoff' | 'comeback' | 'pitching_duel' | 'blowout' | 'standard';

/** A DERIV-5 milestone event (gold_milestone_events). Decorative narrative
 *  context surfaced on both the team page (FEAT-8) and recap cards (FEAT-19).
 *  Owned here because recaps were the first surface to attach it; FEAT-8
 *  re-uses the same shape from `@shared/types`. */
export interface MilestoneEvent {
  /** `team` for team-level events (winning streaks); `player` otherwise. */
  subjectType: 'team' | 'player';
  /** team_id for team subjects, player_id (MLBAM) for player subjects. */
  subjectId: string;
  subjectName: string;
  eventKind:
    | 'team_winning_streak'
    | 'player_hitting_streak'
    | 'player_multi_hr_game'
    | (string & {});
  /** Pre-rendered narrative sentence. Player names are plain text — the
   *  client wraps the player name in a Savant link via string replace. */
  eventText: string;
  /** Streak length for streak events; null for multi-HR games. */
  streakLength: number | null;
  /** Year of the prior comparison event, or null when this is a "first since
   *  records began" rarity (rarest = sorts first on the team-page strip). */
  comparisonYear: number | null;
  /** ISO date the event happened on. */
  happenedOn: string;
}

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
  /** DERIV-5 milestones tied to this game's date and either team. Decorative,
   *  rendered inline above the prose. Empty/undefined when the lookup
   *  fails or no milestone fired — the recap MUST still render either way. */
  relevantMilestones?: MilestoneEvent[];
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
