import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { LeagueResponse } from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';

export default function LeaguePage() {
  const season = new Date().getUTCFullYear();
  const [highlight, setHighlight] = useState<string | null>('CHC');
  const { data, isLoading, error } = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const divisions = useMemo(() => data?.divisions ?? [], [data]);
  const trajectories = useMemo(() => data?.trajectory ?? [], [data]);

  return (
    <div className="page">
      <h1>Hello, Cubs fan</h1>
      <p className="muted">
        The view from every dugout, <span className="mono">{season}</span> season.
        Lines show wins minus losses by game; the shaded band spans each division's
        leader and last place.
      </p>

      {isLoading && <p className="muted">Loading divisions…</p>}
      {error && <p className="muted">Failed to load league data.</p>}

      {data && (
        <>
          <div className="grid grid-3 division-grid">
            {divisions.map((div) => (
              <div key={div.id} className="card division-card">
                <div className="division-header">
                  <h3>{div.name}</h3>
                  <div className="team-chips">
                    {div.teams.map((t) => (
                      <Link
                        key={t.id}
                        to={`/team/${t.id}`}
                        className={`team-chip ${highlight === t.id ? 'active' : ''}`}
                        onMouseEnter={() => setHighlight(t.id)}
                        onMouseLeave={() => setHighlight('CHC')}
                        style={{ borderColor: t.color }}
                      >
                        <span className="team-chip-dot" style={{ background: t.color }} />
                        {t.abbrev}
                      </Link>
                    ))}
                  </div>
                </div>
                <DivisionTrajectoryChart
                  division={div}
                  trajectories={trajectories}
                  highlightTeamId={highlight}
                  height={180}
                />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
