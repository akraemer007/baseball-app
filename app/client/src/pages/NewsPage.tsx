import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import type { ProjectionsResponse, RecapsResponse } from '@shared/types';

const NL_CENTRAL = new Set(['CHC', 'CIN', 'MIL', 'PIT', 'STL']);

function isNLCentralGame(r: { homeTeamId: string; awayTeamId: string }): boolean {
  return NL_CENTRAL.has(r.homeTeamId.toUpperCase()) || NL_CENTRAL.has(r.awayTeamId.toUpperCase());
}

function isCubsGame(r: { homeTeamId: string; awayTeamId: string }): boolean {
  return r.homeTeamId.toUpperCase() === 'CHC' || r.awayTeamId.toUpperCase() === 'CHC';
}

function formatGameType(t: string): string {
  switch (t) {
    case 'walkoff': return 'WALK-OFF';
    case 'comeback': return 'COMEBACK';
    case 'pitching_duel': return 'PITCHING DUEL';
    case 'blowout': return 'BLOWOUT';
    default: return t.toUpperCase();
  }
}

function yesterdayIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

export default function NewsPage() {
  const [date, setDate] = useState(yesterdayIso());

  const recapsQ = useQuery<RecapsResponse>({
    queryKey: ['recaps', date],
    queryFn: () => apiGet<RecapsResponse>(`/api/news/recaps?date=${date}`),
  });

  const projQ = useQuery<ProjectionsResponse>({
    queryKey: ['projections', 'today'],
    queryFn: () => apiGet<ProjectionsResponse>('/api/projections/today'),
  });

  return (
    <div className="page">
      <h1>News</h1>
      <div className="news-date-bar">
        <label className="muted" style={{ fontSize: '0.85rem' }}>
          Date:
        </label>
        <input
          type="date"
          className="date-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>

      {/* Today's projections */}
      <div className="card">
        <h3>Today's projections</h3>
        {projQ.isLoading && <p className="muted">Loading projections…</p>}
        {projQ.data && projQ.data.games.length === 0 && (
          <p className="muted">No games scheduled today.</p>
        )}
        {projQ.data && projQ.data.games.length > 0 && (
          <div className="proj-grid">
            {projQ.data.games.map((g) => {
              const homeFav = g.impliedHomeWinProb > 0.5;
              const favPct = (homeFav ? g.impliedHomeWinProb : 1 - g.impliedHomeWinProb) * 100;
              return (
                <div key={g.gameId} className="proj-card">
                  <div className="proj-matchup mono">
                    {g.awayTeamId} @ <strong>{g.homeTeamId}</strong>
                  </div>
                  <div className="proj-lean muted mono">
                    lean: {homeFav ? g.homeTeamId : g.awayTeamId} ({favPct.toFixed(0)}%)
                  </div>
                  {(g.probableAwayPitcherId || g.probableHomePitcherId) && (
                    <div className="muted" style={{ fontSize: '0.75rem' }}>
                      {g.probableAwayPitcherId ?? 'TBD'} vs {g.probableHomePitcherId ?? 'TBD'}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Newspaper-style recaps */}
      <h2 style={{ marginTop: '1.5rem' }}>Recaps</h2>
      {recapsQ.isLoading && <p className="muted">Loading recaps…</p>}
      {recapsQ.data && recapsQ.data.recaps.length === 0 && (
        <p className="muted">No games on this date.</p>
      )}
      <div className="recap-list">
        {[...(recapsQ.data?.recaps ?? [])]
          .sort((a, b) => {
            // Cubs always first.
            const aCubs = isCubsGame(a) ? 1 : 0;
            const bCubs = isCubsGame(b) ? 1 : 0;
            if (aCubs !== bCubs) return bCubs - aCubs;
            // Then by interest score desc.
            return (b.interestScore ?? 0) - (a.interestScore ?? 0);
          })
          .map((r) => {
            const cubs = isCubsGame(r);
            const nlc = isNLCentralGame(r);
            return (
          <article
            key={r.gameId}
            className={`recap-card${cubs ? ' recap-card-cubs' : nlc ? ' recap-card-nlc' : ''}`}
          >
            <div className="recap-head">
              <h2 className="recap-headline">{r.headline}</h2>
              <div className="recap-tags">
                {cubs && <span className="pill cubs-tag">CUBS</span>}
                {!cubs && nlc && <span className="pill nlc-tag">NL CENTRAL</span>}
                {r.gameType && r.gameType !== 'standard' && (
                  <span className={`pill game-type game-type-${r.gameType}`}>
                    {formatGameType(r.gameType)}
                  </span>
                )}
                {r.upsetFlag && <span className="pill upset">UPSET</span>}
              </div>
            </div>
            <p className="recap-body">
              <span className="recap-dateline mono">{r.dateline}</span>
              {r.summary}
            </p>
            <div className="recap-foot muted mono">
              {r.awayTeamId} {r.awayScore} @ {r.homeTeamId} {r.homeScore} · winner{' '}
              {r.winnerTeamId} · implied win prob{' '}
              {(r.impliedWinProbOfWinner * 100).toFixed(0)}%
              {r.interestScore !== undefined && (
                <>
                  {' '}· interest <strong>{r.interestScore}</strong>/10
                </>
              )}
            </div>
          </article>
            );
          })}
      </div>
    </div>
  );
}
