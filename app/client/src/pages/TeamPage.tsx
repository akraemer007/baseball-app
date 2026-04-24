import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiGet, ApiError } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import {
  savantPlayerUrl,
  savantBoxScoreUrl,
  savantPreviewUrl,
} from '../lib/savant';
import type {
  LeagueResponse,
  PercentileStat,
  StatDistributionResponse,
  TeamPlayerDistributionResponse,
  TeamResponse,
} from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';
import { StatDistributionChart } from '../charts/StatDistributionChart';
import { TeamPlayerDistribution } from '../charts/TeamPlayerDistribution';
import { InfoTip } from '../components/InfoTip';
import { formatStat, formatSlashStat } from '../lib/stats';

/** Stats that are counting totals rather than rates. Team-level and
 *  per-player values live on different scales (team hits ~600, player
 *  hits ~80), so the expand-view keeps separate x-scales for these.
 *  Rate stats not in this set share a unified x-scale between the team
 *  chart and the per-player chart below it. */
const SUM_STAT_KEYS = new Set([
  'hits_total',
  'hr_total',
  'walks_total',
  'strikeouts_pitching_total',
]);

const CATEGORY_TITLES: Record<'batting' | 'pitching' | 'fielding', string> = {
  batting: 'Batting',
  pitching: 'Pitching',
  fielding: 'Other',
};

/**
 * Explicit display order. The list uses CSS multi-columns on desktop,
 * which fills column 1 top-to-bottom before column 2 — so consecutive
 * indices stay grouped together. Rates come first (slash line +
 * traditional rate stats), counts after. On a phone the single-column
 * layout reads the same order top-to-bottom, keeping the slash line
 * adjacent.
 */
const STAT_ORDER: Record<string, number> = {
  // Batting rates (column 1 on desktop; top half on phone)
  avg: 1,
  obp: 2,
  slg: 3,
  ops: 4,
  ops_plus: 5,
  // Batting counts + per-game rates (column 2 on desktop)
  hits_total: 6,
  hr_total: 7,
  walks_total: 8,
  runs_per_game: 9,
  hr_per_game: 10,
  // Pitching — rates first, totals after
  era: 11,
  era_minus: 12,
  fip: 13,
  k_per_9: 14,
  strikeouts_pitching_total: 15,
  // Other
  run_diff: 16,
  errors_per_game: 17,
};

const STAT_DEFINITIONS: Record<string, string> = {
  run_diff: 'Run differential. Total runs scored minus total runs allowed this season. Strong positive correlates with winning.',
  hits_total: 'Total hits the team has recorded this season.',
  hr_total: 'Total home runs hit by this team this season.',
  walks_total: 'Total walks drawn by this team this season.',
  strikeouts_pitching_total: 'Total strikeouts recorded by this team’s pitchers this season.',
  avg: 'Batting average. Hits ÷ at-bats. League average is usually around .245.',
  obp: 'On-base percentage. (Hits + walks) ÷ (at-bats + walks). Measures how often a hitter reaches base.',
  slg: 'Slugging percentage. Total bases ÷ at-bats. Measures raw power; a triple is worth 3, a homer 4.',
  ops: 'On-base plus slugging (OBP + SLG). A rough one-number measure of a hitter’s total offense.',
  ops_plus: 'OPS indexed to league average where 100 = league average. 120 means 20% better than average, 80 means 20% worse.',
  era: 'Earned runs allowed per 9 innings pitched. Lower is better.',
  era_minus: 'ERA indexed to league average where 100 = league average. Lower is better: 85 means 15% better than the average staff.',
  fip: 'Fielding-Independent Pitching. Like ERA but only counts home runs, walks, and strikeouts — the outcomes a pitcher most controls.',
  k_per_9: 'Strikeouts per 9 innings pitched. Higher is better (for the pitching side).',
  r_g: 'Runs scored per game.',
  runs_per_game: 'Runs scored per game.',
  hr_per_game: 'Home runs per game (by this team’s hitters).',
  errors_per_game: 'Fielding errors charged per game. Lower is better.',
};

