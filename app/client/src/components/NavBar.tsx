import { useState, type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePreferences } from '../lib/preferences';
import { apiGet } from '../lib/api';
import type { LeagueResponse } from '@shared/types';
import HelpOverlay from './HelpOverlay';

export default function NavBar() {
  const { primaryTeam } = usePreferences();
  // Help overlay state lives in NavBar — only the help button toggles it,
  // so a context would be overkill. ESC + background click also dismiss.
  const [helpOpen, setHelpOpen] = useState(false);

  // Reuse the page-level league query (same key) to look up the primary
  // team's color so the active-link underline can match. This is shared
  // cache with TeamPage / LeaguePage, so no extra round-trip.
  const season = new Date().getUTCFullYear();
  const leagueQ = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
    staleTime: 5 * 60 * 1000,
  });

  const primaryColor = (() => {
    if (!leagueQ.data) return undefined;
    for (const d of leagueQ.data.divisions) {
      const hit = d.teams.find((t) => t.id.toUpperCase() === primaryTeam.toUpperCase());
      if (hit) return hit.color;
    }
    return undefined;
  })();

  const navStyle: CSSProperties | undefined = primaryColor
    ? { ['--primary-team-accent' as string]: primaryColor }
    : undefined;

  return (
    <>
      <nav className="navbar" style={navStyle}>
        <span className="navbar-brand">ak_baseball</span>
        <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
          League
        </NavLink>
        <NavLink to={`/team/${primaryTeam}`} className={({ isActive }) => (isActive ? 'active' : '')}>
          Team
        </NavLink>
        <button
          type="button"
          className={`navbar-help${helpOpen ? ' is-active' : ''}`}
          aria-label={helpOpen ? 'Close help overlay' : 'Open help overlay'}
          aria-pressed={helpOpen}
          onClick={() => setHelpOpen((v) => !v)}
        >
          ?
        </button>
      </nav>
      {helpOpen && <HelpOverlay onClose={() => setHelpOpen(false)} />}
    </>
  );
}
