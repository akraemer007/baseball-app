import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import type { LeagueResponse } from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';

const DEFAULT_DIVISION = 'NL-CENTRAL';

export default function LeaguePage() {
  const season = new Date().getUTCFullYear();
  const [selectedDivisionId, setSelectedDivisionId] = useState<string>(DEFAULT_DIVISION);
  const [highlight, setHighlight] = useState<string | null>('CHC');
  const { data, isLoading, error } = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const divisions = useMemo(() => data?.divisions ?? [], [data]);
  const trajectories = useMemo(() => data?.trajectory ?? [], [data]);
  const selected = useMemo(
    () => divisions.find((d) => d.id === selectedDivisionId) ?? divisions[0],
    [divisions, selectedDivisionId]
  );

  return (
    <div className="page">
      <h1>Hello, Cubs fan</h1>
      <p className="muted">
        The view from every dugout, <span className="mono">{season}</span> season.
        Wins minus losses by game. Click a division below to pull it up top.
      </p>

      {isLoading && <p className="muted">Loading divisions…</p>}
      {error && <p className="muted">Failed to load league data.</p>}

      {data && selected && (
        <>
          {/* Featured division — large */}
          <div className="card division-featured">
            <div className="division-header">
              <h2 style={{ margin: 0 }}>{selected.name}</h2>
              <div className="team-chips">
                {selected.teams.map((t) => (
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
              division={selected}
              trajectories={trajectories}
              highlightTeamId={highlight}
              height={360}
            />
          </div>

          {/* All 6 divisions — small grid, click to promote */}
          <div className="grid grid-3 division-grid">
            {divisions.map((div) => {
              const isActive = div.id === selected.id;
              return (
                <button
                  key={div.id}
                  type="button"
                  onClick={() => setSelectedDivisionId(div.id)}
                  className={`card division-card division-card-button ${
                    isActive ? 'is-active' : ''
                  }`}
                  aria-pressed={isActive}
                >
                  <div className="division-header division-header-compact">
                    <h3>{div.name}</h3>
                  </div>
                  <DivisionTrajectoryChart
                    division={div}
                    trajectories={trajectories}
                    highlightTeamId={highlight}
                    height={140}
                  />
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
