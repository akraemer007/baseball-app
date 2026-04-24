import {
  useLayoutEffect,
  useMemo,
  useRef,
  useEffect,
  useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import * as d3 from 'd3';
import type { StatDistributionEntry } from '@shared/types';
import { formatStat } from '../lib/stats';

interface Props {
  entries: StatDistributionEntry[];
  lowerIsBetter: boolean;
  leagueMean: number;
  /** Used for MLB-convention formatting (no leading zero on slash-line rates). */
  statKey?: string;
  /** Label used on the reference-tick — "MLB", "NL", or "AL". */
  scopeLabel?: string;
  /** The team whose page we're on — gets the biggest dot + label + dark outline. */
  currentTeamAbbrev: string;
  /** User's primary team — medium-prominence callout when different from current. */
  primaryTeamAbbrev?: string;
  /** User's secondary team — lightest callout when different from current/primary. */
  secondaryTeamAbbrev?: string;
  /** Override the computed [min, max] value-axis domain. Used to share the
   *  x-scale with the per-player strip plot below so the team's dot + tick
   *  line up at the same x across both charts. */
  xDomain?: [number, number];
  /**
   * Level of detail.
   *  - `spark`: row-sized (~36 px), no dot hover, no labels except current
   *     team + MLB-avg tooltip on tick hover.
   *  - `full`: expanded detail (~140 px) with featured-team labels,
   *     axis hints, MLB-avg text, dot hover tooltips.
   * Horizontal padding is constant across modes so dots align pixel-for-
   * pixel between the two states and with the player chart below.
   */
  detail?: 'spark' | 'full';
  height?: number;
}

type FeatureKind = 'current' | 'primary' | 'secondary' | null;

/**
 * Strip-plot (one dot per team) along a horizontal axis of the stat value.
 * The `detail` prop controls whether we render at sparkline fidelity or
 * fully-labeled detail. Switching between the two preserves every dot's
 * x-pixel position — the chart just fades extra labels/tooltips in/out.
 */
export function StatDistributionChart({
  entries,
  lowerIsBetter,
  leagueMean,
  statKey,
  scopeLabel = 'MLB',
  currentTeamAbbrev,
  primaryTeamAbbrev,
  secondaryTeamAbbrev,
  xDomain,
  detail = 'full',
  height,
}: Props) {
  const navigate = useNavigate();
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(400);
  const [hovered, setHovered] = useState<number | null>(null);
  const [leagueHovered, setLeagueHovered] = useState(false);

  const isSpark = detail === 'spark';
  const h = height ?? (isSpark ? 36 : 140);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const obs = new ResizeObserver((es) => {
      for (const e of es) setWidth(Math.max(160, e.contentRect.width));
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Belt-and-suspenders sync measurement: ResizeObserver can miss fires
  // when the chart's parent changes width during the same render (e.g.
  // the row expanding inside a CSS multi-column layout).
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measured = Math.max(160, el.clientWidth);
    if (measured !== width) setWidth(measured);
  });

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
    // Horizontal padding is constant across spark/full so the x-scale
    // (and therefore every dot's x-pixel) is identical in both modes.
    // Vertical padding varies: spark has no room for labels, full leaves
    // room for the MLB-avg text above and axis hints below.
    const margin = isSpark
      ? { top: 10, right: 8, bottom: 2, left: 8 }
      : { top: 22, right: 8, bottom: 36, left: 8 };
    const innerW = Math.max(40, width - margin.left - margin.right);
    const innerH = Math.max(12, h - margin.top - margin.bottom);
    let domain: [number, number];
    if (xDomain) {
      domain = xDomain;
    } else {
      const vals = entries.map((e) => e.value);
      const minV = d3.min(vals) ?? 0;
      const maxV = d3.max(vals) ?? 1;
      const pad = (maxV - minV) * 0.08 || 0.1;
      domain = [minV - pad, maxV + pad];
    }
    const x = d3
      .scaleLinear()
      .domain(domain)
      .range(lowerIsBetter ? [innerW, 0] : [0, innerW]);
    // Deterministic jitter keyed off team abbrev so each dot's vertical
    // position is stable across renders. Spark keeps everyone on the
    // baseline for a clean skinny strip.
    const jitter = (abbrev: string) => {
      if (isSpark) return 0;
      let hash = 0;
      for (let i = 0; i < abbrev.length; i++) hash = (hash * 31 + abbrev.charCodeAt(i)) | 0;
      return ((hash & 0xff) / 0xff - 0.5) * innerH * 0.6;
    };
    return { margin, innerW, innerH, x, jitter };
  }, [entries, width, h, lowerIsBetter, xDomain, isSpark]);

  const { margin, innerW, innerH, x, jitter } = layout;
  const midY = innerH / 2;
  const hoveredEntry = hovered != null && !isSpark ? entries[hovered] : null;

  return (
    <div ref={wrapRef} style={{ width: '100%', height: h, position: 'relative' }}>
      <svg
        className="stat-dist-chart"
        width={width}
        height={h}
        style={{ display: 'block', overflow: 'visible' }}
      >
        <g
          style={{
            transform: `translate(${margin.left}px, ${margin.top}px)`,
          }}
        >
          {/* Distribution baseline */}
          <line
            x1={0}
            x2={innerW}
            y1={midY}
            y2={midY}
            stroke={isSpark ? 'rgba(10, 22, 40, 0.18)' : 'rgba(10, 22, 40, 0.15)'}
            strokeWidth={1}
          />

          {/* League-mean tick — both styles always rendered; opacity fades
              between them so the transition looks like a crossfade. */}
          <g
            style={{
              transform: `translate(${x(leagueMean)}px, 0px)`,
              cursor: 'help',
            }}
            onMouseEnter={() => setLeagueHovered(true)}
            onMouseLeave={() => setLeagueHovered(false)}
            onClick={(e) => e.stopPropagation()}
          >
            <line
              y1={-margin.top}
              y2={innerH + margin.bottom}
              stroke="transparent"
              strokeWidth={12}
            />
            {/* Spark-style hash (visible when folded) */}
            <line
              y1={midY - 8}
              y2={midY + 8}
              stroke={leagueHovered ? 'rgba(10, 22, 40, 0.95)' : 'rgba(10, 22, 40, 0.7)'}
              strokeWidth={leagueHovered ? 1.75 : 1.25}
              opacity={isSpark ? 1 : 0}
            />
            {/* Full-style dashed tick (visible when unfolded) */}
            <line
              y1={0}
              y2={innerH}
              stroke="rgba(10, 22, 40, 0.45)"
              strokeWidth={1}
              strokeDasharray="2 3"
              opacity={isSpark ? 0 : 1}
            />
            <text
              x={0}
              y={-8}
              textAnchor="middle"
              fontSize={9}
              fontFamily="var(--mono)"
              fill="rgba(60, 80, 110, 0.85)"
              opacity={isSpark ? 0 : 1}
              style={{ pointerEvents: 'none' }}
            >
              {scopeLabel} average {formatStat(leagueMean, statKey)}
            </text>
          </g>

          {/* Dots + labels — featured teams on top so they're never hidden. */}
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
              const { r, strokeWidth, strokeColor, fill } = (() => {
                if (isSpark) {
                  switch (kind) {
                    case 'current':
                      return { r: 5, strokeWidth: 1.75, strokeColor: '#0a1628', fill: e.teamColor };
                    case 'primary':
                      return { r: 3.75, strokeWidth: 1.25, strokeColor: '#0a1628', fill: e.teamColor };
                    case 'secondary':
                      return { r: 3.25, strokeWidth: 1, strokeColor: 'rgba(10, 22, 40, 0.55)', fill: e.teamColor };
                    default:
                      return { r: 2, strokeWidth: 0, strokeColor: 'none', fill: 'rgba(60, 80, 110, 0.35)' };
                  }
                }
                switch (kind) {
                  case 'current':
                    return { r: 7.5, strokeWidth: 2.5, strokeColor: '#0a1628', fill: e.teamColor };
                  case 'primary':
                    return { r: 6.5, strokeWidth: 2, strokeColor: '#0a1628', fill: e.teamColor };
                  case 'secondary':
                    return { r: 6, strokeWidth: 1.5, strokeColor: 'rgba(10, 22, 40, 0.55)', fill: e.teamColor };
                  default:
                    return { r: 5, strokeWidth: 0.75, strokeColor: 'rgba(10, 22, 40, 0.35)', fill: e.teamColor };
                }
              })();
              const interactive = !isSpark;
              // Which teams get a label rendered above their dot?
              // Spark: only the current team (an anchor so you can tell which is "yours").
              // Full: any featured team, plus the currently-hovered dot.
              const showLabel = kind === 'current' || (!isSpark && (kind !== null || hovered === i));
              return (
                <g
                  key={e.teamAbbrev}
                  style={{
                    transform: `translate(${x(e.value)}px, ${cy}px)`,
                    cursor: interactive ? 'pointer' : 'default',
                  }}
                  onMouseEnter={interactive ? () => setHovered(i) : undefined}
                  onMouseLeave={interactive ? () => setHovered(null) : undefined}
                  onClick={interactive ? (ev) => {
                    ev.stopPropagation();
                    navigate(`/team/${e.teamAbbrev}`);
                  } : undefined}
                >
                  <circle
                    r={r}
                    fill={fill}
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    opacity={
                      !isSpark && hovered != null && hovered !== i ? 0.35 : 0.95
                    }
                  />
                  {/* Always render so opacity transitions handle fade-in /
                      fade-out smoothly; y is fixed so the label doesn't
                      snap when the dot radius changes. */}
                  <text
                    x={0}
                    y={-10}
                    textAnchor="middle"
                    fontSize={kind === 'current' ? 11 : 10}
                    fontFamily="var(--mono)"
                    fill="var(--text)"
                    fontWeight={kind === 'current' ? 700 : kind ? 600 : 500}
                    opacity={showLabel ? 1 : 0}
                    style={{ pointerEvents: 'none' }}
                  >
                    {e.teamAbbrev}
                  </text>
                </g>
              );
            })}

          {/* Axis hints — the x-scale is flipped for lowerIsBetter
              stats so "better" is always physically on the right, so
              these labels are static. */}
          {!isSpark && (
            <>
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
            </>
          )}
        </g>
      </svg>

      {/* Team dot tooltip — full only */}
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
            {formatStat(hoveredEntry.value, statKey)} · rank {hoveredEntry.rank}
          </div>
        </div>
      )}

      {/* League-avg tick tooltip — primarily useful in spark where there's
          no visible label text; harmless duplication in full mode. */}
      {leagueHovered && !hoveredEntry && (
        <div
          className="stat-dist-tooltip"
          style={{
            left: `${margin.left + x(leagueMean)}px`,
            top: `${margin.top + midY - (isSpark ? 14 : 28)}px`,
          }}
        >
          <div className="mono" style={{ fontWeight: 700 }}>
            {scopeLabel} average {formatStat(leagueMean, statKey)}
          </div>
        </div>
      )}
    </div>
  );
}
