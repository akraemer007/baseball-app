import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { apiGet } from '../lib/api';
import { savantPlayerUrl } from '../lib/savant';
import type { GameSummaryResponse } from '@shared/types';

interface Props {
  gamePk: number;
  /** Called when the user clicks the close button or outside the panel. */
  onClose: () => void;
}

/**
 * Bottom-anchored drawer that surfaces a single game's summary when the
 * user clicks a point on the trajectory chart. Slides up on mount, slides
 * down on dismiss. The drawer is rendered as a sibling inside the chart's
 * card area; it does not portal anywhere.
 */
export function GameDrawer({ gamePk, onClose }: Props) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement | null>(null);

  // Trigger slide-in on mount.
  useEffect(() => {
    const id = requestAnimationFrame(() => setOpen(true));
    return () => cancelAnimationFrame(id);
  }, []);

  // ESC + click-outside dismiss.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    function onMouseDown(e: MouseEvent) {
      const el = panelRef.current;
      if (!el) return;
      if (e.target instanceof Node && !el.contains(e.target)) onClose();
    }
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onMouseDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onMouseDown);
    };
  }, [onClose]);

  const { data, isLoading, error } = useQuery<GameSummaryResponse>({
    queryKey: ['game-summary', gamePk],
    queryFn: () => apiGet<GameSummaryResponse>(`/api/game/${gamePk}/summary`),
    staleTime: 5 * 60 * 1000,
  });

  const dateLabel = data ? formatDrawerDate(data.gameDate) : '';

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Game summary"
      style={{
        position: 'absolute',
        left: 0,
        right: 0,
        bottom: 0,
        background: 'var(--card)',
        borderTop: '1px solid var(--border)',
        boxShadow: '0 -4px 14px rgba(10, 22, 40, 0.08)',
        padding: '0.75rem 1rem',
        transform: open ? 'translateY(0)' : 'translateY(100%)',
        transition: 'transform 280ms ease',
        zIndex: 5,
      }}
    >
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 6,
          right: 8,
          background: 'transparent',
          border: 'none',
          fontSize: 18,
          lineHeight: 1,
          color: 'var(--text-dim)',
          cursor: 'pointer',
          padding: '0.25rem 0.4rem',
        }}
      >
        ×
      </button>

      {isLoading && <p className="muted" style={{ margin: 0 }}>Loading game…</p>}
      {error && (
        <p className="muted" style={{ margin: 0 }}>Failed to load game.</p>
      )}
      {data && (
        <>
          <div
            className="mono"
            style={{
              fontSize: '1rem',
              fontWeight: 700,
              marginBottom: '0.25rem',
              paddingRight: '1.5rem',
            }}
          >
            <span style={{ color: data.away.color }}>{data.away.abbrev}</span>{' '}
            <span>{data.away.score}</span>
            <span style={{ color: 'var(--text-dim)' }}> – </span>
            <span style={{ color: data.home.color }}>{data.home.abbrev}</span>{' '}
            <span>{data.home.score}</span>
            <span className="muted" style={{ marginLeft: '0.5rem', fontWeight: 500 }}>
              · {dateLabel}
            </span>
          </div>

          <div
            className="muted"
            style={{
              fontSize: '0.8rem',
              lineHeight: 1.5,
              display: 'flex',
              flexWrap: 'wrap',
              gap: '0.75rem',
            }}
          >
            {data.winningPitcher && (
              <span>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>W</span>{' '}
                <PlayerLink id={data.winningPitcher.id} name={data.winningPitcher.name} />
              </span>
            )}
            {data.losingPitcher && (
              <span>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>L</span>{' '}
                <PlayerLink id={data.losingPitcher.id} name={data.losingPitcher.name} />
              </span>
            )}
            {data.topPerformer && (
              <span>
                <span style={{ textTransform: 'uppercase', letterSpacing: '0.06em' }}>Top</span>{' '}
                <PlayerLink id={data.topPerformer.id} name={data.topPerformer.name} />{' '}
                <span style={{ color: 'var(--text)' }}>{data.topPerformer.line}</span>
              </span>
            )}
            <a
              className="team-matchup-link"
              href={data.boxScoreUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              box score ↗
            </a>
          </div>
        </>
      )}
    </div>
  );
}

function PlayerLink({ id, name }: { id: string; name: string }) {
  if (!id || id === '0' || id === '1' || id === '2') {
    // Mock-mode placeholder ids — render as plain text rather than a broken link.
    return <span style={{ color: 'var(--text)' }}>{name}</span>;
  }
  return (
    <a
      className="team-matchup-link"
      href={savantPlayerUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {name}
    </a>
  );
}

function formatDrawerDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  if (!y || !m || !d) return iso;
  const date = new Date(y, m - 1, d);
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
