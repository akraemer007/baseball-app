// FEAT-8 — Milestone callouts on the team page.
//
// Renders up to 3 cards from gold_milestone_events, one card per
// milestone. The section hides itself entirely on empty / errored
// responses (no "no milestones" placeholder), since not every team
// has one in any given week.
//
// Each card is two lines: the subject name (bold, links to Savant for
// player events), then a one-line descriptor built from structured
// MilestoneEvent fields (NOT a substring of DERIV-5's event_text). A
// pill on the right shows the count-based summary ("23-game streak",
// "2 HR game"). Pastel pill colors match the recap-card chip family.

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { savantPlayerUrl } from '../lib/savant';
import type {
  MilestoneEvent,
  TeamMilestonesResponse,
} from '@shared/types';

interface Props {
  teamId: string;
  /** The team's primary_color hex; drives the 3px left border on each
   *  card. Passed in so we don't refetch the team payload here. */
  teamColor: string;
}

const PILL_CLASS_BY_KIND: Record<MilestoneEvent['eventKind'], string> = {
  team_winning_streak: 'milestone-team-streak',
  player_hitting_streak: 'milestone-hit-streak',
  player_multi_hr_game: 'milestone-multi-hr',
};

export function TeamMilestones({ teamId, teamColor }: Props) {
  const milestonesQ = useQuery<TeamMilestonesResponse>({
    queryKey: ['team-milestones', teamId],
    queryFn: () =>
      apiGet<TeamMilestonesResponse>(
        `/api/team/${encodeURIComponent(teamId)}/milestones`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  // Hide silently on loading/error/empty — the page reads cleaner when
  // weeks without milestones don't leave a stub header behind.
  if (!milestonesQ.data || milestonesQ.data.milestones.length === 0) {
    return null;
  }

  return (
    <section>
      <h2 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Milestones
      </h2>
      <div className="milestone-list">
        {milestonesQ.data.milestones.map((m, i) => (
          <div
            key={`${m.subjectType}-${m.subjectId}-${m.happenedOn}-${i}`}
            className="card milestone-item"
            style={{ borderLeftColor: teamColor }}
          >
            <div className="milestone-content">
              <div className="milestone-headline">
                {m.subjectType === 'player' ? (
                  <a
                    className="milestone-player-link"
                    href={savantPlayerUrl(m.subjectId)}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {m.subjectName}
                  </a>
                ) : (
                  m.subjectName
                )}
              </div>
              <div className="milestone-body">{bodyText(m)}</div>
            </div>
            <span
              className={`pill milestone-pill ${PILL_CLASS_BY_KIND[m.eventKind]}`}
            >
              {pillLabel(m)}
            </span>
          </div>
        ))}
      </div>
    </section>
  );
}

/** Short, count-based summary that goes inside the pill. */
function pillLabel(m: MilestoneEvent): string {
  switch (m.eventKind) {
    case 'team_winning_streak':
    case 'player_hitting_streak':
      return `${m.streakLength}-game streak`;
    case 'player_multi_hr_game': {
      // streakLength is null for multi-HR; pull the HR count out of
      // event_text where DERIV-5 wrote "hit N HR in one game".
      const match = /hit (\d+) HR/.exec(m.eventText);
      const n = match ? match[1] : '2';
      return `${n} HR game`;
    }
  }
}

/** Single-line descriptor under the headline. Built from structured
 *  fields so we don't have to slice DERIV-5's longer prose. */
function bodyText(m: MilestoneEvent): string {
  const cy = m.comparisonYear;
  switch (m.eventKind) {
    case 'team_winning_streak': {
      const lead = `Won ${m.streakLength} in a row`;
      if (cy === null) return `${lead} — first ${m.streakLength}+ game streak since 2020`;
      if (cy === 2020) return `${lead} — longest streak since 2020 (short season)`;
      return `${lead} — longest streak since ${cy}`;
    }
    case 'player_hitting_streak': {
      const lead = `Hit streak extended to ${m.streakLength} games`;
      if (cy === null) return `${lead} — career first (since 2020)`;
      if (cy === 2020) return `${lead} — longest streak since 2020 (short season)`;
      return `${lead} — longest streak since ${cy}`;
    }
    case 'player_multi_hr_game': {
      const match = /hit (\d+) HR/.exec(m.eventText);
      const n = match ? match[1] : '2';
      const lead = `${n} HR in one game`;
      if (cy === null) return `${lead} — first multi-HR game of career (since 2020)`;
      if (cy === 2020) return `${lead} — first multi-HR game since 2020 (short season)`;
      return `${lead} — first multi-HR game since ${cy}`;
    }
  }
}
