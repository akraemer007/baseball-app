// Inline Savant link for a player mentioned in recap prose. V1: plain
// <a> in a new tab. V2 (follow-up): hover tooltip with season slash
// line / pitching line. Styling lives in index.css under `.player-link`
// — inherits its parent's text color, no underline by default,
// underline on hover only.

import { savantPlayerUrl } from '../lib/savant';

interface PlayerLinkProps {
  playerId: string;
  name: string;
}

export default function PlayerLink({ playerId, name }: PlayerLinkProps) {
  return (
    <a
      className="player-link"
      href={savantPlayerUrl(playerId)}
      target="_blank"
      rel="noopener noreferrer"
    >
      {name}
    </a>
  );
}
