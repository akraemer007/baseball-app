// FEAT-30 — Storylines block on the team page.
//
// Renders DERIV-11's `gold_team_storyline` bullets as a quiet
// serif-italic section: no card border, no heading, no icon, no
// loading ghost, no error UI. The voice is the signal; the chrome
// stays out of the way. Sits between the trajectory chart and the
// percentile / stat-card region in TeamPage.
//
// Empty payload, error, or undefined data → render null (the section
// disappears). When `generatedForDate` is older than today, prepend a
// small dim "Apr 28 ·" dateline on the first bullet so the reader
// knows the take isn't fresh. Server-side already caps staleness at 3
// days; anything older than that comes back as an empty payload.

import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import type { TeamStorylineResponse } from '@shared/types';

interface Props {
  teamId: string;
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

export function TeamStorylines({ teamId }: Props) {
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
  // there until the LLM job has bullets to share.
  if (!storylinesQ.data || storylinesQ.data.bullets.length === 0) {
    return null;
  }

  const { generatedForDate, bullets } = storylinesQ.data;
  const isStale = !!generatedForDate && generatedForDate < todayUtc();

  return (
    <div className="team-storylines">
      {bullets.map((b, i) => (
        <p key={i}>
          {isStale && i === 0 && (
            <span className="dateline">{formatDateline(generatedForDate)} · </span>
          )}
          {b.text}
        </p>
      ))}
    </div>
  );
}
