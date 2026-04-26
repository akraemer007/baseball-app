import { type CSSProperties } from 'react';
import { NavLink } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { usePreferences } from '../lib/preferences';
import { apiGet } from '../lib/api';
import type { LeagueResponse } from '@shared/types';

export default function NavBar() {
  const { primaryTeam } = usePreferences();
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
    <nav className="navbar" style={navStyle}>
      <span className="navbar-brand">ak_baseball</span>
      <NavLink to="/" end className={({ isActive }) => (isActive ? 'active' : '')}>
        League
      </NavLink>
      <NavLink to={`/team/${primaryTeam}`} className={({ isActive }) => (isActive ? 'active' : '')}>
        Team
      </NavLink>
    </nav>
  );
}
