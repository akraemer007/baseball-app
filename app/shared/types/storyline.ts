// FEAT-30 — DERIV-11 storyline (long-form columnist paragraph)
// surfaced on the team page and league standings tooltip.
//
// v3 storage: one row per (team_id, generated_for_date) in
// `gold_team_storyline`, with the paragraph in the `prose` column.
// `generatedForDate` is an ISO yyyy-mm-dd string the client uses to
// decide whether to prepend a dateline ("today's" vs "Apr 28 ·").
//
// Empty `prose` means "render nothing" — there's no separate
// "no storylines yet" state.

export interface TeamStorylineResponse {
  generatedForDate: string;
  /** LLM-generated section header. 4-7 words, recap-headline voice.
   *  Falls back to the literal `Two-week summary` server-side when
   *  missing — older rows generated under v1 don't have a title. */
  title: string;
  /** Single flowing paragraph (~110-160 words), beat-writer voice
   *  (prompt v3). Empty string when the LLM job hasn't produced a
   *  fresh row for this team yet, or when the row was generated
   *  under v1/v2 (server falls back gracefully on legacy rows). */
  prose: string;
  /** Map of `playerName → playerId` for every player on this team's
   *  roster in the last 30 days. Mirrors `RecapItem.players` (FEAT-12)
   *  so the client can reuse `renderRecapText` to wrap mentions in
   *  Savant links. Empty/undefined when the lookup fails — prose
   *  still renders as plain text either way. */
  players?: Record<string, string>;
}

/** Bulk endpoint payload (`GET /api/league/storylines`). One round trip
 *  for every team's most-recent storyline; keyed by team abbreviation.
 *  Drives the standings hover tooltip on the league page. Players are
 *  intentionally absent — the tooltip is hover-only, not clickable. */
export type LeagueStorylinesResponse = Record<
  string,
  Pick<TeamStorylineResponse, 'generatedForDate' | 'title' | 'prose'>
>;
