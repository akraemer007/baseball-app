import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { StatDistributionEntry } from '@shared/types';

interface Props {
  entries: StatDistributionEntry[];
  lowerIsBetter: boolean;
  leagueMean: number;
  currentTeamAbbrev: string;
  height?: number;
}

/**
 * Strip-plot (one dot per team) along a horizontal axis of the stat value.
 * Cubs are always rendered blue (their primary color), the currently-viewed
 * team gets a bright outline + permanent label, every other team shows its
 * team color. Hover any dot for a tooltip with team name, value, and rank.
 */
export function StatDistributionChart({
  entries,
  lowerIsBetter,
  leagueMean,
  currentTeamAbbrev,
  height = 140,
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
    const margin = { top: 22, right: 28, bottom: 36, left: 28 };
    const innerW = Math.max(60, width - margin.left - margin.right);
    const innerH = Math.max(60, height - margin.top - margin.bottom);
    const vals = entries.map((e) => e.value);
    const minV = d3.min(vals) ?? 0;
    const maxV = d3.max(vals) ?? 1;
    const pad = (maxV - minV) * 0.08 || 0.1;
    // For stats where lower values are better (ERA, FIP, errors/game), flip
    // the axis so "better" is always on the right side of every chart.
    const x = d3
      .scaleLinear()
      .domain([minV - pad, maxV + pad])
      .range(lowerIsBetter ? [innerW, 0] : [0, innerW]);
    // Stagger dots vertically when they cluster by jittering with a deterministic
    // hash of the abbrev so the layout stays stable across renders.
    const jitter = (abbrev: string) => {
      let h = 0;
      for (let i = 0; i < abbrev.length; i++) h = (h * 31 + abbrev.charCodeAt(i)) | 0;
      return ((h & 0xff) / 0xff - 0.5) * innerH * 0.6;
    };
    return { margin, innerW, innerH, x, jitter };
  }, [entries, width, height]);

  const { margin, innerW, innerH, x, jitter } = layout;
  const midY = innerH / 2;
  const hoveredEntry = hovered != null ? entries[hovered] : null;

  return (
    <div ref={wrapRef} style={{ width: '100%', height, position: 'relative' }}>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Baseline axis */}
          <line
            x1={0}
            x2={innerW}
            y1={midY}
            y2={midY}
            stroke="rgba(10, 22, 40, 0.15)"
            strokeWidth={1}
          />

          {/* League-mean tick */}
          <g transform={`translate(${x(leagueMean)}, 0)`}>
            <line
              y1={0}
              y2={innerH}
              stroke="rgba(10, 22, 40, 0.45)"
              strokeWidth={1}
              strokeDasharray="2 3"
            />
            <text
              x={0}
              y={-8}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--mono)"
              fill="rgba(60, 80, 110, 0.85)"
            >
              lg avg {leagueMean.toFixed(leagueMean < 1 ? 3 : 2)}
            </text>
          </g>

          {/* Dots (one per team) */}
          {entries.map((e, i) => {
            const isCurrent = e.teamAbbrev === currentTeamAbbrev;
            const isCubs = e.teamAbbrev === 'CHC';
            const fill = isCubs ? '#0E3386' : e.teamColor;
            const cy = midY + jitter(e.teamAbbrev);
            return (
              <g
                key={e.teamAbbrev}
                transform={`translate(${x(e.value)}, ${cy})`}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
                style={{ cursor: 'pointer' }}
              >
                <circle
                  r={isCurrent ? 7 : 5}
                  fill={fill}
                  stroke={isCurrent ? '#0a1628' : 'rgba(10, 22, 40, 0.35)'}
                  strokeWidth={isCurrent ? 2.5 : 0.75}
                  opacity={hovered != null && hovered !== i ? 0.35 : 0.95}
                />
                {(isCurrent || hovered === i) && (
                  <text
                    x={0}
                    y={-10}
                    textAnchor="middle"
                    fontSize={10}
                    fontFamily="var(--mono)"
                    fill="var(--text)"
                    fontWeight={600}
                  >
                    {e.teamAbbrev}
                  </text>
                )}
              </g>
            );
          })}

          {/* Axis labels: better always on the right, worse always on the left. */}
          <text
            x={0}
            y={innerH + 22}
            textAnchor="start"
            fontSize={9}
            fontFamily="var(--mono)"
            fill="rgba(60, 80, 110, 0.8)"
            style={{ textTransform: 'uppercase' }}
          >
            ← worse
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
            better →
          </text>
        </g>
      </svg>

      {/* Hover tooltip */}
      {hoveredEntry && (
        <div
          className="stat-dist-tooltip"
          style={{
            left: `${margin.left + x(hoveredEntry.value)}px`,
            top: `${margin.top + midY + jitter(hoveredEntry.teamAbbrev) - 48}px`,
          }}
        >
          <div className="mono" style={{ color: hoveredEntry.teamAbbrev === 'CHC' ? '#6ea0ff' : hoveredEntry.teamColor, fontWeight: 700 }}>
            {hoveredEntry.teamAbbrev}
          </div>
          <div>{hoveredEntry.teamName}</div>
          <div className="muted mono" style={{ fontSize: '0.7rem' }}>
            {hoveredEntry.value} · rank {hoveredEntry.rank}
          </div>
        </div>
      )}
    </div>
  );
}
