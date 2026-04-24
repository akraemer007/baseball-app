import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import {
  savantBoxScoreUrl,
  savantPlayerUrl,
  savantPreviewUrl,
} from '../lib/savant';
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

/** "Yesterday" in baseball-scoreboard terms (America/New_York), not UTC.
 *  At 9 PM ET on 4/23 a UTC-yesterday would report 4/23 — but the user
 *  considers today 4/23 and yesterday 4/22. */
function yesterdayIso(): string {
  const todayEt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const d = new Date(`${todayEt}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Today's projections + newspaper-style recaps, rendered inline on the
 * League page. Uses the same team-preferences context so primary and
 * secondary teams surface at the top of both lists. League-meta query
 * is cache-shared with the League page itself.
 */
export default function NewsSection() {
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
    <>
      <h2 style={{ marginTop: '1.5rem' }}>Today's games</h2>
      <div className="card">
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
                const isFinal = g.status === 'Final';
                const homeFav = g.impliedHomeWinProb > 0.5;
                const favAbbrev = homeFav ? g.homeTeamId : g.awayTeamId;
                const favPct = (homeFav ? g.impliedHomeWinProb : 1 - g.impliedHomeWinProb) * 100;
                const predictionHit =
                  isFinal && g.winnerTeamId
                    ? g.winnerTeamId.toUpperCase() === favAbbrev.toUpperCase()
                    : null;
                const p = isPrimary(g);
                const s = !p && isSecondary(g);
                const homeIsWinner =
                  isFinal && g.winnerTeamId
                    ? g.winnerTeamId.toUpperCase() === g.homeTeamId.toUpperCase()
                    : false;
                const awayIsWinner =
                  isFinal && g.winnerTeamId
                    ? g.winnerTeamId.toUpperCase() === g.awayTeamId.toUpperCase()
                    : false;
                // Link the matchup to the box score for Finals, preview
                // otherwise — Savant has both pages but the preview gets
                // stale once a game ends.
                const matchupHref = isFinal
                  ? savantBoxScoreUrl(g.gameId)
                  : savantPreviewUrl(g.gameId, g.date);
                return (
                  <div
                    key={g.gameId}
                    className={`proj-card${p ? ' proj-card-primary' : s ? ' proj-card-secondary' : ''}${isFinal ? ' proj-card-final' : ''}`}
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
                      <a
                        className="proj-matchup-link"
                        href={matchupHref}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {isFinal && g.awayScore != null && g.homeScore != null ? (
                          <>
                            <span style={{ fontWeight: awayIsWinner ? 700 : 400 }}>
                              {g.awayTeamId} {g.awayScore}
                            </span>
                            {' · '}
                            <span style={{ fontWeight: homeIsWinner ? 700 : 400 }}>
                              {g.homeTeamId} {g.homeScore}
                            </span>
                          </>
                        ) : (
                          <>
                            {g.awayTeamId} @ <strong>{g.homeTeamId}</strong>
                          </>
                        )}
                      </a>
                      {isFinal && <span className="pill final-tag">FINAL</span>}
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
                      {isFinal
                        ? `lean ${favAbbrev} (${favPct.toFixed(0)}%) — ${predictionHit ? 'hit' : 'miss'}`
                        : `lean: ${favAbbrev} (${favPct.toFixed(0)}%)`}
                    </div>
                    {(g.probableAwayPitcherName || g.probableHomePitcherName) && (
                      <div className="muted" style={{ fontSize: '0.75rem' }}>
                        <NameLink
                          name={g.probableAwayPitcherName}
                          mlbamId={g.probableAwayPitcherId}
                        />{' '}
                        vs{' '}
                        <NameLink
                          name={g.probableHomePitcherName}
                          mlbamId={g.probableHomePitcherId}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
          </div>
        )}
      </div>

      <div
        className="news-date-bar"
        style={{ marginTop: '1.5rem', display: 'flex', alignItems: 'baseline', gap: '0.75rem' }}
      >
        <h2 style={{ margin: 0 }}>Recaps</h2>
        <label className="muted" style={{ fontSize: '0.85rem' }}>Date:</label>
        <input
          type="date"
          className="date-input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
      </div>
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
                  <h2 className="recap-headline">
                    <a
                      className="recap-headline-link"
                      href={savantBoxScoreUrl(r.gameId)}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {r.headline}
                    </a>
                  </h2>
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
    </>
  );
}

function NameLink({
  name,
  mlbamId,
}: {
  name: string | null;
  mlbamId: string | null;
}) {
  if (!name) return <>TBD</>;
  if (!mlbamId) return <>{name}</>;
  return (
    <a
      className="pitcher-link"
      href={savantPlayerUrl(mlbamId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {name}
    </a>
  );
}
