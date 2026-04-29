// FEAT-30 — DERIV-11 storyline bullets surfaced on the team page.
//
// One row per bullet in `gold_team_storyline`; the API returns the
// most-recent `generated_for_date`'s set in `bullet_index` order.
// `generatedForDate` is an ISO yyyy-mm-dd string the client uses to
// decide whether to prepend a dateline ("today's" vs "Apr 28 ·").
//
// Empty `bullets` means "render nothing" — there's no separate
// "no storylines yet" state.

export interface TeamStorylineBullet {
  text: string;
}

export interface TeamStorylineResponse {
  generatedForDate: string;
  /** LLM-generated section header (prompt v2). 4-7 words, recap-headline
   *  voice. Falls back to the literal `Two-week summary` server-side
   *  when missing — older rows generated under v1 simply don't have a
   *  title column populated. */
  title: string;
  bullets: TeamStorylineBullet[];
  /** Map of `playerName → playerId` for every player on this team's
   *  roster in the last 30 days. Mirrors `RecapItem.players` (FEAT-12)
   *  so the client can reuse `renderRecapText` to wrap mentions in
   *  Savant links. Empty/undefined when the lookup fails — bullets
   *  still render as plain text either way. */
  players?: Record<string, string>;
}
