import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useMemo, useState } from 'react';
import { apiGet } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import type { LeagueResponse, StatDistributionResponse, TeamResponse } from '@shared/types';
import { DivisionTrajectoryChart } from '../charts/DivisionTrajectoryChart';
import { StatDistributionChart } from '../charts/StatDistributionChart';
import { InfoTip } from '../components/InfoTip';

const CATEGORY_LABELS: Record<'batting' | 'pitching' | 'fielding', string> = {
  batting: 'Batting — percentile vs. league',
  pitching: 'Pitching — percentile vs. league',
  fielding: 'Other — percentile vs. league',
};

/**
 * Explicit display order. Grid fills left-to-right, top-to-bottom, so odd
 * indices land in the left column and even in the right. Put the classic
 * rate stats on the left (AVG/OBP/SLG/OPS/OPS+) and the totals + misc
 * rates on the right.
 */
const STAT_ORDER: Record<string, number> = {
  // Batting — 5 on the left, 5 on the right
  avg: 1,
  hits_total: 2,
  obp: 3,
  hr_total: 4,
  slg: 5,
  walks_total: 6,
  ops: 7,
  runs_per_game: 8,
  ops_plus: 9,
  hr_per_game: 10,
  // Pitching
  era: 11,
  k_per_9: 12,
  era_minus: 13,
  strikeouts_pitching_total: 14,
  fip: 15,
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
  const { primaryTeam, secondaryTeam } = usePreferences();

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
        ({record.winPct.toFixed(3)}) · GB{' '}
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

      {(['batting', 'pitching', 'fielding'] as const).map((cat) => {
        const rows = percentileStats
          .filter((s) => s.category === cat)
          .sort(
            (a, b) =>
              (STAT_ORDER[a.statKey] ?? 999) - (STAT_ORDER[b.statKey] ?? 999),
          );
        if (!rows.length) return null;
        return (
          <div key={cat} className="card">
            <h3>{CATEGORY_LABELS[cat]}</h3>
            <div className="percentile-list percentile-list-wide">
              {rows.map((s) => {
                const isOpen = expandedStat === s.statKey;
                return (
                  <div
                    key={s.statKey}
                    className="percentile-row percentile-row-expandable"
                    data-open={isOpen}
                    role="button"
                    tabIndex={0}
                    onClick={() => setExpandedStat(isOpen ? null : s.statKey)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setExpandedStat(isOpen ? null : s.statKey);
                      }
                    }}
                  >
                    <div className="percentile-label">
                      <span>
                        {s.label}
                        {STAT_DEFINITIONS[s.statKey] && (
                          <InfoTip>{STAT_DEFINITIONS[s.statKey]}</InfoTip>
                        )}
                        <span className="percentile-row-chevron">▸</span>
                      </span>
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
                      <div
                        className="percentile-median"
                        tabIndex={0}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {s.leagueMean !== undefined && (
                          <span className="percentile-median-tip" role="tooltip">
                            League avg {s.leagueMean}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="percentile-foot muted mono">
                      {s.leagueRankPercentile}th pctl
                    </div>
                    {isOpen && (
                      <div
                        className="stat-dist-container"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <StatDistRow
                          statKey={s.statKey}
                          season={season}
                          currentTeamAbbrev={team.id}
                          primaryTeamAbbrev={primaryTeam}
                          secondaryTeamAbbrev={secondaryTeam}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
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
                    <td className="mono">
                      <a
                        className="team-matchup-link"
                        href={`https://baseballsavant.mlb.com/gamefeed?gamePk=${g.gameId}&hf=boxScore`}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        {g.date.slice(5)}
                      </a>
                    </td>
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
                  <td className="mono">
                    <a
                      className="team-matchup-link"
                      href={`https://baseballsavant.mlb.com/preview?game_pk=${g.gameId}&game_date=${g.date}&date=${g.date}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {g.date.slice(5)}
                    </a>
                  </td>
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
  );
}

function StatDistRow({
  statKey,
  season,
  currentTeamAbbrev,
  primaryTeamAbbrev,
  secondaryTeamAbbrev,
}: {
  statKey: string;
  season: number;
  currentTeamAbbrev: string;
  primaryTeamAbbrev: string;
  secondaryTeamAbbrev: string;
}) {
  const { data, isLoading, error } = useQuery<StatDistributionResponse>({
    queryKey: ['stat-dist', statKey, season],
    queryFn: () =>
      apiGet<StatDistributionResponse>(
        `/api/league/stat-distribution?stat=${encodeURIComponent(statKey)}&season=${season}`,
      ),
  });
  if (isLoading) return <p className="muted" style={{ margin: 0 }}>Loading…</p>;
  if (error || !data) return <p className="muted" style={{ margin: 0 }}>Failed to load distribution.</p>;
  return (
    <StatDistributionChart
      entries={data.entries}
      lowerIsBetter={data.lowerIsBetter}
      leagueMean={data.leagueMean}
      currentTeamAbbrev={currentTeamAbbrev}
      primaryTeamAbbrev={primaryTeamAbbrev}
      secondaryTeamAbbrev={secondaryTeamAbbrev}
      height={160}
    />
  );
}

function formatGB(gb: number): string {
  if (gb === 0) return '—'; // leader
  if (gb < 1) return '½';
  const whole = Math.floor(gb);
  const half = gb - whole >= 0.5 ? '½' : '';
  return `${whole}${half}`;
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
