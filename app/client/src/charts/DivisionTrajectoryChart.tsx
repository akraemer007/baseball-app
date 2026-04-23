import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { useNavigate } from 'react-router-dom';
import type { Division, TeamTrajectory } from '@shared/types';

interface Props {
  division: Division;
  trajectories: TeamTrajectory[];
  height?: number;
  /**
   * When set, this team's line is rendered at full opacity on top;
   * the rest fade back. Pass null to render all equally.
   */
  highlightTeamId?: string | null;
  /** Optional external hover setter so the parent can sync with team chips. */
  onHoverTeam?: (teamId: string | null) => void;
}

/**
 * Trajectory chart for a single division: W-L above .500 vs. games played.
 * - Each team line is clickable and routes to that team's page.
 * - Hovering a line fattens it and dims the others; the labels stay readable.
 * - End-of-line labels are pushed apart vertically so they never overlap.
 */
export function DivisionTrajectoryChart({
  division,
  trajectories,
  height = 180,
  highlightTeamId = null,
  onHoverTeam,
}: Props) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(400);
  const [internalHover, setInternalHover] = useState<string | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(240, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const activeHover = internalHover ?? highlightTeamId;

  const chart = useMemo(() => {
    const teamIds = new Set(division.teams.map((t) => t.id));
    const divTrajectories = trajectories.filter((t) => teamIds.has(t.teamId));
    if (!divTrajectories.length) return null;

    const margin = { top: 10, right: 40, bottom: 26, left: 36 };
    const innerW = Math.max(40, width - margin.left - margin.right);
    const innerH = Math.max(60, height - margin.top - margin.bottom);

    const maxGames =
      d3.max(divTrajectories, (d) => d3.max(d.points, (p) => p.gamesPlayed)) ?? 162;
    const allY = divTrajectories.flatMap((t) => t.points.map((p) => p.wMinusL));
    const absMax = Math.max(
      3,
      Math.abs(d3.max(allY) ?? 0),
      Math.abs(d3.min(allY) ?? 0),
    );
    const yBound = Math.ceil(absMax * 1.15);

    const x = d3.scaleLinear().domain([0, maxGames]).range([0, innerW]);
    const y = d3.scaleLinear().domain([-yBound, yBound]).range([innerH, 0]);

    const rawTicks = y.ticks(5);
    const yTicks = Array.from(new Set(rawTicks.concat([0]))).sort((a, b) => a - b);

    // Compute end-of-line positions for each team, then resolve vertical
    // overlaps by pushing labels apart. Keep a link from each label back to
    // its anchor point so we can draw a leader line when a label is shifted.
    const LABEL_FS = 12; // px
    const MIN_GAP = LABEL_FS + 2;
    type LabelRow = { teamId: string; anchorY: number; labelY: number };
    const labelRows: LabelRow[] = divTrajectories
      .map((t) => {
        const last = t.points[t.points.length - 1];
        return last
          ? { teamId: t.teamId, anchorY: y(last.wMinusL), labelY: y(last.wMinusL) }
          : null;
      })
      .filter((r): r is LabelRow => r !== null)
      .sort((a, b) => a.anchorY - b.anchorY);

    for (let i = 1; i < labelRows.length; i++) {
      const prev = labelRows[i - 1];
      const cur = labelRows[i];
      if (cur.labelY - prev.labelY < MIN_GAP) {
        cur.labelY = prev.labelY + MIN_GAP;
      }
    }
    // Also clamp so labels stay within the plot's vertical bounds
    for (const r of labelRows) {
      r.labelY = Math.min(innerH - 2, Math.max(LABEL_FS, r.labelY));
    }
    const labelByTeam = new Map(labelRows.map((r) => [r.teamId, r]));

    return { margin, innerW, innerH, x, y, yTicks, maxGames, divTrajectories, labelByTeam, LABEL_FS };
  }, [division, trajectories, width, height]);

  if (!chart) {
    return (
      <div ref={wrapRef} style={{ height, color: 'var(--text-dim)' }}>
        no data
      </div>
    );
  }

  const { margin, innerW, innerH, x, y, yTicks, maxGames, divTrajectories, labelByTeam, LABEL_FS } = chart;

  const lineGen = d3
    .line<{ gamesPlayed: number; wMinusL: number }>()
    .x((d) => x(d.gamesPlayed))
    .y((d) => y(d.wMinusL))
    .curve(d3.curveCatmullRom.alpha(0.5));

  const handleHover = (teamId: string | null) => {
    setInternalHover(teamId);
    onHoverTeam?.(teamId);
  };

  // Render non-active teams first so the hovered/highlighted team stacks on top.
  const sortedByZ = [...divTrajectories].sort((a, b) => {
    const aActive = a.teamId === activeHover ? 1 : 0;
    const bActive = b.teamId === activeHover ? 1 : 0;
    return aActive - bActive;
  });

  return (
    <div ref={wrapRef} style={{ width: '100%', height }}>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Horizontal reference lines */}
          {yTicks.map((v) => (
            <line
              key={v}
              x1={0}
              x2={innerW}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? 'rgba(10, 22, 40, 0.45)' : 'rgba(10, 22, 40, 0.1)'}
              strokeWidth={v === 0 ? 1 : 0.5}
              strokeDasharray={v === 0 ? undefined : '2 3'}
            />
          ))}

          {/* Y axis labels */}
          {yTicks.map((v) => (
            <text
              key={`yl-${v}`}
              x={-6}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              fontSize={9}
              fill="rgba(60, 80, 110, 0.85)"
              fontFamily="var(--mono)"
            >
              {v > 0 ? `+${v}` : v}
            </text>
          ))}

          {/* Team lines + labels (grouped so they're clickable) */}
          {sortedByZ.map((traj) => {
            const team = division.teams.find((t) => t.id === traj.teamId);
            const color = team?.color ?? '#8fa3c0';
            const isActive = activeHover === traj.teamId;
            const isDimmed = activeHover && activeHover !== traj.teamId;
            const label = labelByTeam.get(traj.teamId);
            const last = traj.points[traj.points.length - 1];
            return (
              <g
                key={traj.teamId}
                style={{ cursor: 'pointer' }}
                onMouseEnter={() => handleHover(traj.teamId)}
                onMouseLeave={() => handleHover(null)}
                onClick={() => navigate(`/team/${traj.teamId}`)}
              >
                {/* Wide invisible hit-line for easy hovering */}
                <path
                  d={lineGen(traj.points) ?? undefined}
                  fill="none"
                  stroke="transparent"
                  strokeWidth={14}
                />
                {/* Visible line */}
                <path
                  d={lineGen(traj.points) ?? undefined}
                  fill="none"
                  stroke={color}
                  strokeWidth={isActive ? 3.4 : 2.2}
                  strokeOpacity={isDimmed ? 0.22 : 0.98}
                  style={{
                    filter: isActive ? `drop-shadow(0 0 4px ${color})` : undefined,
                  }}
                />
                {/* Leader line from line end to the shifted label (if any) */}
                {last && label && Math.abs(label.labelY - label.anchorY) > 1 && (
                  <line
                    x1={x(last.gamesPlayed)}
                    y1={label.anchorY}
                    x2={x(last.gamesPlayed) + 4}
                    y2={label.labelY}
                    stroke={color}
                    strokeWidth={0.75}
                    strokeOpacity={isDimmed ? 0.25 : 0.6}
                  />
                )}
                {/* Team abbrev label at the (possibly shifted) end position */}
                {last && label && (
                  <text
                    x={x(last.gamesPlayed) + 6}
                    y={label.labelY}
                    dy="0.32em"
                    fontSize={LABEL_FS}
                    fontFamily="var(--mono)"
                    fontWeight={isActive ? 700 : 600}
                    fill={color}
                    opacity={isDimmed ? 0.4 : 1}
                  >
                    {team?.abbrev ?? traj.teamId}
                  </text>
                )}
              </g>
            );
          })}

          {/* X axis: game # label bottom */}
          <text
            x={innerW}
            y={innerH + 16}
            textAnchor="end"
            fontSize={9}
            fill="rgba(60, 80, 110, 0.85)"
            fontFamily="var(--mono)"
          >
            {`game ${maxGames}`}
          </text>
        </g>
      </svg>
    </div>
  );
}
