// FEAT-30 — Storylines block on the team page.
//
// Renders DERIV-11's `gold_team_storyline` paragraph (prompt v3) inside
// a `.card` frame styled to match TeamMilestones: 3px team-color left
// border, page-level primary-team tint inherited via
// --primary-team-accent-rgb, system-sans typography. The LLM-generated
// `title` takes the bold "headline" slot (where milestones bold the
// player name); the prose paragraph sits underneath as the body.
// Section h2 stays static at "Two-week summary" + an optional dim
// "· Apr 28" dateline when the LLM job hasn't refreshed today's row.
//
// Empty payload, error, or undefined data → render null (the section
// + card both disappear). Server-side already caps staleness at 3
// days; anything older comes back as an empty payload.

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { renderRecapText } from '../lib/recapRenderer';
import type { TeamStorylineResponse } from '@shared/types';

interface Props {
  teamId: string;
  /** The team's primary_color hex; drives the 3px left border. Mirrors
   *  TeamMilestones' teamColor prop so the two sections sit visually
   *  on the same accent edge. */
  teamColor: string;
}

/** Today as yyyy-mm-dd in UTC. We compare on the calendar-day grain
 *  only — picking a tz isn't worth the imprecision since the LLM job
 *  uses UTC dates and the dateline is a soft hint, not a stat. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/** "2026-04-28" → "Apr 28". Falls back to the raw string if parsing
 *  fails for any reason — better a slightly ugly dateline than a
 *  crash on a malformed date. */
function formatDateline(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  const months = [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ];
  const month = months[Number(m[2]) - 1] ?? '';
  const day = Number(m[3]);
  return month ? `${month} ${day}` : iso;
}

export function TeamStorylines({ teamId, teamColor }: Props) {
  const storylinesQ = useQuery<TeamStorylineResponse>({
    queryKey: ['team-storylines', teamId],
    queryFn: () =>
      apiGet<TeamStorylineResponse>(
        `/api/team/${encodeURIComponent(teamId)}/storylines`,
      ),
    staleTime: 5 * 60 * 1000,
  });

  // Hide silently on loading/error/empty. No "loading…" placeholder,
  // no error UI — the page reads cleaner when the section just isn't
  // there until the LLM job has prose to share.
  if (!storylinesQ.data || !storylinesQ.data.prose) {
    return null;
  }

  const { generatedForDate, title, prose, players } = storylinesQ.data;
  const isStale = !!generatedForDate && generatedForDate < todayUtc();
  const headlineText = title?.trim() || 'Two-week summary';

  return (
    <section>
      <h2 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>
        Two-week summary
        {isStale && (
          <span className="team-storylines-dateline">
            {' · '}
            {formatDateline(generatedForDate)}
          </span>
        )}
      </h2>
      <div
        className="card team-storylines"
        style={{ borderLeft: `3px solid ${teamColor}` }}
      >
        <div className="team-storylines-headline">{headlineText}</div>
        <p className="team-storylines-prose">{renderRecapText(prose, players)}</p>
      </div>
    </section>
  );
}
