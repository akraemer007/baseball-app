import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { apiGet } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import type { Division, LeagueResponse, TeamTrajectory } from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';
import { TeamSparkline } from '../charts/TeamSparkline';
import NewsSection from '../components/NewsSection';

interface RankedTeam {
  teamId: string;
  abbrev: string;
  name: string;
  color: string;
  trajectory: TeamTrajectory | undefined;
  wins: number;
  losses: number;
  wMinusL: number;
  gamesBehind: number;
  rank: number;
}

function latestRecord(traj: TeamTrajectory | undefined): { wins: number; losses: number; wMinusL: number } {
  const last = traj?.points[traj.points.length - 1];
  if (!last) return { wins: 0, losses: 0, wMinusL: 0 };
  const wins = Math.round((last.gamesPlayed + last.wMinusL) / 2);
  const losses = last.gamesPlayed - wins;
  return { wins, losses, wMinusL: last.wMinusL };
}

function rankDivision(division: Division, trajectories: TeamTrajectory[]): RankedTeam[] {
  const enriched = division.teams.map((t) => {
    const traj = trajectories.find((x) => x.teamId === t.id);
    const rec = latestRecord(traj);
    return { team: t, traj, ...rec };
  });
  enriched.sort((a, b) => b.wMinusL - a.wMinusL);
  const leader = enriched[0];
  return enriched.map((e, i) => ({
    teamId: e.team.id,
    abbrev: e.team.abbrev,
    name: e.team.name,
    color: e.team.color,
    trajectory: e.traj,
    wins: e.wins,
    losses: e.losses,
    wMinusL: e.wMinusL,
    gamesBehind: leader
      ? Math.max(0, ((leader.wins - e.wins) + (e.losses - leader.losses)) / 2)
      : 0,
    rank: i + 1,
  }));
}

function formatGB(gb: number, isLeader: boolean): string {
  if (isLeader) return '—';
  if (gb === 0) return '0';
  const whole = Math.floor(gb);
  const half = gb - whole >= 0.5;
  if (whole === 0 && half) return '½';
  return `${whole}${half ? '½' : ''}`;
}

export default function LeaguePage() {
  const season = new Date().getUTCFullYear();
  const { primaryTeam, secondaryTeam, setPrimaryTeam, setSecondaryTeam } = usePreferences();
  const [selectedDivisionId, setSelectedDivisionId] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(primaryTeam);

  const { data, isLoading, error } = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const divisions = useMemo(() => data?.divisions ?? [], [data]);
  const trajectories = useMemo(() => data?.trajectory ?? [], [data]);

  // Division that contains the primary team — the default feature.
  const primaryDivision = useMemo(
    () =>
      divisions.find((d) => d.teams.some((t) => t.id.toUpperCase() === primaryTeam.toUpperCase())),
    [divisions, primaryTeam],
  );

  // When the primary team changes (or league data loads), snap the featured
  // division to the primary team's division and reset the highlight.
  useEffect(() => {
    if (primaryDivision && !selectedDivisionId) {
      setSelectedDivisionId(primaryDivision.id);
    }
    setHighlight(primaryTeam);
  }, [primaryTeam, primaryDivision]); // eslint-disable-line react-hooks/exhaustive-deps

  const selected = useMemo(
    () =>
      divisions.find((d) => d.id === selectedDivisionId) ??
      primaryDivision ??
      divisions[0],
    [divisions, selectedDivisionId, primaryDivision],
  );

  const primaryTeamData = useMemo(() => {
    for (const d of divisions) {
      const hit = d.teams.find((t) => t.id.toUpperCase() === primaryTeam.toUpperCase());
      if (hit) return hit;
    }
    return null;
  }, [divisions, primaryTeam]);

  const { maxGames, yBound } = useMemo(() => {
    let gp = 0;
    let yb = 1;
    for (const t of trajectories) {
      const last = t.points[t.points.length - 1];
      if (last && last.gamesPlayed > gp) gp = last.gamesPlayed;
      for (const p of t.points) yb = Math.max(yb, Math.abs(p.wMinusL));
    }
    return { maxGames: gp, yBound: yb };
  }, [trajectories]);

  const allTeams = useMemo(() => divisions.flatMap((d) => d.teams), [divisions]);

  return (
    <div className="page">
      <div className="league-header">
        <h1 style={{ margin: 0 }}>
          Hello, <span style={{ color: primaryTeamData?.color }}>{primaryTeamData?.name ?? primaryTeam}</span> fan
        </h1>
        <div className="prefs-bar">
          <label className="pref-field">
            <span className="pref-label">My team</span>
            <select
              className="team-select pref-select"
              value={primaryTeam}
              onChange={(e) => setPrimaryTeam(e.target.value)}
            >
              {divisions.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {d.teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </label>
          <label className="pref-field">
            <span className="pref-label">Secondary</span>
            <select
              className="team-select pref-select"
              value={secondaryTeam}
              onChange={(e) => setSecondaryTeam(e.target.value)}
            >
              {divisions.map((d) => (
                <optgroup key={d.id} label={d.name}>
                  {d.teams
                    .filter((t) => t.id.toUpperCase() !== primaryTeam.toUpperCase())
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
        </div>
      </div>
      <p className="muted">
        The view from every dugout, <span className="mono">{season}</span> season.
        Click a division to pull its full chart up top.
      </p>

      {isLoading && <p className="muted">Loading divisions…</p>}
      {error && <p className="muted">Failed to load league data.</p>}

      {data && selected && (
        <>
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
                    onMouseLeave={() => setHighlight(primaryTeam)}
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

          <h2 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>League standings</h2>
          <div className="grid grid-3 standings-grid">
            {divisions.map((div) => {
              const isActive = div.id === selected.id;
              const ranked = rankDivision(div, trajectories);
              return (
                <button
                  key={div.id}
                  type="button"
                  onClick={() => setSelectedDivisionId(div.id)}
                  className={`card standings-card ${isActive ? 'is-active' : ''}`}
                  aria-pressed={isActive}
                >
                  <h3 className="standings-head">{div.name}</h3>
                  <ul className="standings-list">
                    {ranked.map((t) => (
                      <li key={t.teamId} className="standings-row">
                        <div className="standings-spark">
                          {t.trajectory && (
                            <TeamSparkline
                              points={t.trajectory.points}
                              yBound={yBound}
                              maxGames={maxGames}
                              width={90}
                              height={24}
                            />
                          )}
                        </div>
                        <Link
                          to={`/team/${t.abbrev}`}
                          className="standings-team"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <span className="standings-rank">{t.rank}.</span>{' '}
                          <span style={{ color: t.color }}>{t.name}</span>{' '}
                          <span className="muted mono standings-record">
                            {t.wins}-{t.losses}
                          </span>{' '}
                          <span className="muted mono standings-gb">
                            [{formatGB(t.gamesBehind, t.rank === 1)}]
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </button>
              );
            })}
          </div>
        </>
      )}
      {data && <NewsSection />}

      {/* Keep allTeams reference alive so a future "favorite a player" picker can reuse it. */}
      {allTeams.length === 0 && null}
    </div>
  );
}
