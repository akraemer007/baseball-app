import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import type { StatDistributionEntry } from '@shared/types';

interface Props {
  entries: StatDistributionEntry[];
  lowerIsBetter: boolean;
  leagueMean: number;
  /** The team whose page we're on — gets the biggest dot + label + dark outline. */
  currentTeamAbbrev: string;
  /** User's primary team — called out with a medium outline + label when it's
   *  different from the current team. */
  primaryTeamAbbrev?: string;
  /** User's secondary team — called out with a lighter medium outline + label
   *  when it's different from both the current and primary teams. */
  secondaryTeamAbbrev?: string;
  height?: number;
}

type FeatureKind = 'current' | 'primary' | 'secondary' | null;

/**
 * Strip-plot (one dot per team) along a horizontal axis of the stat value.
 * Up to three teams can be called out: the team whose page we're on
 * (current), the user's primary team, and the user's secondary team. Each
 * tier gets a distinct prominence so they're comparable at a glance.
 */
export function StatDistributionChart({
  entries,
  lowerIsBetter,
  leagueMean,
  currentTeamAbbrev,
  primaryTeamAbbrev,
  secondaryTeamAbbrev,
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

  // Pre-compute the feature tier for each team abbrev so the render loop
  // stays flat. current wins over primary wins over secondary.
  const featureKind = useMemo(() => {
    const cur = currentTeamAbbrev?.toUpperCase() ?? '';
    const pri = primaryTeamAbbrev?.toUpperCase() ?? '';
    const sec = secondaryTeamAbbrev?.toUpperCase() ?? '';
    return (abbrev: string): FeatureKind => {
      const u = abbrev.toUpperCase();
      if (u === cur) return 'current';
      if (u === pri) return 'primary';
      if (u === sec) return 'secondary';
      return null;
    };
  }, [currentTeamAbbrev, primaryTeamAbbrev, secondaryTeamAbbrev]);

  const layout = useMemo(() => {
    const margin = { top: 22, right: 28, bottom: 36, left: 28 };
    const innerW = Math.max(60, width - margin.left - margin.right);
    const innerH = Math.max(60, height - margin.top - margin.bottom);
    const vals = entries.map((e) => e.value);
    const minV = d3.min(vals) ?? 0;
    const maxV = d3.max(vals) ?? 1;
    const pad = (maxV - minV) * 0.08 || 0.1;
    const x = d3
      .scaleLinear()
      .domain([minV - pad, maxV + pad])
      .range(lowerIsBetter ? [innerW, 0] : [0, innerW]);
    const jitter = (abbrev: string) => {
      let h = 0;
      for (let i = 0; i < abbrev.length; i++) h = (h * 31 + abbrev.charCodeAt(i)) | 0;
      return ((h & 0xff) / 0xff - 0.5) * innerH * 0.6;
    };
    return { margin, innerW, innerH, x, jitter };
  }, [entries, width, height, lowerIsBetter]);

  const { margin, innerW, innerH, x, jitter } = layout;
  const midY = innerH / 2;
  const hoveredEntry = hovered != null ? entries[hovered] : null;

  return (
    <div ref={wrapRef} style={{ width: '100%', height, position: 'relative' }}>
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          <line
            x1={0}
            x2={innerW}
            y1={midY}
            y2={midY}
            stroke="rgba(10, 22, 40, 0.15)"
            strokeWidth={1}
          />

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

          {/* Dots (one per team) — featured teams render on top so they're
              never visually hidden behind another dot. */}
          {[...entries]
            .map((e, i) => ({ e, i, kind: featureKind(e.teamAbbrev) }))
            .sort((a, b) => {
              const order: Record<string, number> = {
                current: 4,
                primary: 3,
                secondary: 2,
              };
              return (order[a.kind ?? ''] ?? 1) - (order[b.kind ?? ''] ?? 1);
            })
            .map(({ e, i, kind }) => {
              const cy = midY + jitter(e.teamAbbrev);
              // Size + outline scale with tier.
              const { r, strokeWidth, strokeColor } = (() => {
                switch (kind) {
                  case 'current':
                    return { r: 7.5, strokeWidth: 2.5, strokeColor: '#0a1628' };
                  case 'primary':
                    return { r: 6.5, strokeWidth: 2, strokeColor: '#0a1628' };
                  case 'secondary':
                    return { r: 6, strokeWidth: 1.5, strokeColor: 'rgba(10, 22, 40, 0.55)' };
                  default:
                    return { r: 5, strokeWidth: 0.75, strokeColor: 'rgba(10, 22, 40, 0.35)' };
                }
              })();
              return (
                <g
                  key={e.teamAbbrev}
                  transform={`translate(${x(e.value)}, ${cy})`}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  style={{ cursor: 'pointer' }}
                >
                  <circle
                    r={r}
                    fill={e.teamColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    opacity={hovered != null && hovered !== i ? 0.35 : 0.95}
                  />
                  {(kind !== null || hovered === i) && (
                    <text
                      x={0}
                      y={-10}
                      textAnchor="middle"
                      fontSize={kind === 'current' ? 11 : 10}
                      fontFamily="var(--mono)"
                      fill="var(--text)"
                      fontWeight={kind === 'current' ? 700 : kind ? 600 : 500}
                    >
                      {e.teamAbbrev}
                    </text>
                  )}
                </g>
              );
            })}

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

      {hoveredEntry && (
        <div
          className="stat-dist-tooltip"
          style={{
            left: `${margin.left + x(hoveredEntry.value)}px`,
            top: `${margin.top + midY + jitter(hoveredEntry.teamAbbrev) - 48}px`,
          }}
        >
          <div
            className="mono"
            style={{ color: hoveredEntry.teamColor, fontWeight: 700 }}
          >
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

/**
 * Compact variant for use as a row-level sparkline. ~32 px tall, unlabeled,
 * no hover — the full `StatDistributionChart` above handles the detail view
 * on click. Same tier-based dot sizing so the visual language carries across.
 */
interface SparkProps {
  entries: StatDistributionEntry[];
  lowerIsBetter: boolean;
  leagueMean: number;
  currentTeamAbbrev: string;
  primaryTeamAbbrev?: string;
  secondaryTeamAbbrev?: string;
  height?: number;
}

export function StatDistributionSpark({
  entries,
  lowerIsBetter,
  leagueMean,
  currentTeamAbbrev,
  primaryTeamAbbrev,
  secondaryTeamAbbrev,
  height = 36,
}: SparkProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(400);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((es) => {
      for (const e of es) setWidth(Math.max(120, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const featureKind = useMemo(() => {
    const cur = currentTeamAbbrev?.toUpperCase() ?? '';
    const pri = primaryTeamAbbrev?.toUpperCase() ?? '';
    const sec = secondaryTeamAbbrev?.toUpperCase() ?? '';
    return (abbrev: string): FeatureKind => {
      const u = abbrev.toUpperCase();
      if (u === cur) return 'current';
      if (u === pri) return 'primary';
      if (u === sec) return 'secondary';
      return null;
    };
  }, [currentTeamAbbrev, primaryTeamAbbrev, secondaryTeamAbbrev]);

  const layout = useMemo(() => {
    // Leave a little headroom on top for the current-team label.
    const padX = 8;
    const padTop = 10;
    const padBottom = 2;
    const innerW = Math.max(60, width - padX * 2);
    const innerH = Math.max(12, height - padTop - padBottom);
    const vals = entries.map((e) => e.value);
    const minV = d3.min(vals) ?? 0;
    const maxV = d3.max(vals) ?? 1;
    const pad = (maxV - minV) * 0.08 || 0.1;
    const x = d3
      .scaleLinear()
      .domain([minV - pad, maxV + pad])
      .range(lowerIsBetter ? [innerW, 0] : [0, innerW]);
    return { padX, padTop, innerW, innerH, x };
  }, [entries, width, height, lowerIsBetter]);

  const { padX, padTop, innerW, innerH, x } = layout;
  const midY = innerH / 2;

  return (
    <div ref={wrapRef} style={{ width: '100%', height, position: 'relative' }}>
      <svg width={width} height={height}>
        <g transform={`translate(${padX}, ${padTop})`}>
          {/* Distribution baseline — a soft line everyone sits on so the
              strip reads as a single value axis, not a point cloud. */}
          <line
            x1={0}
            x2={innerW}
            y1={midY}
            y2={midY}
            stroke="rgba(10, 22, 40, 0.18)"
            strokeWidth={1}
          />
          <line
            x1={x(leagueMean)}
            x2={x(leagueMean)}
            y1={midY - 6}
            y2={midY + 6}
            stroke="rgba(10, 22, 40, 0.45)"
            strokeWidth={1}
            strokeDasharray="2 2"
          />

          {/* Non-featured teams: tiny, monochrome, sitting exactly on the
              baseline. They form a quiet distribution "haze" so the
              featured dots pop instead of competing. */}
          {entries
            .filter((e) => featureKind(e.teamAbbrev) === null)
            .map((e) => (
              <circle
                key={e.teamAbbrev}
                cx={x(e.value)}
                cy={midY}
                r={2}
                fill="rgba(60, 80, 110, 0.35)"
                stroke="none"
              />
            ))}

          {/* Featured teams: team-colored, bigger, stacked slightly off
              the baseline so overlapping ghost dots don't hide them.
              Current > primary > secondary in z-order. */}
          {[...entries]
            .map((e) => ({ e, kind: featureKind(e.teamAbbrev) }))
            .filter((x) => x.kind !== null)
            .sort((a, b) => {
              const order: Record<string, number> = {
                current: 3,
                primary: 2,
                secondary: 1,
              };
              return (order[a.kind ?? ''] ?? 0) - (order[b.kind ?? ''] ?? 0);
            })
            .map(({ e, kind }) => {
              const { r, strokeWidth, strokeColor, dy } = (() => {
                switch (kind) {
                  case 'current':
                    return {
                      r: 5,
                      strokeWidth: 1.75,
                      strokeColor: '#0a1628',
                      dy: -1,
                    };
                  case 'primary':
                    return {
                      r: 3.75,
                      strokeWidth: 1.25,
                      strokeColor: '#0a1628',
                      dy: 1,
                    };
                  case 'secondary':
                    return {
                      r: 3.25,
                      strokeWidth: 1,
                      strokeColor: 'rgba(10, 22, 40, 0.55)',
                      dy: 1.5,
                    };
                  default:
                    return {
                      r: 2,
                      strokeWidth: 0,
                      strokeColor: 'none',
                      dy: 0,
                    };
                }
              })();
              const cx = x(e.value);
              const cy = midY + dy;
              return (
                <g key={e.teamAbbrev}>
                  <circle
                    cx={cx}
                    cy={cy}
                    r={r}
                    fill={e.teamColor}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                  />
                  {kind === 'current' && (
                    <text
                      x={cx}
                      y={cy - r - 3}
                      textAnchor="middle"
                      fontSize={10}
                      fontFamily="var(--mono)"
                      fontWeight={700}
                      fill="var(--text)"
                    >
                      {e.teamAbbrev}
                    </text>
                  )}
                </g>
              );
            })}
        </g>
      </svg>
    </div>
  );
}
