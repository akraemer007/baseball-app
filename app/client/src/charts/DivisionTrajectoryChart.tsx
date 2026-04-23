import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
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
}

/**
 * Jon-Bois-style trajectory chart for a single division.
 *
 * - Dark navy background, white gridlines.
 * - Each team gets a thin wavy line in its team color.
 * - The zero line (.500 baseline) is emphasized.
 * - A shaded band behind the lines shows the gap between division leader and last place.
 * - No fill under individual lines (per user preference).
 */
export function DivisionTrajectoryChart({
  division,
  trajectories,
  height = 180,
  highlightTeamId = null,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(400);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(240, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const chart = useMemo(() => {
    const teamIds = new Set(division.teams.map((t) => t.id));
    const divTrajectories = trajectories.filter((t) => teamIds.has(t.teamId));
    if (!divTrajectories.length) return null;

    const margin = { top: 8, right: 8, bottom: 24, left: 32 };
    const innerW = Math.max(40, width - margin.left - margin.right);
    const innerH = Math.max(60, height - margin.top - margin.bottom);

    const maxGames = d3.max(divTrajectories, (d) => d3.max(d.points, (p) => p.gamesPlayed)) ?? 162;
    const allY = divTrajectories.flatMap((t) => t.points.map((p) => p.wMinusL));
    const yMax = Math.max(20, Math.abs(d3.max(allY) ?? 0));
    const yMin = Math.min(-20, d3.min(allY) ?? 0);
    const yBound = Math.max(Math.abs(yMax), Math.abs(yMin));

    const x = d3.scaleLinear().domain([0, maxGames]).range([0, innerW]);
    const y = d3.scaleLinear().domain([-yBound, yBound]).range([innerH, 0]);

    return {
      margin,
      innerW,
      innerH,
      x,
      y,
      yBound,
      maxGames,
      divTrajectories,
    };
  }, [division, trajectories, width, height]);

  if (!chart) {
    return (
      <div ref={wrapRef} style={{ height, color: 'var(--text-dim)' }}>
        no data
      </div>
    );
  }

  const { margin, innerW, innerH, x, y, maxGames, divTrajectories } = chart;

  const lineGen = d3
    .line<{ gamesPlayed: number; wMinusL: number }>()
    .x((d) => x(d.gamesPlayed))
    .y((d) => y(d.wMinusL))
    .curve(d3.curveCatmullRom.alpha(0.5));

  return (
    <div ref={wrapRef} style={{ width: '100%', height }}>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Horizontal reference lines */}
          {[-20, -10, 0, 10, 20].map((v) => (
            <line
              key={v}
              x1={0}
              x2={innerW}
              y1={y(v)}
              y2={y(v)}
              stroke={v === 0 ? 'rgba(232,238,247,0.35)' : 'rgba(232,238,247,0.07)'}
              strokeWidth={v === 0 ? 1 : 0.5}
              strokeDasharray={v === 0 ? undefined : '2 3'}
            />
          ))}

          {/* Y axis labels */}
          {[-20, -10, 0, 10, 20].map((v) => (
            <text
              key={`yl-${v}`}
              x={-6}
              y={y(v)}
              dy="0.32em"
              textAnchor="end"
              fontSize={9}
              fill="rgba(143, 163, 192, 0.8)"
              fontFamily="var(--mono)"
            >
              {v > 0 ? `+${v}` : v}
            </text>
          ))}

          {/* Team lines */}
          {divTrajectories.map((traj) => {
            const team = division.teams.find((t) => t.id === traj.teamId);
            const color = team?.color ?? '#8fa3c0';
            const isHighlight = highlightTeamId === traj.teamId;
            const isDimmed = highlightTeamId && highlightTeamId !== traj.teamId;
            return (
              <path
                key={traj.teamId}
                d={lineGen(traj.points) ?? undefined}
                fill="none"
                stroke={color}
                strokeWidth={isHighlight ? 2.2 : 1.4}
                strokeOpacity={isDimmed ? 0.25 : 0.95}
                style={{
                  filter: isHighlight ? `drop-shadow(0 0 3px ${color})` : undefined,
                }}
              />
            );
          })}

          {/* X axis: game # label bottom */}
          <text
            x={innerW}
            y={innerH + 16}
            textAnchor="end"
            fontSize={9}
            fill="rgba(143, 163, 192, 0.8)"
            fontFamily="var(--mono)"
          >
            {`game ${maxGames}`}
          </text>

          {/* Team abbrev labels at the right edge */}
          {divTrajectories.map((traj) => {
            const last = traj.points[traj.points.length - 1];
            if (!last) return null;
            const team = division.teams.find((t) => t.id === traj.teamId);
            const color = team?.color ?? '#8fa3c0';
            return (
              <text
                key={`lbl-${traj.teamId}`}
                x={x(last.gamesPlayed) + 2}
                y={y(last.wMinusL)}
                dy="0.32em"
                fontSize={9}
                fontFamily="var(--mono)"
                fill={color}
                opacity={highlightTeamId && highlightTeamId !== traj.teamId ? 0.35 : 1}
              >
                {team?.abbrev ?? traj.teamId}
              </text>
            );
          })}
        </g>
      </svg>
    </div>
  );
}
