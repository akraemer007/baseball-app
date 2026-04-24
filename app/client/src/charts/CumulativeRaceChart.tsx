import { useMemo, useRef, useEffect, useState } from 'react';
import * as d3 from 'd3';
import { savantPlayerUrl } from '../lib/savant';

export interface RaceSeries {
  id: string;
  label: string;
  color?: string;
  /** Array of {x, y} where x is game number (or any monotonic index) and y is cumulative value */
  points: { x: number; y: number }[];
  /** MLBAM id — if present, the right-edge label becomes a Savant-player anchor. */
  mlbamId?: string;
}

interface Props {
  series: RaceSeries[];
  height?: number;
  yLabel?: string;
  xLabel?: string;
  /** Series id to render in the foreground (highlighted). Others fade to grey. */
  highlightId?: string | null;
  /**
   * Extra ids to render with a thicker stroke (without the halo that
   * `highlightId` applies). Useful when multiple lines are "more
   * important than the rest" but no one line is the single focus.
   */
  featuredIds?: string[];
  /**
   * Whether non-highlighted series fade to grey. Default true preserves
   * per-player-page semantics. Pass false on landing/overview pages where
   * every line is relevant — each series then renders in its own color.
   */
  fadePeers?: boolean;
  /** Title rendered above the chart (optional) */
  title?: string;
}

/**
 * Maris-style cumulative race chart.
 *
 * - X: game-number index (usually 1..162).
 * - Y: cumulative stat value.
 * - Each series is a step-line in its color. Highlighted series renders last and glows.
 * - Step-after curve so the reader sees exactly when a player hit the next milestone.
 */
