import { useMemo } from 'react';
import * as d3 from 'd3';
import type { TrajectoryPoint } from '@shared/types';

interface Props {
  points: TrajectoryPoint[];
  /** Max-|W-L| across the division so every team in the group shares scale. */
  yBound: number;
  /** Max games-played across the division so every team shares the X scale. */
  maxGames: number;
  width?: number;
  height?: number;
}

/**
 * Single-team W-L trajectory sparkline, Statcast-style:
 * - green filled area above the zero line,
 * - red filled area below the zero line,
 * - tiny dark zero-line separator.
 */
export function TeamSparkline({ points, yBound, maxGames, width = 90, height = 28 }: Props) {
  const { posPath, negPath, zeroY } = useMemo(() => {
    if (!points.length) return { posPath: '', negPath: '', zeroY: height / 2 };
    const bound = Math.max(1, yBound);
    const x = d3.scaleLinear().domain([0, Math.max(1, maxGames)]).range([0, width]);
    const y = d3.scaleLinear().domain([-bound, bound]).range([height, 0]);

    const pos = d3
      .area<TrajectoryPoint>()
      .x((d) => x(d.gamesPlayed))
      .y0(y(0))
      .y1((d) => y(Math.max(0, d.wMinusL)))
      .curve(d3.curveMonotoneX);

    const neg = d3
      .area<TrajectoryPoint>()
      .x((d) => x(d.gamesPlayed))
      .y0(y(0))
      .y1((d) => y(Math.min(0, d.wMinusL)))
      .curve(d3.curveMonotoneX);

    return {
      posPath: pos(points) ?? '',
      negPath: neg(points) ?? '',
      zeroY: y(0),
    };
  }, [points, yBound, maxGames, width, height]);

  return (
    <svg width={width} height={height} style={{ display: 'block' }}>
      <path d={posPath} fill="rgba(73, 158, 77, 0.85)" />
      <path d={negPath} fill="rgba(229, 107, 117, 0.85)" />
      <line x1={0} x2={width} y1={zeroY} y2={zeroY} stroke="rgba(10, 22, 40, 0.55)" strokeWidth={0.75} />
    </svg>
  );
}
