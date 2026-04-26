/**
 * Placeholder while the player profiles surface is being rebuilt.
 * The previous implementation lives in `PlayersPage.legacy.tsx` and
 * will be cannibalized once the team-roster work lands. Keeping the
 * `/players` route resolved (rather than 404'd) so direct links and
 * old bookmarks still land somewhere coherent.
 */
export default function PlayersPage() {
  return (
    <div className="page">
      <div className="card">
        <h3>Players</h3>
        <p className="muted">
          Player profiles are being rebuilt.
        </p>
        <p className="muted">
          The team page (try <span className="mono">/team/CHC</span>) is
          the most useful view for now.
        </p>
        <p className="muted">
          Check back after the team-roster work lands.
        </p>
      </div>
    </div>
  );
}
