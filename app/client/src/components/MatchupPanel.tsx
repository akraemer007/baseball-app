import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { savantPlayerUrl } from '../lib/savant';
import { StatDistributionChart } from '../charts/StatDistributionChart';
import { InfoTip } from './InfoTip';
import { formatSlashStat } from '../lib/stats';
import type {
  MatchupResponse,
  ScheduledGame,
  StatDistributionEntry,
  PitcherDistributionEntry,
} from '@shared/types';

interface Props {
  game: ScheduledGame;
  onClose: () => void;
}

/** Format MLB-style 2-decimal float for ERA / K9 (no rounding-to-int). */
function formatPitcherStat(v: number | null): string {
  if (v == null) return '—';
  return v.toFixed(2);
}

/** Last name only — keeps the chart label terse. Mirrors the
 *  per-game top-performer convention used elsewhere. */
function lastName(full: string): string {
  const parts = full.trim().split(/\s+/);
  return parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
}

/** Adapt a pitcher distribution into the team-shaped entries the existing
 *  StatDistributionChart consumes. Each "team" is actually one pitcher;
 *  the team color is preserved so the dot still pops in team palette.
 *  `entryHref` opts each dot into Savant click-through, overriding the
 *  chart's default team-page navigation. */
function pitcherEntriesAsTeamEntries(
  entries: PitcherDistributionEntry[],
): StatDistributionEntry[] {
  return entries.map((e) => ({
    teamAbbrev: lastName(e.pitcherName),
    teamName: `${e.pitcherName} (${e.teamAbbrev})`,
    teamColor: e.teamColor,
    value: e.value,
    rank: e.rank,
    entryHref: savantPlayerUrl(e.pitcherId),
  }));
}

/** Find the spotlight pitcher's "abbrev" label so the chart highlights the
 *  right dot. Returns last name to match the synthetic entries above. */
function spotlightLabel(
  data: MatchupResponse,
  pitcherId: string | undefined,
): string | undefined {
  if (!pitcherId) return undefined;
  const dist = data.pitcherLeague.era.entries;
  const found = dist.find((e) => e.pitcherId === pitcherId);
  return found ? lastName(found.pitcherName) : undefined;
}

export default function MatchupPanel({ game, onClose }: Props) {
  // ESC to close.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matchupQ = useQuery<MatchupResponse>({
    queryKey: ['matchup', game.gameId],
    queryFn: () => apiGet<MatchupResponse>(`/api/matchup/${game.gameId}`),
  });

  return (
    <div className="matchup-panel">
      <div className="matchup-panel-head mono">
        <span>
          <strong>{game.awayTeamId}</strong> @ <strong>{game.homeTeamId}</strong> · matchup
        </span>
        <button
          type="button"
          className="matchup-close"
          onClick={onClose}
          aria-label="Close matchup panel"
        >
          ×
        </button>
      </div>

      {matchupQ.isLoading && <p className="muted">Loading matchup…</p>}
      {matchupQ.error && (
        <p className="muted">Couldn't load matchup. {String(matchupQ.error)}</p>
      )}
      {matchupQ.data && (
        <MatchupBody data={matchupQ.data} />
      )}
    </div>
  );
}

function MatchupBody({ data }: { data: MatchupResponse }) {
  const eraEntries = pitcherEntriesAsTeamEntries(data.pitcherLeague.era.entries);
  const k9Entries = pitcherEntriesAsTeamEntries(data.pitcherLeague.k9.entries);
  const fipEntries = pitcherEntriesAsTeamEntries(data.pitcherLeague.fip.entries);

  return (
    <div className="matchup-body">
      <div className="matchup-pitchers">
        <PitcherBlock
          side="away"
          teamAbbrev={data.awayTeamId}
          pitcher={data.pitcher.away}
          eraEntries={eraEntries}
          eraMean={data.pitcherLeague.era.leagueMean}
          k9Entries={k9Entries}
          k9Mean={data.pitcherLeague.k9.leagueMean}
          fipEntries={fipEntries}
          fipMean={data.pitcherLeague.fip.leagueMean}
          spotlight={spotlightLabel(data, data.pitcher.away?.id)}
        />
        <PitcherBlock
          side="home"
          teamAbbrev={data.homeTeamId}
          pitcher={data.pitcher.home}
          eraEntries={eraEntries}
          eraMean={data.pitcherLeague.era.leagueMean}
          k9Entries={k9Entries}
          k9Mean={data.pitcherLeague.k9.leagueMean}
          fipEntries={fipEntries}
          fipMean={data.pitcherLeague.fip.leagueMean}
          spotlight={spotlightLabel(data, data.pitcher.home?.id)}
        />
      </div>

      <div className="matchup-hitters">
        <HitterTable teamAbbrev={data.awayTeamId} hitters={data.topHitters.away} />
        <HitterTable teamAbbrev={data.homeTeamId} hitters={data.topHitters.home} />
      </div>

      <H2HLine
        homeAbbrev={data.homeTeamId}
        awayAbbrev={data.awayTeamId}
        h2h={data.h2hRecord}
      />

      {/* Pitcher LHP/RHP splits intentionally omitted: silver tables don't
          carry batter handedness today. When the pipeline adds it,
          MatchupPitcher.splits will populate and a line will render here. */}
    </div>
  );
}

