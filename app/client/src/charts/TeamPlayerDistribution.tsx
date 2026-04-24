import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { savantPlayerUrl } from '../lib/savant';
import { formatStat } from '../lib/stats';
import type { TeamPlayerDistributionEntry } from '@shared/types';

interface Props {
  entries: TeamPlayerDistributionEntry[];
  lowerIsBetter: boolean;
  /** Reference line — the team's aggregate value for this stat. */
  teamValue: number;
  /** Team color used for every dot (all players on the same team). */
  teamColor: string;
  side: 'hitter' | 'pitcher';
  statKey?: string;
  /** Override the computed [min, max] value-axis domain. Used to share the
   *  x-scale with the team-level chart above so the team's tick lines up
   *  at the same x in both charts. */
  xDomain?: [number, number];
  height?: number;
}

/**
 * Strip plot of a single team's qualifying players for a given stat.
 * Jitters labels above / below the baseline alternately so 10-20 names
 * don't collide. A dashed tick marks the team's own aggregate value so
 * you can read "who's above / below team average." Labels and dots
 * link to each player's Savant profile.
 */
export function TeamPlayerDistribution({
  entries,
  lowerIsBetter,
  teamValue,
  teamColor,
  side,
  statKey,
  xDomain,
  height = 130,
}: Props) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);
  const [hovered, setHovered] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((es) => {
      for (const e of es) setWidth(Math.max(280, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const layout = useMemo(() => {
    const margin = { top: 22, right: 24, bottom: 36, left: 24 };
    const innerW = Math.max(60, width - margin.left - margin.right);
    const innerH = Math.max(60, height - margin.top - margin.bottom);
    let domain: [number, number];
    if (xDomain) {
      domain = xDomain;
    } else {
      const vals = entries.map((e) => e.value);
      const minV = Math.min(teamValue, d3.min(vals) ?? 0);
      const maxV = Math.max(teamValue, d3.max(vals) ?? 1);
      const pad = (maxV - minV) * 0.12 || 0.1;
      domain = [minV - pad, maxV + pad];
    }
    const x = d3
      .scaleLinear()
      .domain(domain)
      .range(lowerIsBetter ? [innerW, 0] : [0, innerW]);
    return { margin, innerW, innerH, x };
  }, [entries, width, height, lowerIsBetter, teamValue, xDomain]);

  const { margin, innerW, innerH, x } = layout;
  const midY = innerH / 2;
  const hoveredEntry = hovered != null ? entries[hovered] : null;

  // Alternate labels above / below the baseline to reduce collisions.
  const labelSide = (i: number): 'above' | 'below' => (i % 2 === 0 ? 'above' : 'below');

  const teamValueLabel = formatStat(teamValue, statKey);

  return (
    <div ref={wrapRef} style={{ width: '100%', height, position: 'relative' }}>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          <line
            x1={0}
            x2={innerW}
            y1={midY}
            y2={midY}
            stroke="rgba(10, 22, 40, 0.2)"
            strokeWidth={1}
          />

          {/* Team-value reference tick */}
          <g transform={`translate(${x(teamValue)}, 0)`}>
            <line
              y1={0}
              y2={innerH}
              stroke="rgba(10, 22, 40, 0.5)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={0}
              y={-8}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--mono)"
              fill="rgba(60, 80, 110, 0.85)"
            >
              team {teamValueLabel}
            </text>
          </g>

          {/* Player dots + labels */}
          {entries.map((e, i) => {
            const cx = x(e.value);
            const side = labelSide(i);
            const labelY = side === 'above' ? -8 : 18;
            const isHover = hovered === i;
            // Last name only, so labels stay tight.
            const parts = e.playerName.trim().split(/\s+/);
            const last = parts.length > 1 ? parts.slice(1).join(' ') : parts[0];
            return (
              <g
                key={e.playerId}
                transform={`translate(${cx}, ${midY})`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
                onClick={() => window.open(savantPlayerUrl(e.playerId), '_blank', 'noopener,noreferrer')}
              >
                <circle
                  r={5.5}
                  fill={teamColor}
                  stroke="#0a1628"
                  strokeWidth={isHover ? 2 : 1.25}
                  opacity={hovered != null && !isHover ? 0.5 : 1}
                />
                <text
                  x={0}
                  y={labelY}
                  textAnchor="middle"
                  fontSize={10}
                  fontFamily="var(--mono)"
                  fontWeight={isHover ? 700 : 500}
                  fill="var(--text)"
                  style={{ pointerEvents: 'none' }}
                >
                  {last}
                </text>
              </g>
            );
          })}

          {/* Axis hint */}
          <text
            x={0}
            y={innerH + 22}
            textAnchor="start"
            fontSize={9}
            fontFamily="var(--mono)"
            fill="rgba(60, 80, 110, 0.8)"
            style={{ textTransform: 'uppercase' }}
          >
            {lowerIsBetter ? 'better →' : '← worse'}
          </text>
          <text
            x={innerW}
            y={innerH + 22}
            textAnchor="end"
            fontSize={9}
            fontFamily="var(--mono)"
            fill="rgba(60, 80, 110, 0.8)"
            style={{ textTransform: 'uppercase' }}
          >
            {lowerIsBetter ? '← worse' : 'better →'}
          </text>
        </g>
      </svg>

      {hoveredEntry && (
        <div
          className="stat-dist-tooltip"
          style={{
            left: `${margin.left + x(hoveredEntry.value)}px`,
            top: `${margin.top + midY - 60}px`,
          }}
        >
          <div className="mono" style={{ color: '#ffffff', fontWeight: 700 }}>
            {hoveredEntry.playerName}
          </div>
          <div className="mono" style={{ fontSize: '0.7rem', color: '#cbd4e0' }}>
            {formatStat(hoveredEntry.value, statKey)} ·{' '}
            {side === 'hitter'
              ? `${hoveredEntry.playingTime} AB`
              : `${hoveredEntry.playingTime} IP`}
          </div>
        </div>
      )}
    </div>
  );
}
