import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import type { LeagueResponse, ProjectionsResponse, RecapsResponse } from '@shared/types';

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
  const season = new Date().getUTCFullYear();
  const [date, setDate] = useState(yesterdayIso());
  const { primaryTeam, secondaryTeam } = usePreferences();

  const recapsQ = useQuery<RecapsResponse>({
    queryKey: ['recaps', date],
    queryFn: () => apiGet<RecapsResponse>(`/api/news/recaps?date=${date}`),
  });

  const projQ = useQuery<ProjectionsResponse>({
    queryKey: ['projections', 'today'],
    queryFn: () => apiGet<ProjectionsResponse>('/api/projections/today'),
  });

  // League data gives us team colors + division memberships for the
  // primary-division tag. Shared cache with the League page (5-min stale).
  const leagueQ = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const teamMeta = useMemo(() => {
    const byAbbrev = new Map<string, { color: string; name: string; divisionId: string }>();
    for (const d of leagueQ.data?.divisions ?? []) {
      for (const t of d.teams) {
        byAbbrev.set(t.id.toUpperCase(), {
          color: t.color,
          name: t.name,
          divisionId: d.id,
        });
      }
    }
    return byAbbrev;
  }, [leagueQ.data]);

  const primaryInfo = teamMeta.get(primaryTeam.toUpperCase());
  const secondaryInfo = teamMeta.get(secondaryTeam.toUpperCase());
  const primaryDivisionAbbrevs = useMemo(() => {
    if (!primaryInfo) return new Set<string>();
    const div = leagueQ.data?.divisions.find((d) => d.id === primaryInfo.divisionId);
    return new Set((div?.teams ?? []).map((t) => t.id.toUpperCase()));
  }, [leagueQ.data, primaryInfo]);
  const primaryDivisionName = useMemo(
    () => leagueQ.data?.divisions.find((d) => d.id === primaryInfo?.divisionId)?.name ?? '',
    [leagueQ.data, primaryInfo],
  );

  const isPrimary = (g: { homeTeamId: string; awayTeamId: string }) =>
    g.homeTeamId.toUpperCase() === primaryTeam.toUpperCase() ||
    g.awayTeamId.toUpperCase() === primaryTeam.toUpperCase();
  const isSecondary = (g: { homeTeamId: string; awayTeamId: string }) =>
    g.homeTeamId.toUpperCase() === secondaryTeam.toUpperCase() ||
    g.awayTeamId.toUpperCase() === secondaryTeam.toUpperCase();
  const isPrimaryDivision = (g: { homeTeamId: string; awayTeamId: string }) =>
    primaryDivisionAbbrevs.has(g.homeTeamId.toUpperCase()) ||
    primaryDivisionAbbrevs.has(g.awayTeamId.toUpperCase());

  return (
    <div className="page">
      <h1>News</h1>
      <div className="news-date-bar">
        <label className="muted" style={{ fontSize: '0.85rem' }}>Date:</label>
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
            {[...projQ.data.games]
              .sort((a, b) => {
                const aP = isPrimary(a) ? 2 : isSecondary(a) ? 1 : 0;
                const bP = isPrimary(b) ? 2 : isSecondary(b) ? 1 : 0;
                return bP - aP;
              })
              .map((g) => {
                const homeFav = g.impliedHomeWinProb > 0.5;
                const favPct = (homeFav ? g.impliedHomeWinProb : 1 - g.impliedHomeWinProb) * 100;
                const p = isPrimary(g);
                const s = !p && isSecondary(g);
                return (
                  <div
                    key={g.gameId}
                    className={`proj-card${p ? ' proj-card-primary' : s ? ' proj-card-secondary' : ''}`}
                    style={
                      p && primaryInfo
                        ? {
                            borderLeft: `3px solid ${primaryInfo.color}`,
                            background: `linear-gradient(to right, ${primaryInfo.color}14, var(--bg-elev) 40%)`,
                          }
                        : s && secondaryInfo
                          ? { borderLeft: `3px solid ${secondaryInfo.color}` }
                          : undefined
                    }
                  >
                    <div className="proj-matchup mono">
                      {g.awayTeamId} @ <strong>{g.homeTeamId}</strong>
                      {p && primaryInfo && (
                        <span
                          className="pill team-tag"
                          style={{ marginLeft: '0.4rem', background: primaryInfo.color, color: '#fff' }}
                        >
                          {primaryTeam}
                        </span>
                      )}
                      {s && secondaryInfo && (
                        <span
                          className="pill team-tag team-tag-secondary"
                          style={{ marginLeft: '0.4rem', color: secondaryInfo.color }}
                        >
                          {secondaryTeam}
                        </span>
                      )}
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
            const aP = isPrimary(a) ? 2 : isSecondary(a) ? 1 : 0;
            const bP = isPrimary(b) ? 2 : isSecondary(b) ? 1 : 0;
            if (aP !== bP) return bP - aP;
            return (b.interestScore ?? 0) - (a.interestScore ?? 0);
          })
          .map((r) => {
            const p = isPrimary(r);
            const s = !p && isSecondary(r);
            const div = !p && !s && isPrimaryDivision(r);
            return (
              <article
                key={r.gameId}
                className="recap-card"
                style={
                  p && primaryInfo
                    ? {
                        borderLeft: `3px solid ${primaryInfo.color}`,
                        background: `linear-gradient(to right, ${primaryInfo.color}14, var(--bg-elev) 40%)`,
                      }
                    : s && secondaryInfo
                      ? { borderLeft: `3px solid ${secondaryInfo.color}` }
                      : div && primaryInfo
                        ? { borderLeft: `3px solid ${primaryInfo.color}` }
                        : undefined
                }
              >
                <div className="recap-head">
                  <h2 className="recap-headline">{r.headline}</h2>
                  <div className="recap-tags">
                    {p && primaryInfo && (
                      <span
                        className="pill team-tag"
                        style={{ background: primaryInfo.color, color: '#fff' }}
                      >
                        {primaryTeam}
                      </span>
                    )}
                    {s && secondaryInfo && (
                      <span
                        className="pill team-tag team-tag-secondary"
                        style={{ color: secondaryInfo.color }}
                      >
                        {secondaryTeam}
                      </span>
                    )}
                    {div && primaryDivisionName && (
                      <span className="pill division-tag">
                        {primaryDivisionName.toUpperCase()}
                      </span>
                    )}
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
