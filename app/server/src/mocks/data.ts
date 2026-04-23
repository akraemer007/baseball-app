// Realistic-shaped mock data for all API routes.
// Replace callsites one-by-one with real SQL queries via lib/warehouse.ts.

import type {
  Division,
  LeagueResponse,
  PlayerResponse,
  ProjectionsResponse,
  RecapsResponse,
  TeamResponse,
  TeamTrajectory,
} from '../../../shared/types.js';

// All 30 MLB teams keyed by abbreviation.
const TEAMS = {
  NYY: { id: 'NYY', abbrev: 'NYY', name: 'New York Yankees', color: '#003087' },
  BOS: { id: 'BOS', abbrev: 'BOS', name: 'Boston Red Sox', color: '#BD3039' },
  TB:  { id: 'TB',  abbrev: 'TB',  name: 'Tampa Bay Rays', color: '#8FBCE6' },
  TOR: { id: 'TOR', abbrev: 'TOR', name: 'Toronto Blue Jays', color: '#134A8E' },
  BAL: { id: 'BAL', abbrev: 'BAL', name: 'Baltimore Orioles', color: '#DF4601' },
  CWS: { id: 'CWS', abbrev: 'CWS', name: 'Chicago White Sox', color: '#C4CED4' },
  CLE: { id: 'CLE', abbrev: 'CLE', name: 'Cleveland Guardians', color: '#E50022' },
  DET: { id: 'DET', abbrev: 'DET', name: 'Detroit Tigers', color: '#FA4616' },
  KC:  { id: 'KC',  abbrev: 'KC',  name: 'Kansas City Royals', color: '#BD9B60' },
  MIN: { id: 'MIN', abbrev: 'MIN', name: 'Minnesota Twins', color: '#D31145' },
  HOU: { id: 'HOU', abbrev: 'HOU', name: 'Houston Astros', color: '#EB6E1F' },
  TEX: { id: 'TEX', abbrev: 'TEX', name: 'Texas Rangers', color: '#003278' },
  SEA: { id: 'SEA', abbrev: 'SEA', name: 'Seattle Mariners', color: '#005C5C' },
  LAA: { id: 'LAA', abbrev: 'LAA', name: 'Los Angeles Angels', color: '#BA0021' },
  OAK: { id: 'OAK', abbrev: 'OAK', name: 'Athletics', color: '#EFB21E' },
  ATL: { id: 'ATL', abbrev: 'ATL', name: 'Atlanta Braves', color: '#CE1141' },
  MIA: { id: 'MIA', abbrev: 'MIA', name: 'Miami Marlins', color: '#00A3E0' },
  NYM: { id: 'NYM', abbrev: 'NYM', name: 'New York Mets', color: '#FF5910' },
  PHI: { id: 'PHI', abbrev: 'PHI', name: 'Philadelphia Phillies', color: '#E81828' },
  WSH: { id: 'WSH', abbrev: 'WSH', name: 'Washington Nationals', color: '#AB0003' },
  CHC: { id: 'CHC', abbrev: 'CHC', name: 'Chicago Cubs', color: '#0E3386' },
  CIN: { id: 'CIN', abbrev: 'CIN', name: 'Cincinnati Reds', color: '#C6011F' },
  MIL: { id: 'MIL', abbrev: 'MIL', name: 'Milwaukee Brewers', color: '#FFC52F' },
  PIT: { id: 'PIT', abbrev: 'PIT', name: 'Pittsburgh Pirates', color: '#FDB827' },
  STL: { id: 'STL', abbrev: 'STL', name: 'St. Louis Cardinals', color: '#C41E3A' },
  ARI: { id: 'ARI', abbrev: 'ARI', name: 'Arizona Diamondbacks', color: '#A71930' },
  COL: { id: 'COL', abbrev: 'COL', name: 'Colorado Rockies', color: '#33006F' },
  LAD: { id: 'LAD', abbrev: 'LAD', name: 'Los Angeles Dodgers', color: '#005A9C' },
  SD:  { id: 'SD',  abbrev: 'SD',  name: 'San Diego Padres', color: '#FFC425' },
  SF:  { id: 'SF',  abbrev: 'SF',  name: 'San Francisco Giants', color: '#FD5A1E' },
} as const;