export default function TeamPage() {
  const { teamId = 'CHC' } = useParams();
  const navigate = useNavigate();
  const season = new Date().getUTCFullYear();
  const [expandedStat, setExpandedStat] = useState<string | null>(null);
  const [trajectoryMode, setTrajectoryMode] = useState<'division' | 'yoy'>('division');
  const [statScope, setStatScope] = useState<'mlb' | 'league'>('mlb');
  const { primaryTeam, secondaryTeam } = usePreferences();

  const teamQ = useQuery<TeamResponse>({
    queryKey: ['team', teamId, season],
    queryFn: () => apiGet<TeamResponse>(`/api/team/${teamId}?season=${season}`),
  });

  const leagueQ = useQuery<LeagueResponse>({
    queryKey: ['league', season],
    queryFn: () => apiGet<LeagueResponse>(`/api/league/divisions?season=${season}`),
  });

  const lastYearQ = useQuery<LeagueResponse>({
    queryKey: ['league', season - 1],
    queryFn: () =>
      apiGet<LeagueResponse>(`/api/league/divisions?season=${season - 1}`),
    enabled: trajectoryMode === 'yoy',
    staleTime: 5 * 60 * 1000,
  });

  const teamDivision = useMemo(() => {
    if (!leagueQ.data) return null;
    return (
      leagueQ.data.divisions.find((d) =>
        d.teams.some((t) => t.id.toUpperCase() === teamId.toUpperCase())
      ) ?? null
    );
  }, [leagueQ.data, teamId]);

  // abbrev → league ('AL' | 'NL') map used to filter stat distributions
  // to just this team's league when the scope toggle is flipped.
  const teamLeagueMap = useMemo(() => {
    const m = new Map<string, 'AL' | 'NL'>();
    if (!leagueQ.data) return m;
    for (const d of leagueQ.data.divisions) {
      for (const t of d.teams) m.set(t.id.toUpperCase(), d.league);
    }
    return m;
  }, [leagueQ.data]);

  const teamLeague = teamDivision?.league ?? null;

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
        ({formatSlashStat(record.winPct)}) · GB{' '}
        <span className="mono">{formatGB(record.gamesBehind)}</span>
        {' '}· Run diff{' '}
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

      {teamDivision && leagueQ.data && (() => {
        const currentTraj = leagueQ.data.trajectory.find((t) => t.teamId === team.id);
        const gamesSoFar = currentTraj?.points.length ?? 0;
        const lastYearTraj = lastYearQ.data?.trajectory.find((t) => t.teamId === team.id);
        const isYoy = trajectoryMode === 'yoy';
        const ghost = isYoy && lastYearTraj
          ? { ...lastYearTraj, points: lastYearTraj.points.slice(0, gamesSoFar) }
          : null;
        const trajectoriesForChart = isYoy
          ? (currentTraj ? [currentTraj] : [])
          : leagueQ.data.trajectory;
        return (
          <div className="card">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem',
              }}
            >
              <h3 style={{ margin: 0 }}>
                {isYoy
                  ? `Season trajectory — ${season} vs ${season - 1}`
                  : `Season trajectory (${teamDivision.name})`}
              </h3>
              <div
                className="mono"
                style={{ display: 'inline-flex', fontSize: '0.75rem', border: '1px solid var(--border)', borderRadius: 999, overflow: 'hidden' }}
              >
                <button
                  type="button"
                  onClick={() => setTrajectoryMode('division')}
                  style={{
                    padding: '0.25rem 0.7rem',
                    background: trajectoryMode === 'division' ? 'var(--text)' : 'transparent',
                    color: trajectoryMode === 'division' ? 'var(--bg)' : 'var(--text-dim)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  Division
                </button>
                <button
                  type="button"
                  onClick={() => setTrajectoryMode('yoy')}
                  style={{
                    padding: '0.25rem 0.7rem',
                    background: trajectoryMode === 'yoy' ? 'var(--text)' : 'transparent',
                    color: trajectoryMode === 'yoy' ? 'var(--bg)' : 'var(--text-dim)',
                    border: 'none',
                    cursor: 'pointer',
                  }}
                >
                  vs {season - 1}
                </button>
              </div>
            </div>
            <DivisionTrajectoryChart
              division={teamDivision}
              trajectories={trajectoriesForChart}
              highlightTeamId={team.id}
              ghostTrajectory={ghost}
              height={240}
            />
            {isYoy && lastYearQ.isLoading && (
              <p className="muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                Loading {season - 1} trajectory…
              </p>
            )}
            {isYoy && lastYearQ.data && !lastYearTraj && (
              <p className="muted" style={{ fontSize: '0.75rem', margin: '0.25rem 0 0' }}>
                No {season - 1} data for {team.abbrev}.
              </p>
            )}
          </div>
        );
      })()}

      {(['batting', 'pitching', 'fielding'] as const).map((cat) => {
        const rows = percentileStats
          .filter((s) => s.category === cat)
          .sort(
            (a, b) =>
              (STAT_ORDER[a.statKey] ?? 999) - (STAT_ORDER[b.statKey] ?? 999),
          );
        if (!rows.length) return null;
        const scopeTag = statScope === 'league' && teamLeague ? teamLeague : 'MLB';
        return (
          <div key={cat} className="card">
            <h3 className="stat-card-title">
              <span>
                {CATEGORY_TITLES[cat]} vs.{' '}
                <span className="muted mono" style={{ fontWeight: 500 }}>
                  {scopeTag}
                </span>
              </span>
              {teamLeague && (
                <div className="scope-toggle mono">
                  <button
                    type="button"
                    onClick={() => setStatScope('mlb')}
                    data-active={statScope === 'mlb'}
                  >
                    All MLB
                  </button>
                  <button
                    type="button"
                    onClick={() => setStatScope('league')}
                    data-active={statScope === 'league'}
                  >
                    {teamLeague}
                  </button>
                </div>
              )}
            </h3>
            <div className="percentile-list percentile-list-wide">
              {rows.map((s) => (
                <PercentileRow
                  key={s.statKey}
                  stat={s}
                  season={season}
                  teamColor={team.color}
                  currentTeamAbbrev={team.id}
                  primaryTeamAbbrev={primaryTeam}
                  secondaryTeamAbbrev={secondaryTeam}
                  scope={statScope}
                  teamLeague={teamLeague}
                  teamLeagueMap={teamLeagueMap}
                  isOpen={expandedStat === s.statKey}
                  onToggle={() =>
                    setExpandedStat(expandedStat === s.statKey ? null : s.statKey)
                  }
                />
              ))}
            </div>
          </div>
        );
      })}

      <div className="grid grid-2">
        <div className="card">
          <h3>Last 10</h3>
          <table className="stat-table">
            <thead>
              <tr>
                <th className="col-shrink">Date</th>
                <th className="matchup-col">Matchup</th>
                <th className="col-shrink"></th>
                <th className="col-shrink">Score</th>
                <th>Top performer</th>
              </tr>
            </thead>
            <tbody>
              {recentGames.map((g) => {
                const wonByTeam = g.winnerTeamId === team.id;
                return (
                  <tr key={g.gameId}>
                    <td className="mono col-shrink">
                      <a
                        className="team-matchup-link"
                        href={savantBoxScoreUrl(g.gameId)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {g.date.slice(5)}
                      </a>
                    </td>
                    <td className="matchup-col">
                      <TeamLink abbrev={g.awayTeamId} currentId={team.id} /> @{' '}
                      <TeamLink abbrev={g.homeTeamId} currentId={team.id} />
                    </td>
                    <td className="col-shrink">
                      <span
                        className="pill score-wl"
                        style={{
                          background: wonByTeam ? team.color : 'var(--border)',
                          color: wonByTeam ? '#fff' : 'var(--text-dim)',
                        }}
                      >
                        {wonByTeam ? 'W' : 'L'}
                      </span>
                    </td>
                    <td className="col-shrink mono score-num">
                      {g.awayScore}-{g.homeScore}
                    </td>
                    <td className="top-performer muted">
                      {g.topPerformer && (
                        <>
                          <a
                            className="team-matchup-link"
                            href={savantPlayerUrl(g.topPerformer.playerId)}
                            target="_blank"
                            rel="noopener noreferrer"
                          >
                            {g.topPerformer.playerName}
                          </a>{' '}
                          {g.topPerformer.statLine}
                        </>
                      )}
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
                <th className="col-shrink">Date</th>
                <th>Matchup</th>
                <th className="col-shrink">Favorite</th>
              </tr>
            </thead>
            <tbody>
              {upcomingGames.map((g) => {
                const homeFav = g.impliedHomeWinProb >= 0.5;
                const favAbbrev = homeFav ? g.homeTeamId : g.awayTeamId;
                const favPct = Math.round(
                  (homeFav ? g.impliedHomeWinProb : 1 - g.impliedHomeWinProb) * 100,
                );
                return (
                  <tr key={g.gameId}>
                    <td className="mono col-shrink">
                      <a
                        className="team-matchup-link"
                        href={savantPreviewUrl(g.gameId, g.date)}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {g.date.slice(5)}
                      </a>
                    </td>
                    <td>
                      <div>
                        <TeamLink abbrev={g.awayTeamId} currentId={team.id} /> @{' '}
                        <TeamLink abbrev={g.homeTeamId} currentId={team.id} />
                      </div>
                      {(g.probableAwayPitcherName || g.probableHomePitcherName) && (
                        <div className="muted" style={{ fontSize: '0.75rem', marginTop: '0.1rem' }}>
                          <PitcherLink
                            name={g.probableAwayPitcherName}
                            mlbamId={g.probableAwayPitcherId}
                          />{' '}
                          vs{' '}
                          <PitcherLink
                            name={g.probableHomePitcherName}
                            mlbamId={g.probableHomePitcherId}
                          />
                        </div>
                      )}
                    </td>
                    <td className="col-shrink">
                      <span className="mono">
                        {favAbbrev} {favPct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function PercentileRow({
  stat,
  season,
  teamColor,
  currentTeamAbbrev,
  primaryTeamAbbrev,
  secondaryTeamAbbrev,
  scope,
  teamLeague,
  teamLeagueMap,
  isOpen,
  onToggle,
}: {
  stat: PercentileStat;
  season: number;
  teamColor: string;
  currentTeamAbbrev: string;
  primaryTeamAbbrev: string;
  secondaryTeamAbbrev: string;
  scope: 'mlb' | 'league';
  teamLeague: 'AL' | 'NL' | null;
  teamLeagueMap: Map<string, 'AL' | 'NL'>;
  isOpen: boolean;
  onToggle: () => void;
}) {
  // Always fetch the 30-team distribution so the row's sparkline is
  // populated up-front. React-Query dedupes by key, so the expanded
  // StatDistributionChart reuses the same cached response.
  const { data } = useQuery<StatDistributionResponse>({
    queryKey: ['stat-dist', stat.statKey, season],
    queryFn: () =>
      apiGet<StatDistributionResponse>(
        `/api/league/stat-distribution?stat=${encodeURIComponent(stat.statKey)}&season=${season}`,
      ),
  });

  // When "NL"/"AL" scope is active, filter the 30-team response to the
  // team's league (15 teams), recompute the reference mean as the
  // unweighted mean of the remaining team values, and re-rank within
  // the filtered set. Good enough for the strip-plot comparison.
  const scopedData = useMemo(() => {
    if (!data) return null;
    if (scope === 'mlb' || !teamLeague) return data;
    const filtered = data.entries.filter(
      (e) => teamLeagueMap.get(e.teamAbbrev.toUpperCase()) === teamLeague,
    );
    if (!filtered.length) return data;
    const leagueMean =
      filtered.reduce((acc, e) => acc + e.value, 0) / filtered.length;
    // Re-rank (1 = best) by direction of the stat.
    const sorted = [...filtered].sort((a, b) =>
      data.lowerIsBetter ? a.value - b.value : b.value - a.value,
    );
    const rankByAbbrev = new Map(sorted.map((e, i) => [e.teamAbbrev, i + 1]));
    return {
      ...data,
      entries: filtered.map((e) => ({
        ...e,
        rank: rankByAbbrev.get(e.teamAbbrev) ?? e.rank,
      })),
      leagueMean,
    };
  }, [data, scope, teamLeague, teamLeagueMap]);
  const scopeLabel = scope === 'league' && teamLeague ? teamLeague : 'MLB';

  // Second chart: this team's players. Prefetched on row mount (not
  // gated on `isOpen`) so the expand click is instant — the 30-team
  // distribution above already follows the same pattern. React-Query
  // dedupes by key and the server's 5-min LRU cache absorbs reloads.
  // The endpoint returns 404 for team-level-only stats (run_diff,
  // ops_plus, etc.); we silently skip rendering in that case.
  const playerDistQ = useQuery<TeamPlayerDistributionResponse>({
    queryKey: ['team-player-dist', currentTeamAbbrev, stat.statKey, season],
    queryFn: () =>
      apiGet<TeamPlayerDistributionResponse>(
        `/api/team/${encodeURIComponent(currentTeamAbbrev)}/player-stat-distribution?stat=${encodeURIComponent(stat.statKey)}&season=${season}`,
      ),
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div
      className="percentile-row percentile-row-expandable"
      data-open={isOpen}
      role="button"
      tabIndex={0}
      onClick={onToggle}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
    >
      <div className="percentile-label">
        <span>
          {stat.label}
          {STAT_DEFINITIONS[stat.statKey] && (
            <InfoTip>{STAT_DEFINITIONS[stat.statKey]}</InfoTip>
          )}
          <span className="percentile-row-chevron">▸</span>
        </span>
      </div>
      <div className="percentile-value muted mono">{formatStat(stat.value, stat.statKey)}</div>
      <div className="percentile-spark-wrap">
        {scopedData && (() => {
          // Unify the x-scale across the team chart and the per-player
          // chart below so dots at the same value land at the same x in
          // both. Rate stats only — for sum stats (team total vs per-
          // player total) the magnitudes differ by 1-2 orders so each
          // chart keeps its own domain. Computed at this level (not inside
          // the isOpen block) so the folded spark uses the same domain as
          // the expanded full chart — no horizontal jump on expand.
          const players = playerDistQ.data;
          const isSumStat = SUM_STAT_KEYS.has(stat.statKey);
          let sharedDomain: [number, number] | undefined;
          if (players && !isSumStat) {
            const all: number[] = [
              ...scopedData.entries.map((e) => e.value),
              ...players.entries.map((e) => e.value),
              players.teamValue,
            ];
            const minV = Math.min(...all);
            const maxV = Math.max(...all);
            const pad = (maxV - minV) * 0.08 || 0.1;
            sharedDomain = [minV - pad, maxV + pad];
          }
          return (
            <StatDistributionChart
              entries={scopedData.entries}
              lowerIsBetter={scopedData.lowerIsBetter}
              leagueMean={scopedData.leagueMean}
              statKey={stat.statKey}
              scopeLabel={scopeLabel}
              currentTeamAbbrev={currentTeamAbbrev}
              primaryTeamAbbrev={primaryTeamAbbrev}
              secondaryTeamAbbrev={secondaryTeamAbbrev}
              xDomain={sharedDomain}
              detail={isOpen ? 'full' : 'spark'}
            />
          );
        })()}
      </div>
      <div className="percentile-foot muted mono">
        {stat.leagueRankPercentile}th pctl
      </div>
      {isOpen && scopedData && (() => {
        const players = playerDistQ.data;
        const isSumStat = SUM_STAT_KEYS.has(stat.statKey);
        let sharedDomain: [number, number] | undefined;
        if (players && !isSumStat) {
          const all: number[] = [
            ...scopedData.entries.map((e) => e.value),
            ...players.entries.map((e) => e.value),
            players.teamValue,
          ];
          const minV = Math.min(...all);
          const maxV = Math.max(...all);
          const pad = (maxV - minV) * 0.08 || 0.1;
          sharedDomain = [minV - pad, maxV + pad];
        }
        if (!players || players.entries.length === 0) return null;
        return (
          <div
            className="stat-dist-container"
            onClick={(e) => e.stopPropagation()}
          >
            <div
              className="muted mono"
              style={{
                fontSize: '0.7rem',
                textTransform: 'uppercase',
                letterSpacing: '0.06em',
                marginTop: '0.25rem',
                marginBottom: '-0.25rem',
              }}
            >
              {currentTeamAbbrev}{' '}
              {players.side === 'hitter' ? 'hitters' : 'pitchers'} ·
              qualifying
            </div>
            <TeamPlayerDistribution
              entries={players.entries}
              lowerIsBetter={players.lowerIsBetter}
              teamValue={players.teamValue}
              teamColor={teamColor}
              side={players.side}
              statKey={stat.statKey}
              xDomain={sharedDomain}
            />
          </div>
        );
      })()}
    </div>
  );
}

function formatGB(gb: number): string {
  if (gb === 0) return '—'; // leader
  if (gb < 1) return '½';
  const whole = Math.floor(gb);
  const half = gb - whole >= 0.5 ? '½' : '';
  return `${whole}${half}`;
}

function PitcherLink({
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
      className="team-matchup-link"
      href={savantPlayerUrl(mlbamId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {name}
    </a>
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
