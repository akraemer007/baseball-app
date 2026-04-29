// Team-page shared types: record, streak, percentile stats, game summaries.
// Keep this file dependency-free beyond intra-types imports.

import type { Team } from './league';

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
  category: 'batting' | 'pitching' | 'fielding';
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
  /** Our team's top performer that game. Rendered as "<lastName> <statLine>";
   *  the client links the name to a Savant player page using playerId. */
  topPerformer?: {
    playerId: string;
    playerName: string;
    statLine: string;
  };
}

export interface ScheduledGame {
  gameId: string;
  date: string;
  homeTeamId: string;
  awayTeamId: string;
  /** MLBAM player id for the probable starter — for linking to Savant. */
  probableHomePitcherId: string | null;
  probableAwayPitcherId: string | null;
  /** Display name, joined from silver_player_season. Falls back to null
   *  when the game doesn't have a confirmed probable yet. */
  probableHomePitcherName: string | null;
  probableAwayPitcherName: string | null;
  impliedHomeWinProb: number; // 0-1
  /** silver_game.status. "Final" means the score is settled; anything
   *  else (Scheduled, Pre-Game, In Progress, Delayed, Postponed) is still
   *  treated as a pre-game projection in the UI. */
  status?: string;
  /** Populated when status === 'Final'; null/undefined otherwise. */
  homeScore?: number | null;
  awayScore?: number | null;
  /** Abbrev of the winning team when Final; null otherwise. */
  winnerTeamId?: string | null;
}

export interface TeamResponse {
  season: number;
  team: Team;
  record: TeamRecord;
  streak: TeamStreak;
  /** Pythagorean expected record from this season's RS / RA. */
  expectedRecord: { wins: number; losses: number };
  percentileStats: PercentileStat[];
  recentGames: GameSummary[];
  upcomingGames: ScheduledGame[];
}

/**
 * One milestone callout sourced from `gold_milestone_events` (DERIV-5).
 * Intentionally a light rename of the gold row — both the team page
 * (FEAT-8) and the recap response shape (FEAT-19) consume the same
 * structure, so the type lives here under the team domain.
 *
 * `eventText` is rendered as plain prose; for `subjectType === 'player'`
 * the client splices the `subjectName` substring inside an <a> tag
 * pointing at Savant via `playerId`. `comparisonYear` is the year of
 * the prior comparable peak ("longest streak since YYYY"); NULL means
 * this is the first such event in the recorded window (rarest).
 */
export interface MilestoneEvent {
  subjectType: 'team' | 'player';
  /** team_id for team rows, player_id for player rows. Stringified so
   *  the client can drop it directly into URLs / link hrefs. */
  subjectId: string;
  subjectName: string;
  /** Maps 1:1 with the three classifiers in build_gold.sql. */
  eventKind:
    | 'team_winning_streak'
    | 'player_hitting_streak'
    | 'player_multi_hr_game';
  /** Pre-rendered narrative text from gold. Includes the subject name. */
  eventText: string;
  /** Streak length for streak events; null for multi-HR games. */
  streakLength: number | null;
  /** Year of the prior comparable peak; null = rarest (no prior found). */
  comparisonYear: number | null;
  /** YYYY-MM-DD the milestone happened on. */
  happenedOn: string;
}

export interface TeamMilestonesResponse {
  teamId: string;
  /** Up to 3 events, sorted by rarity then recency. Empty array → caller
   *  should hide the section entirely (no "no milestones" placeholder). */
  milestones: MilestoneEvent[];
}
