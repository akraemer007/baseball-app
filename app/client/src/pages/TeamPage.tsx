import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from '../lib/api';
import type { LeagueResponse, TeamResponse } from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';

export default function TeamPage() {
  const { teamId = 'CHC' } = useParams();
  const navigate = useNavigate();
  const season = new Date().getUTCFullYear();

  const teamQ = useQuery<TeamResponse>({
    queryKey: ['team', teamId, season],
    queryFn: () => apiGet<TeamResponse>(`/api/team/${teamId}?season=${season}`),
  });

  const leagueQ = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const teamDivision = useMemo(() => {
    if (!leagueQ.data) return null;
    return (
      leagueQ.data.divisions.find((d) =>
        d.teams.some((t) => t.id.toUpperCase() === teamId.toUpperCase())
      ) ?? null
    );
  }, [leagueQ.data, teamId]);

  if (teamQ.isLoading)
    return (
      <div className="page">
        <p className="muted">Loading team…</p>
      </div>
    );
  if (teamQ.error || !teamQ.data)
    return (
      <div className="page">
        <p className="muted">Failed to load team.</p>
      </div>
    );

  const { team, record, streak, percentileStats, recentGames, upcomingGames } =
    teamQ.data;

  return (
    <div className="page">
      <div className="team-header-row">
        <h1 style={{ color: team.color, margin: 0 }}>{team.name}</h1>
        {leagueQ.data && (
          <select
            className="team-select"
            value={team.id}
            onChange={(e) => navigate(`/team/${e.target.value}`)}
            aria-label="Switch team"
          >
            {leagueQ.data.divisions.map((div) => (
              <optgroup key={div.id} label={div.name}>
                {div.teams.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        )}
      </div>
      <p className="muted" style={{ marginTop: '0.25rem' }}>
        <span className="mono" style={{ fontSize: '1.1rem', color: 'var(--text)' }}>
          {record.wins}-{record.losses}
        </span>{' '}
        ({record.winPct.toFixed(3)}) · Run diff{' '}
        <span className="mono">
          {record.runDiff >= 0 ? '+' : ''}
          {record.runDiff}
        </span>{' '}
        · Streak{' '}
        <span className={`pill${streak.type === 'L' ? ' upset' : ''}`}>
          {streak.type}
          {streak.length}
        </span>
      </p>

      {teamDivision && leagueQ.data && (
        <div className="card">
          <h3>Season trajectory ({teamDivision.name})</h3>
          <DivisionTrajectoryChart
            division={teamDivision}
            trajectories={leagueQ.data.trajectory}
            highlightTeamId={team.id}
            height={240}
          />
        </div>
      )}

      <div className="grid grid-2">
        <div className="card">
          <h3>Percentile vs. league</h3>
          <div className="percentile-list">
            {percentileStats.map((s) => (
              <div key={s.statKey} className="percentile-row">
                <div className="percentile-label">
                  <span>{s.label}</span>
                  <span className="muted mono">{s.value}</span>
                </div>
                <div className="percentile-bar-wrap">
                  <div
                    className="percentile-bar"
                    style={{
                      width: `${s.leagueRankPercentile}%`,
                      background:
                        s.leagueRankPercentile >= 66
                          ? team.color
                          : s.leagueRankPercentile >= 33
                            ? 'rgba(143, 163, 192, 0.65)'
                            : 'rgba(231, 76, 60, 0.8)',
                    }}
                  />
                  <div className="percentile-median" />
                </div>
                <div className="percentile-foot muted mono">
                  {s.leagueRankPercentile}th pctl · {s.category}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card">
            <h3>Last 10</h3>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Matchup</th>
                  <th>Score</th>
                </tr>
              </thead>
              <tbody>
                {recentGames.map((g) => {
                  const wonByTeam = g.winnerTeamId === team.id;
                  return (
                    <tr key={g.gameId}>
                      <td className="mono">{g.date.slice(5)}</td>
                      <td>
                        <TeamLink abbrev={g.awayTeamId} currentId={team.id} /> @{' '}
                        <TeamLink abbrev={g.homeTeamId} currentId={team.id} />
                      </td>
                      <td className="num">
                        <span
                          className="pill"
                          style={{
                            background: wonByTeam ? team.color : 'var(--border)',
                            color: wonByTeam ? '#fff' : 'var(--text-dim)',
                          }}
                        >
                          {wonByTeam ? 'W' : 'L'}
                        </span>{' '}
                        {g.awayScore}-{g.homeScore}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="card">
            <h3>Upcoming</h3>
            <table className="stat-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Matchup</th>
                  <th>Home WP</th>
                </tr>
              </thead>
              <tbody>
                {upcomingGames.map((g) => (
                  <tr key={g.gameId}>
                    <td className="mono">{g.date.slice(5)}</td>
                    <td>
                      <TeamLink abbrev={g.awayTeamId} currentId={team.id} /> @{' '}
                      <TeamLink abbrev={g.homeTeamId} currentId={team.id} />
                    </td>
                    <td className="num">{(g.impliedHomeWinProb * 100).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function TeamLink({ abbrev, currentId }: { abbrev: string; currentId: string }) {
  if (abbrev.toUpperCase() === currentId.toUpperCase()) {
    // Current team — render as plain text so it's visually clear who's "us"
    return <span className="mono">{abbrev}</span>;
  }
  return (
    <Link to={`/team/${abbrev}`} className="mono team-matchup-link">
      {abbrev}
    </Link>
  );
}