function PitcherBlock({
  side,
  teamAbbrev,
  pitcher,
  eraEntries,
  eraMean,
  k9Entries,
  k9Mean,
  fipEntries,
  fipMean,
  spotlight,
}: {
  side: 'home' | 'away';
  teamAbbrev: string;
  pitcher: MatchupResponse['pitcher']['home'];
  eraEntries: StatDistributionEntry[];
  eraMean: number;
  k9Entries: StatDistributionEntry[];
  k9Mean: number;
  fipEntries: StatDistributionEntry[];
  fipMean: number;
  spotlight: string | undefined;
}) {
  return (
    <div className="matchup-pitcher mono">
      <div className="matchup-pitcher-head">
        <span className="muted" style={{ fontSize: '0.7rem', letterSpacing: '0.04em' }}>
          {side.toUpperCase()} · {teamAbbrev}
        </span>
        <span className="matchup-pitcher-name">
          {pitcher ? (
            <a
              className="pitcher-link"
              href={savantPlayerUrl(pitcher.id)}
              target="_blank"
              rel="noopener noreferrer"
            >
              {pitcher.name}
            </a>
          ) : (
            'TBD'
          )}
        </span>
      </div>
      {pitcher && (
        <>
          <div className="matchup-metric">
            <span className="metric-label">ERA</span>
            <span className="metric-val">{formatPitcherStat(pitcher.era)}</span>
            <div className="metric-spark">
              <StatDistributionChart
                entries={eraEntries}
                lowerIsBetter
                leagueMean={eraMean}
                statKey="era"
                scopeLabel="MLB"
                currentTeamAbbrev={spotlight ?? ''}
                detail="spark"
              />
            </div>
          </div>
          <div className="matchup-metric">
            <span className="metric-label">K/9</span>
            <span className="metric-val">{formatPitcherStat(pitcher.k9)}</span>
            <div className="metric-spark">
              <StatDistributionChart
                entries={k9Entries}
                lowerIsBetter={false}
                leagueMean={k9Mean}
                statKey="k_per_9"
                scopeLabel="MLB"
                currentTeamAbbrev={spotlight ?? ''}
                detail="spark"
              />
            </div>
          </div>
          <div className="matchup-metric">
            <span className="metric-label">
              FIP
              <InfoTip placement="bottom">
                Fielding-Independent Pitching — like ERA but only counts
                HR, BB, and K (the outcomes a pitcher most controls).
                Lower is better.
              </InfoTip>
            </span>
            <span className="metric-val">{formatPitcherStat(pitcher.fip)}</span>
            <div className="metric-spark">
              <StatDistributionChart
                entries={fipEntries}
                lowerIsBetter
                leagueMean={fipMean}
                statKey="fip"
                scopeLabel="MLB"
                currentTeamAbbrev={spotlight ?? ''}
                detail="spark"
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function HitterTable({
  teamAbbrev,
  hitters,
}: {
  teamAbbrev: string;
  hitters: MatchupResponse['topHitters']['home'];
}) {
  // Top 3 are picked server-side by season AB; we display them sorted
  // by L10 OPS desc so the hottest bat in the last 10 reads first.
  // Players with <10 games sink to the bottom (null sorts last).
  const sorted = [...hitters].sort((a, b) => {
    const av = a.last10Ops ?? -Infinity;
    const bv = b.last10Ops ?? -Infinity;
    return bv - av;
  });
  return (
    <div className="matchup-hitter-block mono">
      <div className="muted" style={{ fontSize: '0.7rem', letterSpacing: '0.04em' }}>
        TOP HITTERS · {teamAbbrev}
      </div>
      <table className="matchup-hitter-table">
        <thead>
          <tr>
            <th>Player</th>
            <th>AVG</th>
            <th>OBP</th>
            <th>SLG</th>
            <th>OPS</th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr>
              <td colSpan={5} className="muted">
                no qualifying hitters
              </td>
            </tr>
          )}
          {sorted.map((h) => (
            <tr key={h.id}>
              <td>
                <a
                  className="pitcher-link"
                  href={savantPlayerUrl(h.id)}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {h.name}
                </a>
              </td>
              {h.last10Ops != null ? (
                <>
                  <td>{formatSlashStat(h.last10Avg ?? 0)}</td>
                  <td>{formatSlashStat(h.last10Obp ?? 0)}</td>
                  <td>{formatSlashStat(h.last10Slg ?? 0)}</td>
                  <td>{formatSlashStat(h.last10Ops)}</td>
                </>
              ) : (
                <td colSpan={4} className="muted">
                  {h.gamesUsed}/10 G
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function H2HLine({
  homeAbbrev,
  awayAbbrev,
  h2h,
}: {
  homeAbbrev: string;
  awayAbbrev: string;
  h2h: MatchupResponse['h2hRecord'];
}) {
  const games = h2h.homeWins + h2h.awayWins;
  if (games === 0) {
    return (
      <div className="matchup-h2h muted mono">
        no head-to-head this season yet
      </div>
    );
  }
  const last = h2h.lastGameDate
    ? new Date(h2h.lastGameDate + 'T00:00:00').toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
      })
    : null;
  return (
    <div className="matchup-h2h mono">
      <strong>{homeAbbrev}</strong> {h2h.homeWins}-{h2h.awayWins} vs{' '}
      <strong>{awayAbbrev}</strong>
      {last && <span className="muted"> · last: {last}</span>}
    </div>
  );
}
