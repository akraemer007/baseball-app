import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { usePreferences } from '../lib/preferences';
import { CumulativeRaceChart, type RaceSeries } from '../charts/CumulativeRaceChart';
import type { HrRaceEntry, HrRaceResponse } from '@shared/types';

/** How many league leaders always show, before primary/secondary team
 *  reps get added. */
const TOP_N = 5;

/** Pick the (n+1)-th player on a given team, where n is the count of
 *  that team's players already in `baseSet`. Returns undefined if the
 *  team doesn't appear in `all` with enough depth. */
function pickTeamRep(
  all: HrRaceEntry[],
  baseSet: HrRaceEntry[],
  teamAbbrev: string,
): HrRaceEntry | undefined {
  const t = teamAbbrev.toUpperCase();
  const alreadyIn = baseSet.filter((p) => p.teamId.toUpperCase() === t).length;
  const teamRanked = all.filter((p) => p.teamId.toUpperCase() === t);
  return teamRanked[alreadyIn];
}

export default function PlayersPage() {
  const season = new Date().getUTCFullYear();
  const { primaryTeam, secondaryTeam } = usePreferences();

  const hrQ = useQuery<HrRaceResponse>({
    queryKey: ['hr-race', season],
    queryFn: () => apiGet<HrRaceResponse>(`/api/league/hr-race?season=${season}`),
  });

  const { renderSet, featuredIds } = useMemo(() => {
    const all = hrQ.data?.leaders ?? [];
    if (all.length === 0) return { renderSet: [], featuredIds: [] as string[] };

    // `all` is expected to be sorted by seasonHrTotal desc from the
    // warehouse, but sort defensively so selection logic stays correct
    // even if that changes.
    const sorted = [...all].sort((a, b) => b.seasonHrTotal - a.seasonHrTotal);
    const top = sorted.slice(0, TOP_N);
    const set = [...top];
    const featured: string[] = [];

    const primaryRep = pickTeamRep(sorted, top, primaryTeam);
    if (primaryRep && !set.some((p) => p.playerId === primaryRep.playerId)) {
      set.push(primaryRep);
      featured.push(primaryRep.playerId);
    }
    const secondaryRep = pickTeamRep(sorted, set, secondaryTeam);
    if (secondaryRep && !set.some((p) => p.playerId === secondaryRep.playerId)) {
      set.push(secondaryRep);
      featured.push(secondaryRep.playerId);
    }
    return { renderSet: set, featuredIds: featured };
  }, [hrQ.data, primaryTeam, secondaryTeam]);

  const series: RaceSeries[] = useMemo(
    () =>
      renderSet.map((p) => ({
        id: p.playerId,
        label: `${p.teamId} ${p.playerName} (${p.seasonHrTotal})`,
        color: p.teamColor,
        mlbamId: p.playerId,
        points: p.points.map((pt) => ({ x: pt.gameNum, y: pt.cumulativeHr })),
      })),
    [renderSet],
  );

  return (
    <div className="page">
      <h1>Players</h1>
      <p className="muted">
        Season leaders and how they got there.{' '}
        <span className="mono">{season}</span>.
      </p>

      <div className="card">
        <h3>Home-run race</h3>
        {hrQ.isLoading && <p className="muted">Loading HR race…</p>}
        {hrQ.error && (
          <p className="muted">Failed to load HR race.</p>
        )}
        {hrQ.data && renderSet.length === 0 && (
          <p className="muted">No HR data yet for {season}.</p>
        )}
        {renderSet.length > 0 && (
          <CumulativeRaceChart
            series={series}
            featuredIds={featuredIds}
            fadePeers={false}
            yLabel="HR"
            xLabel="game"
            height={420}
          />
        )}
      </div>
    </div>
  );
}