const DIVISIONS: Division[] = [
  { id: 'AL-EAST',    name: 'AL East',    league: 'AL', teams: [TEAMS.NYY, TEAMS.BOS, TEAMS.TB, TEAMS.TOR, TEAMS.BAL] },
  { id: 'AL-CENTRAL', name: 'AL Central', league: 'AL', teams: [TEAMS.CWS, TEAMS.CLE, TEAMS.DET, TEAMS.KC, TEAMS.MIN] },
  { id: 'AL-WEST',    name: 'AL West',    league: 'AL', teams: [TEAMS.HOU, TEAMS.TEX, TEAMS.SEA, TEAMS.LAA, TEAMS.OAK] },
  { id: 'NL-EAST',    name: 'NL East',    league: 'NL', teams: [TEAMS.ATL, TEAMS.MIA, TEAMS.NYM, TEAMS.PHI, TEAMS.WSH] },
  { id: 'NL-CENTRAL', name: 'NL Central', league: 'NL', teams: [TEAMS.CHC, TEAMS.CIN, TEAMS.MIL, TEAMS.PIT, TEAMS.STL] },
  { id: 'NL-WEST',    name: 'NL West',    league: 'NL', teams: [TEAMS.ARI, TEAMS.COL, TEAMS.LAD, TEAMS.SD, TEAMS.SF] },
];

