import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { apiGet } from '../lib/api';
import type { HrRaceResponse, PlayerResponse } from '@shared/types';
import { CumulativeRaceChart, type RaceSeries } from '../charts/CumulativeRaceChart';

export default function PlayerPage() {
  const { playerId = '' } = useParams();
  const season = new Date().getUTCFullYear();

  const playerQ = useQuery<PlayerResponse>({
    queryKey: ['player', playerId, season],
    queryFn: () => apiGet<PlayerResponse>(`/api/player/${playerId}?season=${season}`),
    enabled: !!playerId,
  });

  const raceQ = useQuery<HrRaceResponse>({
    queryKey: ['hr-race', season],
    queryFn: () => apiGet<HrRaceResponse>(`/api/league/hr-race?season=${season}`),
  });

  const series: RaceSeries[] = useMemo(() => {
    if (!raceQ.data) return [];
    return raceQ.data.leaders.map((l) => ({
      id: l.playerId,
      label: `${l.playerName} (${l.seasonHrTotal})`,
      color: l.teamColor,
      points: l.points.map((p) => ({ x: p.gameNum, y: p.cumulativeHr })),
    }));
  }, [raceQ.data]);

  if (playerQ.isLoading)
    return (
      <div className="page">
        <p className="muted">Loading player…</p>
      </div>
    );
  if (playerQ.error || !playerQ.data)
    return (
      <div className="page">
        <p className="muted">Failed to load player.</p>
      </div>
    );

  const { seasonLine, gameLog, statcast } = playerQ.data;
  const statcastEntries = Object.entries(statcast).filter(([, v]) => v !== undefined);
  const highlightId = series.find((s) => s.id === playerId)?.id ?? series[0]?.id ?? null;

  return (
    <div className="page">
      <h1>{seasonLine.playerName}</h1>
      <p className="muted mono">
        {seasonLine.teamId} · {seasonLine.position} · {season}
      </p>

      <div className="card">
        <h3>Season line</h3>
        <table className="stat-table">
          <tbody>
            {Object.entries(seasonLine)
              .filter(([k]) => !['playerId', 'playerName', 'teamId', 'position'].includes(k))
              .map(([k, v]) => (
                <tr key={k}>
                  <td className="mono" style={{ textTransform: 'uppercase' }}>
                    {k}
                  </td>
                  <td className="num">{String(v)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      <div className="card">
        <h3>Home-run race</h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Cumulative HR by game across the league's top sluggers. This player's line is
          highlighted; peers fade to grey.
        </p>
        {raceQ.isLoading ? (
          <p className="muted">Loading race…</p>
        ) : (
          <CumulativeRaceChart
            series={series}
            highlightId={highlightId}
            yLabel="HR"
            xLabel="game #"
            height={340}
          />
        )}
      </div>

      <div className="grid grid-2">
        <div className="card">
          <h3>Statcast</h3>
          <table className="stat-table">
            <tbody>
              {statcastEntries.map(([k, v]) => (
                <tr key={k}>
                  <td className="mono">{k}</td>
                  <td className="num">{String(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="card">
          <h3>Game log</h3>
          <table className="stat-table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Opp</th>
                <th>H/A</th>
                <th>Line</th>
              </tr>
            </thead>
            <tbody>
              {gameLog.slice(0, 12).map((g) => (
                <tr key={g.gameId}>
                  <td className="mono">{g.date}</td>
                  <td>{g.opponentTeamId}</td>
                  <td>{g.isHome ? 'H' : 'A'}</td>
                  <td className="mono" style={{ fontSize: '0.8rem' }}>
                    {Object.entries(g.line)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(' · ')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
