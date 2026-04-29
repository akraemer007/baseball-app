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
  bullets: TeamStorylineBullet[];
}
