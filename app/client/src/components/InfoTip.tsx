import type { ReactNode } from 'react';

interface Props {
  /** Short, human text explaining the metric. One or two sentences. */
  children: ReactNode;
  /** Prefer "above" for things near the top edge of their container. */
  placement?: 'top' | 'bottom';
}

/**
 * A small circled (i) that reveals a definition on hover/focus. Pure CSS,
 * no JS libraries — the hidden tooltip is a sibling of the icon that pops
 * open on :hover / :focus-within.
 */
export function InfoTip({ children, placement = 'top' }: Props) {
  return (
    <span className={`info-tip info-tip-${placement}`} tabIndex={0}>
      <span className="info-tip-icon" aria-hidden="true">
        i
      </span>
      <span className="info-tip-body" role="tooltip">
        {children}
      </span>
    </span>
  );
}