// Deterministic PRNG so mock output is stable between requests.
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function hashSeed(...parts: (string | number)[]): number {
  let h = 2166136261;
  for (const p of parts) {
    const s = String(p);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildTrajectory(teamId: string, season: number, baselineSkill: number): TeamTrajectory {
  const rand = mulberry32(hashSeed(teamId, season));
  const points: TeamTrajectory['points'] = [];
  let w = 0;
  let l = 0;
  // MLB regular season: opening day ~March 26, 162 games over ~186 days, so
  // ~0.87 games/day (teams have scheduled off-days). For a current/in-flight
  // season, cap at how many games should have been played by today.
  const openingDay = new Date(`${season}-03-26T00:00:00Z`);
  const now = new Date();
  const daysInSeason = (now.getTime() - openingDay.getTime()) / (1000 * 60 * 60 * 24);
  const gamesToSimulate =
    now.getUTCFullYear() > season
      ? 162 // past season: full 162
      : Math.max(0, Math.min(162, Math.floor(daysInSeason * 0.87)));

  for (let game = 1; game <= gamesToSimulate; game++) {
    const streakModifier = Math.sin(game / 12 + (hashSeed(teamId) % 100)) * 0.03;
    const winProb = baselineSkill + streakModifier + (rand() - 0.5) * 0.08;
    if (rand() < winProb) w++;
    else l++;
    points.push({
      date: addDays(`${season}-03-26`, Math.round(game / 0.87)),
      wMinusL: w - l,
      gamesPlayed: game,
    });
  }
  return { teamId, points };
}

export function getLeague(season: number): LeagueResponse {
  const trajectory: TeamTrajectory[] = [];
  for (const div of DIVISIONS) {
    for (const team of div.teams) {
      const rand = mulberry32(hashSeed(team.id, season, 'skill'));
      const baselineSkill = 0.40 + rand() * 0.20; // per-team skill 40-60%
      trajectory.push(buildTrajectory(team.id, season, baselineSkill));
    }
  }
  return { season, divisions: DIVISIONS, trajectory };
}

/** Deterministic (wins, losses) for a given team+season in the mock world. */
function mockRecord(teamId: string, season: number): { wins: number; losses: number } {
  const r = mulberry32(hashSeed(teamId, season));
  const wins = 70 + Math.floor(r() * 25);
  const losses = 162 - wins - Math.floor(r() * 3);
  return { wins, losses };
}

export function getTeam(teamId: string, season: number): TeamResponse {
  const team =
    Object.values(TEAMS).find((t) => t.id.toUpperCase() === teamId.toUpperCase()) ||
    TEAMS.CHC;
  const rand = mulberry32(hashSeed(team.id, season));
  const { wins, losses } = mockRecord(team.id, season);
  const runDiff = Math.floor((rand() - 0.45) * 200);

  // Division leader → games behind
  const division = DIVISIONS.find((d) => d.teams.some((t) => t.id === team.id));
  let gamesBehind = 0;
  if (division) {
    const records = division.teams.map((t) => ({ t, ...mockRecord(t.id, season) }));
    const leader = records.reduce((best, r) =>
      r.wins - r.losses > best.wins - best.losses ? r : best,
    );
    gamesBehind = ((leader.wins - wins) + (losses - leader.losses)) / 2;
    if (gamesBehind < 0) gamesBehind = 0;
  }

  const percentileStats = (
    [
      ['OPS+', 'batting'],
      ['wRC+', 'batting'],
      ['BB%', 'batting'],
      ['K% (batters)', 'batting'],
      ['ERA-', 'pitching'],
      ['FIP-', 'pitching'],
      ['K/9', 'pitching'],
      ['BB/9', 'pitching'],
      ['DRS', 'fielding'],
      ['OAA', 'fielding'],
    ] as const
  ).map(([label, category]) => ({
    statKey: label.toLowerCase().replace(/[^a-z0-9]/g, '_'),
    label,
    value: Number((80 + rand() * 40).toFixed(1)),
    leagueRankPercentile: Math.floor(rand() * 100),
    category,
    leagueMean: 100, // All "plus" stats are indexed so 100 == league average.
  }));

  const recentGames = Array.from({ length: 10 }).map((_, i) => {
    const isHome = rand() > 0.5;
    const opp = Object.values(TEAMS)[Math.floor(rand() * 30)];
    const homeScore = Math.floor(rand() * 10);
    const awayScore = Math.floor(rand() * 10);
    return {
      gameId: `${team.id}-recent-${i}`,
      date: addDays(`${season}-09-15`, -i),
      homeTeamId: isHome ? team.id : opp.id,
      awayTeamId: isHome ? opp.id : team.id,
      homeScore,
      awayScore,
      isFinal: true,
      winnerTeamId:
        homeScore === awayScore
          ? null
          : homeScore > awayScore
            ? isHome
              ? team.id
              : opp.id
            : isHome
              ? opp.id
              : team.id,
    };
  });

  const upcomingGames = Array.from({ length: 5 }).map((_, i) => {
    const isHome = rand() > 0.5;
    const opp = Object.values(TEAMS)[Math.floor(rand() * 30)];
    return {
      gameId: `${team.id}-upcoming-${i}`,
      date: addDays(`${season}-09-16`, i),
      homeTeamId: isHome ? team.id : opp.id,
      awayTeamId: isHome ? opp.id : team.id,
      probableHomePitcherId: `p-${isHome ? team.id : opp.id}-sp${(i % 5) + 1}`,
      probableAwayPitcherId: `p-${isHome ? opp.id : team.id}-sp${(i % 5) + 1}`,
      impliedHomeWinProb: Number((0.4 + rand() * 0.2).toFixed(3)),
    };
  });

  return {
    season,
    team,
    record: {
      wins,
      losses,
      winPct: Number((wins / (wins + losses)).toFixed(3)),
      runDiff,
      gamesBehind,
    },
    streak: { type: rand() > 0.5 ? 'W' : 'L', length: 1 + Math.floor(rand() * 5) },
    percentileStats,
    recentGames,
    upcomingGames,
  };
}

export function getPlayer(playerId: string, season: number): PlayerResponse {
  const rand = mulberry32(hashSeed(playerId, season));
  const isPitcher = playerId.toLowerCase().startsWith('p-');
  const teamId = Object.values(TEAMS)[Math.floor(rand() * 30)].id;

  const seasonLine = isPitcher
    ? {
        playerId,
        playerName: `Pitcher ${playerId}`,
        teamId,
        position: 'SP',
        era: Number((2.5 + rand() * 3).toFixed(2)),
        whip: Number((1.0 + rand() * 0.5).toFixed(2)),
        so: Math.floor(100 + rand() * 150),
        ip: Number((120 + rand() * 80).toFixed(1)),
      }
    : {
        playerId,
        playerName: `Batter ${playerId}`,
        teamId,
        position: 'OF',
        avg: Number((0.22 + rand() * 0.1).toFixed(3)),
        obp: Number((0.3 + rand() * 0.1).toFixed(3)),
        slg: Number((0.4 + rand() * 0.15).toFixed(3)),
        ops: Number((0.7 + rand() * 0.25).toFixed(3)),
        hr: Math.floor(15 + rand() * 30),
        rbi: Math.floor(50 + rand() * 70),
        sb: Math.floor(rand() * 30),
      };

  const gameLog = Array.from({ length: 25 }).map((_, i) => {
    const date = addDays(`${season}-04-01`, i * 5);
    const opp = Object.values(TEAMS)[Math.floor(rand() * 30)].id;
    const isHome = rand() > 0.5;
    const line: Record<string, number | string | null> = isPitcher
      ? {
          ip: Number((4 + rand() * 4).toFixed(1)),
          h: Math.floor(rand() * 8),
          er: Math.floor(rand() * 5),
          bb: Math.floor(rand() * 4),
          so: Math.floor(rand() * 10),
        }
      : {
          ab: 3 + Math.floor(rand() * 3),
          h: Math.floor(rand() * 4),
          hr: rand() > 0.85 ? 1 : 0,
          rbi: Math.floor(rand() * 4),
          bb: Math.floor(rand() * 2),
          so: Math.floor(rand() * 3),
        };
    return {
      gameId: `${playerId}-g${i}`,
      date,
      opponentTeamId: opp,
      isHome,
      line,
    };
  });

  const cumulativeStat = isPitcher ? 'so' : 'hr';
  let running = 0;
  const cumulative = [
    {
      statKey: cumulativeStat,
      points: gameLog.map((g) => {
        running += Number(g.line[cumulativeStat] || 0);
        return { date: g.date, value: running };
      }),
    },
  ];

  const statcast = isPitcher
    ? {
        fastballVeloAvg: Number((92 + rand() * 5).toFixed(1)),
        spinRate: Math.floor(2200 + rand() * 400),
        whiffPct: Number((20 + rand() * 15).toFixed(1)),
      }
    : {
        exitVeloAvg: Number((87 + rand() * 6).toFixed(1)),
        exitVeloMax: Number((105 + rand() * 10).toFixed(1)),
        barrelPct: Number((5 + rand() * 10).toFixed(1)),
        hardHitPct: Number((35 + rand() * 15).toFixed(1)),
        chasePct: Number((22 + rand() * 10).toFixed(1)),
        whiffPct: Number((20 + rand() * 10).toFixed(1)),
        sprintSpeed: Number((25 + rand() * 4).toFixed(1)),
      };

  return { season, seasonLine, gameLog, cumulative, statcast };
}

/** Mock equivalent of gold_team_stat_vs_league — plausible values per team. */
export function getStatDistribution(stat: string, season: number) {
  const STAT_DEFS: Record<string, { label: string; range: [number, number]; lowerIsBetter?: boolean; decimals?: number }> = {
    run_diff: { label: 'Run Diff', range: [-40, 40], decimals: 0 },
    hits_total: { label: 'Hits', range: [150, 260], decimals: 0 },
    hr_total: { label: 'HR', range: [15, 45], decimals: 0 },
    walks_total: { label: 'BB', range: [60, 120], decimals: 0 },
    strikeouts_pitching_total: { label: 'K (pitching)', range: [150, 260], decimals: 0 },
    runs_per_game: { label: 'R/G', range: [2.8, 5.8] },
    hr_per_game: { label: 'HR/G', range: [0.5, 1.7] },
    avg: { label: 'AVG', range: [0.220, 0.280], decimals: 3 },
    obp: { label: 'OBP', range: [0.290, 0.360], decimals: 3 },
    slg: { label: 'SLG', range: [0.360, 0.470], decimals: 3 },
    ops: { label: 'OPS', range: [0.650, 0.820], decimals: 3 },
    ops_plus: { label: 'OPS+', range: [80, 125] },
    era: { label: 'ERA', range: [3.10, 5.30], lowerIsBetter: true },
    era_minus: { label: 'ERA-', range: [75, 125], lowerIsBetter: true },
    fip: { label: 'FIP', range: [3.20, 5.10], lowerIsBetter: true },
    k_per_9: { label: 'K/9', range: [6.5, 10.5] },
    errors_per_game: { label: 'E/G', range: [0.3, 0.8], lowerIsBetter: true },
  };
  const def = STAT_DEFS[stat] ?? STAT_DEFS.ops;
  const [lo, hi] = def.range;
  const decimals = def.decimals ?? 2;
  const entries = Object.values(TEAMS).map((t) => {
    const r = mulberry32(hashSeed(t.id, season, stat));
    const raw = lo + r() * (hi - lo);
    return {
      teamAbbrev: t.abbrev,
      teamName: t.name,
      teamColor: t.color,
      value: Number(raw.toFixed(decimals)),
      rank: 0, // filled in after sort
    };
  });
  entries.sort((a, b) => (def.lowerIsBetter ? a.value - b.value : b.value - a.value));
  entries.forEach((e, i) => (e.rank = i + 1));
  const mean = entries.reduce((s, e) => s + e.value, 0) / entries.length;
  return {
    season,
    statName: stat,
    statLabel: def.label,
    lowerIsBetter: !!def.lowerIsBetter,
    leagueMean: Number(mean.toFixed(decimals)),
    entries,
  };
}

export function getHrRace(season: number) {
  // Top 10 mock HR chasers. Each is a series of cumulative HR per game #.
  const leaderTeams = [
    'LAD', 'NYY', 'ATL', 'HOU', 'PHI', 'BAL', 'TEX', 'TOR', 'CHC', 'SD',
  ] as const;
  const leaders = leaderTeams.map((tid, i) => {
    const team = (TEAMS as Record<string, { id: string; abbrev: string; name: string; color: string }>)[tid];
    const rand = mulberry32(hashSeed(tid, season, 'hr'));
    const targetTotal = 28 + Math.floor(rand() * 30); // 28-58 HR chaser totals
    const points: { gameNum: number; cumulativeHr: number }[] = [];
    let hrs = 0;
    for (let g = 1; g <= 162; g++) {
      // HR hit probability calibrated to hit ~targetTotal by game 162.
      if (rand() < targetTotal / 162) hrs++;
      points.push({ gameNum: g, cumulativeHr: hrs });
    }
    return {
      playerId: `p-${tid}-bat${i + 1}`,
      playerName: `Slugger ${i + 1}`,
      teamId: tid,
      teamColor: team?.color ?? '#8fa3c0',
      points,
      seasonHrTotal: hrs,
    };
  });
  // Sort by total desc so the ranking looks realistic
  leaders.sort((a, b) => b.seasonHrTotal - a.seasonHrTotal);
  return { season, leaders };
}

export function getRecaps(date: string): RecapsResponse {
  const rand = mulberry32(hashSeed(date));
  const recaps = Array.from({ length: 8 }).map((_, i) => {
    const home = Object.values(TEAMS)[Math.floor(rand() * 30)];
    let away = Object.values(TEAMS)[Math.floor(rand() * 30)];
    if (away.id === home.id) away = Object.values(TEAMS)[(Math.floor(rand() * 30) + 1) % 30];
    const homeScore = Math.floor(rand() * 12);
    const awayScore = Math.floor(rand() * 12);
    const homeWins = homeScore > awayScore;
    const winner = homeWins ? home : away;
    const impliedWinProbOfWinner = Number((0.25 + rand() * 0.6).toFixed(3));
    const dateline = `${home.name.split(' ').slice(-1)[0].toUpperCase()} — `;
    const summary = 'A late-inning rally powers the win in a matchup decided by a single swing of the bat.';
    return {
      gameId: `${date}-${i}`,
      date,
      homeTeamId: home.id,
      awayTeamId: away.id,
      homeScore,
      awayScore,
      winnerTeamId: winner.id,
      impliedWinProbOfWinner,
      upsetFlag: impliedWinProbOfWinner < 0.4,
      headline: `${winner.name} top ${homeWins ? away.name : home.name}, ${Math.max(
        homeScore,
        awayScore
      )}-${Math.min(homeScore, awayScore)}`,
      dateline,
      summary,
      blurb: dateline + summary,
    };
  });
  return { date, recaps };
}

export function getProjections(): ProjectionsResponse {
  const today = new Date().toISOString().slice(0, 10);
  const rand = mulberry32(hashSeed(today));
  const games = Array.from({ length: 12 }).map((_, i) => {
    const home = Object.values(TEAMS)[Math.floor(rand() * 30)];
    let away = Object.values(TEAMS)[Math.floor(rand() * 30)];
    if (away.id === home.id) away = Object.values(TEAMS)[(Math.floor(rand() * 30) + 1) % 30];
    return {
      gameId: `${today}-proj-${i}`,
      date: today,
      homeTeamId: home.id,
      awayTeamId: away.id,
      probableHomePitcherId: `p-${home.id}-sp${(i % 5) + 1}`,
      probableAwayPitcherId: `p-${away.id}-sp${(i % 5) + 1}`,
      impliedHomeWinProb: Number((0.35 + rand() * 0.3).toFixed(3)),
    };
  });
  return { date: today, games };
}
