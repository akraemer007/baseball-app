import { useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Page-aware help overlay. Reads `data-help-anchor="<id>"` attributes on
 * the current page, looks up a copy string for each, and renders a small
 * label tethered next to the element. Background click + ESC dismiss.
 *
 * Coordinates are NOT hardcoded — we ask the DOM for each anchor's
 * bounding box at mount time so the labels stay glued to whatever the
 * page actually rendered. Add a new anchor → add a copy entry below.
 */

interface AnchorCopy {
  /** Short instruction text shown next to the element. */
  label: string;
  /** Which side of the anchor to drop the label on. */
  side?: 'top' | 'bottom' | 'left' | 'right';
}

/** Per-route copy. Keys must match `data-help-anchor` values in the DOM. */
const COPY_BY_ROUTE: Record<string, Record<string, AnchorCopy>> = {
  league: {
    'trajectory-chart': {
      label: 'Hover a line for record at that date · click an end-of-line label to jump to that team',
      side: 'top',
    },
    'team-picker': {
      label: 'Pick your team and a secondary — both persist across visits',
      side: 'bottom',
    },
    'standings-card': {
      label: 'Click a division to feature its trajectory above',
      side: 'top',
    },
  },
  team: {
    'trajectory-chart': {
      label: 'Hover for record at that date · click a game point for game details',
      side: 'top',
    },
    'trajectory-mode': {
      label: 'Switch between division view and last-year comparison',
      side: 'left',
    },
    'percentile-row': {
      label: 'Click a row to expand into a 30-team distribution',
      side: 'right',
    },
  },
};

interface AnchorBox {
  id: string;
  rect: DOMRect;
  copy: AnchorCopy;
}

function routeKeyFor(pathname: string): keyof typeof COPY_BY_ROUTE | null {
  if (pathname === '/' || pathname === '') return 'league';
  if (pathname.startsWith('/team/')) return 'team';
  return null;
}

export default function HelpOverlay({ onClose }: { onClose: () => void }) {
  const { pathname } = useLocation();
  const routeKey = routeKeyFor(pathname);
  const copyMap = useMemo(
    () => (routeKey ? COPY_BY_ROUTE[routeKey] : {}),
    [routeKey],
  );

  const [anchors, setAnchors] = useState<AnchorBox[]>([]);

  // Read DOM positions on mount + on resize/scroll. useLayoutEffect runs
  // before paint so the labels appear in the right place on the first
  // render — no flash of mis-positioned tooltips.
  useLayoutEffect(() => {
    function measure() {
      const boxes: AnchorBox[] = [];
      // querySelectorAll spec-collects every match in the page. We only
      // render copy for ids that have an entry in COPY_BY_ROUTE, so an
      // unmapped anchor is silently skipped.
      const nodes = document.querySelectorAll<HTMLElement>('[data-help-anchor]');
      const seen = new Set<string>();
      nodes.forEach((node) => {
        const id = node.dataset.helpAnchor;
        if (!id) return;
        if (seen.has(id)) return; // first match wins for repeated anchors (e.g. percentile-row)
        const copy = copyMap[id];
        if (!copy) return;
        const rect = node.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;
        seen.add(id);
        boxes.push({ id, rect, copy });
      });
      setAnchors(boxes);
    }
    measure();
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [copyMap, pathname]);

  // ESC dismisses. Listener is keydown so it fires before any focused
  // element can swallow the event.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="help-overlay"
      role="dialog"
      aria-label="Help overlay"
      onClick={onClose}
    >
      {anchors.map((a) => (
        <HelpCallout key={a.id} box={a} />
      ))}
      {anchors.length === 0 && (
        <div className="help-overlay-empty">
          No help annotations for this page yet — try the League or Team page.
        </div>
      )}
    </div>
  );
}

function HelpCallout({ box }: { box: AnchorBox }) {
  const { rect, copy } = box;
  const side = copy.side ?? 'top';

  // Drop the label outside the anchor on the requested side. We use
  // viewport-relative `position: fixed` so scrolling repositions via
  // the resize/scroll listener (anchors get re-measured).
  let style: React.CSSProperties = { position: 'fixed' };
  const GAP = 10;
  const LABEL_W = 240;
  if (side === 'top') {
    style = {
      ...style,
      left: Math.max(8, Math.min(window.innerWidth - LABEL_W - 8, rect.left + rect.width / 2 - LABEL_W / 2)),
      top: Math.max(8, rect.top - GAP - 36),
      width: LABEL_W,
    };
  } else if (side === 'bottom') {
    style = {
      ...style,
      left: Math.max(8, Math.min(window.innerWidth - LABEL_W - 8, rect.left + rect.width / 2 - LABEL_W / 2)),
      top: Math.min(window.innerHeight - 50, rect.bottom + GAP),
      width: LABEL_W,
    };
  } else if (side === 'left') {
    style = {
      ...style,
      left: Math.max(8, rect.left - LABEL_W - GAP),
      top: rect.top + rect.height / 2 - 18,
      width: LABEL_W,
    };
  } else {
    // right
    style = {
      ...style,
      left: Math.min(window.innerWidth - LABEL_W - 8, rect.right + GAP),
      top: rect.top + rect.height / 2 - 18,
      width: LABEL_W,
    };
  }

  return (
    <div
      className={`help-callout help-callout-${side}`}
      style={style}
      // Label clicks shouldn't dismiss the overlay (let the user read).
      onClick={(e) => e.stopPropagation()}
    >
      <div className="help-callout-arrow" aria-hidden="true" />
      <div className="help-callout-text">{copy.label}</div>
    </div>
  );
}