export function CumulativeRaceChart({
  series,
  height = 320,
  yLabel,
  xLabel = 'game',
  highlightId = null,
  featuredIds,
  fadePeers = true,
  title,
}: Props) {
  const featuredSet = useMemo(() => new Set(featuredIds ?? []), [featuredIds]);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(600);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(Math.max(320, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const chart = useMemo(() => {
    if (!series.length) return null;
    const margin = { top: 16, right: 60, bottom: 28, left: 40 };
    const innerW = Math.max(60, width - margin.left - margin.right);
    const innerH = Math.max(120, height - margin.top - margin.bottom);

    const maxX = d3.max(series, (s) => d3.max(s.points, (p) => p.x)) ?? 162;
    const maxY = d3.max(series, (s) => d3.max(s.points, (p) => p.y)) ?? 1;

    const x = d3.scaleLinear().domain([0, maxX]).range([0, innerW]);
    const y = d3.scaleLinear().domain([0, maxY * 1.05]).nice().range([innerH, 0]);

    const xTicks = x.ticks(Math.min(6, Math.floor(innerW / 80)));
    const yTicks = y.ticks(Math.min(6, Math.floor(innerH / 45)));

    // Featured / highlighted series render last so they sit on top.
    // Order: peers < featured < highlight.
    const rank = (id: string) =>
      id === highlightId ? 2 : featuredSet.has(id) ? 1 : 0;
    const sorted = [...series].sort((a, b) => rank(a.id) - rank(b.id));

    return { margin, innerW, innerH, x, y, xTicks, yTicks, sorted };
  }, [series, width, height, highlightId, featuredSet]);

  if (!chart) {
    return (
      <div ref={wrapRef} style={{ height, color: 'var(--text-dim)' }}>
        no data
      </div>
    );
  }

  const { margin, innerW, innerH, x, y, xTicks, yTicks, sorted } = chart;

  const lineGen = d3
    .line<{ x: number; y: number }>()
    .x((d) => x(d.x))
    .y((d) => y(d.y))
    .curve(d3.curveStepAfter);

  return (
    <div ref={wrapRef} style={{ width: '100%', height }}>
      {title && (
        <div
          style={{
            fontFamily: 'var(--mono)',
            color: 'var(--text-dim)',
            fontSize: 12,
            letterSpacing: '0.05em',
            textTransform: 'uppercase',
            marginBottom: 4,
          }}
        >
          {title}
        </div>
      )}
      <svg width={width} height={height}>
        <g transform={`translate(${margin.left}, ${margin.top})`}>
          {/* Y gridlines */}
          {yTicks.map((t) => (
            <g key={`yg-${t}`}>
              <line
                x1={0}
                x2={innerW}
                y1={y(t)}
                y2={y(t)}
                stroke="rgba(10, 22, 40, 0.1)"
                strokeWidth={0.5}
              />
              <text
                x={-6}
                y={y(t)}
                dy="0.32em"
                textAnchor="end"
                fontSize={10}
                fontFamily="var(--mono)"
                fill="rgba(60, 80, 110, 0.85)"
              >
                {t}
              </text>
            </g>
          ))}

          {/* X ticks */}
          {xTicks.map((t) => (
            <g key={`xg-${t}`}>
              <line
                x1={x(t)}
                x2={x(t)}
                y1={0}
                y2={innerH}
                stroke="rgba(10, 22, 40, 0.06)"
                strokeWidth={0.5}
              />
              <text
                x={x(t)}
                y={innerH + 14}
                textAnchor="middle"
                fontSize={10}
                fontFamily="var(--mono)"
                fill="rgba(60, 80, 110, 0.85)"
              >
                {t}
              </text>
            </g>
          ))}

          {/* Series lines */}
          {sorted.map((s) => {
            const isHighlight = highlightId === s.id;
            const isFeatured = !isHighlight && featuredSet.has(s.id);
            const color = s.color ?? '#8fa3c0';
            // When fading is off, every peer keeps its own color (just at
            // normal weight). When fading is on, peers wash to grey.
            const strokeColor = isHighlight || isFeatured
              ? color
              : fadePeers
                ? 'rgba(60, 80, 110, 0.35)'
                : color;
            const strokeWidth = isHighlight ? 2.4 : isFeatured ? 2 : 1.25;
            return (
              <path
                key={s.id}
                d={lineGen(s.points) ?? undefined}
                fill="none"
                stroke={strokeColor}
                strokeWidth={strokeWidth}
                opacity={isHighlight || isFeatured || !fadePeers ? 1 : 0.8}
                style={{
                  filter: isHighlight ? `drop-shadow(0 0 4px ${color})` : undefined,
                }}
              />
            );
          })}

          {/* Right-edge labels. When the series carries an mlbamId the
              label becomes a Savant-player anchor. */}
          {sorted.map((s) => {
            const last = s.points[s.points.length - 1];
            if (!last) return null;
            const isHighlight = highlightId === s.id;
            const isFeatured = !isHighlight && featuredSet.has(s.id);
            const color = s.color ?? '#8fa3c0';
            const fill = isHighlight || isFeatured
              ? color
              : fadePeers
                ? 'rgba(60, 80, 110, 0.55)'
                : color;
            const fontWeight = isHighlight ? 700 : isFeatured ? 600 : 500;
            const textEl = (
              <text
                x={x(last.x) + 4}
                y={y(last.y)}
                dy="0.32em"
                fontSize={10}
                fontFamily="var(--mono)"
                fill={fill}
                fontWeight={fontWeight}
                style={{ cursor: s.mlbamId ? 'pointer' : undefined }}
              >
                {s.label}
              </text>
            );
            if (!s.mlbamId) {
              return <g key={`lbl-${s.id}`}>{textEl}</g>;
            }
            return (
              <a
                key={`lbl-${s.id}`}
                href={savantPlayerUrl(s.mlbamId)}
                target="_blank"
                rel="noopener noreferrer"
              >
                {textEl}
              </a>
            );
          })}

          {/* Axis labels */}
          {yLabel && (
            <text
              x={-innerH / 2}
              y={-28}
              transform="rotate(-90)"
              textAnchor="middle"
              fontSize={10}
              fontFamily="var(--mono)"
              fill="rgba(60, 80, 110, 0.85)"
              style={{ textTransform: 'uppercase' }}
            >
              {yLabel}
            </text>
          )}
          <text
            x={innerW}
            y={innerH + 22}
            textAnchor="end"
            fontSize={10}
            fontFamily="var(--mono)"
            fill="rgba(60, 80, 110, 0.8)"
          >
            {xLabel}
          </text>
        </g>
      </svg>
    </div>
  );
}
