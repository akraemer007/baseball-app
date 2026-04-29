import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import { apiGet, ApiError } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import {
  savantPlayerUrl,
  savantBoxScoreUrl,
  savantPreviewUrl,
} from '../lib/savant';
import type {
  BulkStatDistributionResponse,
  LeagueResponse,
  PercentileStat,
  StatDistributionResponse,
  TeamPlayerDistributionResponse,
  TeamResponse,
} from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';
import { StatDistributionChart } from '../charts/StatDistributionChart';
import { TeamPlayerDistribution } from '../charts/TeamPlayerDistribution';
import { GameDrawer } from '../components/GameDrawer';
import { InfoTip } from '../components/InfoTip';
import { TeamMilestones } from '../components/TeamMilestones';
import { TeamStorylines } from '../components/TeamStorylines';
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
 * Three-column layout for the batting card. Slash line on the left,
 * contact-quality + index stats in the middle, counting stats + per-game
 * rates on the right. Stacks to one column at narrow viewports (CSS).
 *
 * Stats not listed here for the `batting` category are dropped on the
 * floor — keep this in sync with whatever ships in `percentileStats`.
 */
const BATTING_COLUMNS: ReadonlyArray<{ label: string; keys: readonly string[] }> = [
  { label: 'Slash',      keys: ['avg', 'obp', 'slg', 'ops'] },
  { label: 'Advanced',   keys: ['xba', 'woba', 'xwoba', 'ops_plus'] },
  { label: 'Production', keys: ['hits_total', 'hr_total', 'walks_total', 'runs_per_game', 'hr_per_game'] },
];

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
  woba: 6,
  xwoba: 7,
  xba: 8,
  // Batting counts + per-game rates (column 2 on desktop)
  hits_total: 9,
  hr_total: 10,
  walks_total: 11,
  runs_per_game: 12,
  hr_per_game: 13,
  // Pitching — rates first, totals after
  era: 14,
  era_minus: 15,
  fip: 16,
  k_per_9: 17,
  strikeouts_pitching_total: 18,
  // Other
  run_diff: 19,
  errors_per_game: 20,
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
  xwoba: 'xwOBA — "earned" weighted on-base based on contact quality. Good for spotting regression candidates.',
  woba: 'wOBA — weighted on-base average.',
  xba: 'xBA — expected batting average from contact quality.',
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
  const [selectedGame, setSelectedGame] = useState<{ gamePk: number } | null>(null);
  const { primaryTeam, secondaryTeam, comparisonTeam, setComparisonTeam } = usePreferences();

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

  // Reset the comparison whenever the user navigates to a different team
  // page. Sticking to the previously-selected compare team rarely matches
  // intent (you came here to look at THIS team, not to keep comparing
  // against whatever you picked an hour ago).
  useEffect(() => {
    setComparisonTeam(null);
  }, [teamId, setComparisonTeam]);

  // Resolve the comparison team's metadata (color, abbrev, trajectory) from
  // the league response. The trajectory always lives in `leagueQ.data` —
  // ARCH-1's bulk endpoint already returned every team — so no extra fetch.
  const comparisonInfo = useMemo(() => {
    if (!comparisonTeam || !leagueQ.data) return null;
    const upper = comparisonTeam.toUpperCase();
    if (upper === teamId.toUpperCase()) return null;
    let resolved: { team: import('@shared/types').Team } | null = null;
    for (const div of leagueQ.data.divisions) {
      const t = div.teams.find((x) => x.id.toUpperCase() === upper);
      if (t) {
        resolved = { team: t };
        break;
      }
    }
    if (!resolved) return null;
    const traj =
      leagueQ.data.trajectory.find(
        (t) => t.teamId.toUpperCase() === upper,
      ) ?? null;
    return { team: resolved.team, trajectory: traj };
  }, [comparisonTeam, leagueQ.data, teamId]);

  // Click handler for percentile-row dots: toggle the comparison team
  // in place rather than navigating away. Clicking the current team's
  // dot is a no-op (you can't compare yourself); clicking the dot of
  // the team currently selected for comparison clears it.
  const handleSelectCompareTeam = (abbrev: string) => {
    const upper = abbrev.toUpperCase();
    if (upper === teamId.toUpperCase()) return;
    if (comparisonTeam && upper === comparisonTeam.toUpperCase()) {
      setComparisonTeam(null);
    } else {
      setComparisonTeam(abbrev);
    }
  };

  // One bulk fetch covers every PercentileRow's strip-plot. Replaces the old
  // per-row useQuery (~15 parallel GETs) with a single round-trip seeded at
  // the page level. Sorted statKeys keep the cache key stable across renders
  // even if percentileStats' order ever shifts.
  const statKeys = useMemo(
    () =>
      teamQ.data
        ? teamQ.data.percentileStats.map((s) => s.statKey).sort()
        : [],
    [teamQ.data],
  );
  const bulkDistQ = useQuery<BulkStatDistributionResponse>({
    queryKey: ['stat-distributions-bulk', teamId, season, statKeys.join(',')],
    queryFn: () =>
      apiGet<BulkStatDistributionResponse>(
        `/api/league/stat-distributions?stats=${encodeURIComponent(statKeys.join(','))}&season=${season}`,
      ),
    enabled: statKeys.length > 0,
    staleTime: 5 * 60 * 1000,
  });

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

  const { team, record, expectedRecord, streak, percentileStats, recentGames, upcomingGames } =
    teamQ.data;

  const teamAccentRgb = hexToRgb(team.color);

  return (
    <div
      className="page"
      style={{
        ['--primary-team-accent' as string]: team.color,
        ['--primary-team-accent-rgb' as string]: teamAccentRgb,
      }}
    >
      <div className="team-header-row">
        <h1 style={{ color: team.color, margin: 0 }}>{team.name}</h1>
        {leagueQ.data && (
          <div className="prefs-bar" data-help-anchor="compare-to">
            <label className="pref-field">
              <span className="pref-label">Team</span>
              <select
                className="team-select pref-select"
                value={team.id}
                onChange={(e) => navigate(`/team/${e.target.value}`)}
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
            </label>
            <label className="pref-field">
              <span className="pref-label">Compare to</span>
              <select
                className="team-select pref-select"
                value={comparisonTeam ?? ''}
                onChange={(e) =>
                  setComparisonTeam(e.target.value ? e.target.value : null)
                }
              >
                <option value="">(none)</option>
                {leagueQ.data.divisions.map((div) => (
                  <optgroup key={div.id} label={div.name}>
                    {div.teams
                      .filter((t) => t.id.toUpperCase() !== team.id.toUpperCase())
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
        )}
      </div>
      <p className="muted" style={{ marginTop: '0.25rem' }}>
        <span className="mono" style={{ fontSize: '1.1rem', color: 'var(--text)' }}>
          {record.wins}-{record.losses}
        </span>{' '}
        ({formatSlashStat(record.winPct)}){' '}
        · expected{' '}
        <span className="mono">
          {expectedRecord.wins}-{expectedRecord.losses}
        </span>
        <InfoTip>
          Pythagorean expected record from runs scored and allowed (RS² / (RS² + RA²)).
        </InfoTip>
        {' '}· GB{' '}
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
          <>
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
                data-help-anchor="trajectory-mode"
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
              onGameClick={(info) => {
                if (info.gamePk) setSelectedGame({ gamePk: info.gamePk });
              }}
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
          {selectedGame && (
            <GameDrawer
              gamePk={selectedGame.gamePk}
              onClose={() => setSelectedGame(null)}
            />
          )}
          </>
        );
      })()}

      <TeamStorylines teamId={team.id} teamColor={team.color} />

      <TeamMilestones teamId={team.id} teamColor={team.color} />

      <h2 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>Stats</h2>
      {(['batting', 'pitching', 'fielding'] as const).map((cat) => {
        const allRows = percentileStats
          .filter((s) => s.category === cat)
          .sort(
            (a, b) =>
              (STAT_ORDER[a.statKey] ?? 999) - (STAT_ORDER[b.statKey] ?? 999),
          );
        if (!allRows.length) return null;

        // Shared PercentileRow props so the column / fallback render
        // sites don't repeat 15 lines of plumbing each.
        const renderRow = (s: PercentileStat) => (
          <PercentileRow
            key={s.statKey}
            stat={s}
            season={season}
            teamColor={team.color}
            currentTeamAbbrev={team.id}
            primaryTeamAbbrev={primaryTeam}
            secondaryTeamAbbrev={secondaryTeam}
            comparisonTeam={
              comparisonInfo
                ? {
                    abbrev: comparisonInfo.team.id,
                    name: comparisonInfo.team.name,
                    color: comparisonInfo.team.color,
                  }
                : null
            }
            scope={statScope}
            teamLeague={teamLeague}
            teamLeagueMap={teamLeagueMap}
            distribution={bulkDistQ.data?.distributions[s.statKey]}
            isOpen={expandedStat === s.statKey}
            onToggle={() =>
              setExpandedStat(expandedStat === s.statKey ? null : s.statKey)
            }
            onSelectComparison={handleSelectCompareTeam}
          />
        );

        const scopeTag = statScope === 'league' && teamLeague ? teamLeague : 'MLB';
        const header = (
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
        );

        // Batting renders as three side-by-side columns (Slash /
        // Advanced / Production); pitching + fielding keep the
        // existing 2-col flow so we don't churn cards that aren't
        // ready to be re-bucketed yet.
        if (cat === 'batting') {
          const byKey = new Map(allRows.map((s) => [s.statKey, s]));
          const groups = BATTING_COLUMNS.map((g) => ({
            label: g.label,
            rows: g.keys
              .map((k) => byKey.get(k))
              .filter((s): s is PercentileStat => !!s),
          })).filter((g) => g.rows.length > 0);
          return (
            <div key={cat} className="card">
              {header}
              <div className="percentile-columns-3">
                {groups.map((g) => (
                  <div key={g.label} className="percentile-column">
                    <div className="percentile-column-label muted mono">
                      {g.label}
                    </div>
                    <div className="percentile-list">{g.rows.map(renderRow)}</div>
                  </div>
                ))}
              </div>
            </div>
          );
        }

        return (
          <div key={cat} className="card">
            {header}
            <div className="percentile-list percentile-list-wide">
              {allRows.map(renderRow)}
            </div>
          </div>
        );
      })}

      <h2 style={{ marginTop: '1.25rem', marginBottom: '0.5rem' }}>Games</h2>
      <div className="grid grid-2">
        <div className="card" data-help-anchor="last-10">
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

        <div className="card" data-help-anchor="upcoming">
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
  comparisonTeam,
  scope,
  teamLeague,
  teamLeagueMap,
  distribution,
  isOpen,
  onToggle,
  onSelectComparison,
}: {
  stat: PercentileStat;
  season: number;
  teamColor: string;
  currentTeamAbbrev: string;
  primaryTeamAbbrev: string;
  secondaryTeamAbbrev: string;
  /** Comparison team selected from the team-header dropdown. When set,
   *  the expanded row renders a second per-player strip plot underneath
   *  the current team's so you can eyeball roster-level differences. */
  comparisonTeam: { abbrev: string; name: string; color: string } | null;
  scope: 'mlb' | 'league';
  teamLeague: 'AL' | 'NL' | null;
  teamLeagueMap: Map<string, 'AL' | 'NL'>;
  /** 30-team distribution for this stat. Sourced from the page-level bulk
   *  query so we hit the network once per page load instead of once per row. */
  distribution: StatDistributionResponse | undefined;
  isOpen: boolean;
  onToggle: () => void;
  /** Click handler for any non-current dot in the strip plot — sets that
   *  team as the comparison (or clears, when the same dot is clicked
   *  twice). The page wires this to its `setComparisonTeam` setter so
   *  the click stays in-page rather than navigating to /team/:abbrev. */
  onSelectComparison: (abbrev: string) => void;
}) {
  // 30-team distribution arrives via the page-level bulk fetch (one network
  // round-trip for all percentile rows). Alias for the existing `data`
  // references below; the NL/AL filter logic is unchanged.
  const data = distribution;

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

  // Comparison team's per-player distribution. Same shape as the current
  // team's; rendered as a second strip plot underneath when set, so the
  // user can eyeball roster-level differences. Gated on a comparison
  // selection — no fetch when none.
  const comparisonPlayerDistQ = useQuery<TeamPlayerDistributionResponse>({
    queryKey: [
      'team-player-dist',
      comparisonTeam?.abbrev ?? '',
      stat.statKey,
      season,
    ],
    queryFn: () =>
      apiGet<TeamPlayerDistributionResponse>(
        `/api/team/${encodeURIComponent(comparisonTeam!.abbrev)}/player-stat-distribution?stat=${encodeURIComponent(stat.statKey)}&season=${season}`,
      ),
    enabled: !!comparisonTeam,
    retry: (failureCount, err) => {
      if (err instanceof ApiError && err.status === 404) return false;
      return failureCount < 2;
    },
    staleTime: 5 * 60 * 1000,
  });

  return (
    <div
      className="percentile-row percentile-row-expandable"
      data-help-anchor="percentile-row"
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
          // Unify the x-scale across the team chart and BOTH per-player
          // charts (current team + optional comparison team) so dots at
          // the same value land at the same x everywhere. Rate stats only
          // — sum stats use per-chart domains because team total dwarfs
          // individual player totals. Computed at this level (not inside
          // the isOpen block) so the folded spark uses the same domain as
          // the expanded full chart — no horizontal jump on expand.
          const players = playerDistQ.data;
          const cmpPlayers = comparisonPlayerDistQ.data;
          const isSumStat = SUM_STAT_KEYS.has(stat.statKey);
          let sharedDomain: [number, number] | undefined;
          if (players && !isSumStat) {
            const all: number[] = [
              ...scopedData.entries.map((e) => e.value),
              ...players.entries.map((e) => e.value),
              players.teamValue,
            ];
            if (cmpPlayers) {
              all.push(...cmpPlayers.entries.map((e) => e.value));
              all.push(cmpPlayers.teamValue);
            }
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
              comparisonTeamAbbrev={comparisonTeam?.abbrev ?? null}
              xDomain={sharedDomain}
              detail={isOpen ? 'full' : 'spark'}
              onTeamSelect={onSelectComparison}
            />
          );
        })()}
      </div>
      <div className="percentile-foot muted mono">
        {stat.leagueRankPercentile}th pctl
      </div>
      {isOpen && scopedData && (() => {
        const players = playerDistQ.data;
        const cmpPlayers = comparisonPlayerDistQ.data;
        const isSumStat = SUM_STAT_KEYS.has(stat.statKey);
        let sharedDomain: [number, number] | undefined;
        if (players && !isSumStat) {
          const all: number[] = [
            ...scopedData.entries.map((e) => e.value),
            ...players.entries.map((e) => e.value),
            players.teamValue,
          ];
          if (cmpPlayers) {
            all.push(...cmpPlayers.entries.map((e) => e.value));
            all.push(cmpPlayers.teamValue);
          }
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
              hideTeamValue={isSumStat}
            />
            {comparisonTeam && cmpPlayers && cmpPlayers.entries.length > 0 && (
              <>
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
                  {comparisonTeam.abbrev}{' '}
                  {cmpPlayers.side === 'hitter' ? 'hitters' : 'pitchers'} ·
                  qualifying
                </div>
                <TeamPlayerDistribution
                  entries={cmpPlayers.entries}
                  lowerIsBetter={cmpPlayers.lowerIsBetter}
                  teamValue={cmpPlayers.teamValue}
                  teamColor={comparisonTeam.color}
                  side={cmpPlayers.side}
                  statKey={stat.statKey}
                  xDomain={sharedDomain}
                  hideTeamValue={isSumStat}
                />
              </>
            )}
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

/** Convert a #rrggbb hex color to a "r, g, b" triple suitable for use
 *  inside `rgba(var(--primary-team-accent-rgb), 0.08)`. Falls back to
 *  the page text color if the input doesn't match the expected shape. */
function hexToRgb(hex: string): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) return '10, 22, 40';
  return `${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}`;
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
