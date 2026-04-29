// Recap text renderer — converts plain prose into JSX with player names
// wrapped in Savant links. FEAT-12 V1: full-name match first, then a
// second pass on unambiguous last names. No tooltip yet (V2).
//
// Why a two-pass match instead of one big regex:
//   1. Full-name match avoids false positives where a last name happens
//      to also be a common English word ("Fields", "Wood").
//   2. Last-name pass catches second references ("Crow-Armstrong" after
//      first-mention of "Pete Crow-Armstrong") without us having to
//      enumerate nicknames.
// Ambiguity rule: if two players in the same box score share a last
// name (e.g. both Bell brothers), neither last-name reference links —
// we leave it as plain text. False positives are worse than misses.

import { createElement, Fragment } from 'react';
import type { ReactNode } from 'react';
import PlayerLink from '../components/PlayerLink';

/** Escape regex metacharacters in a literal string. Names contain
 *  hyphens (e.g. "Crow-Armstrong"), apostrophes ("O'Hoppe"), and
 *  occasional periods ("J.T. Realmuto"); all need to be neutralized. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Last name = everything after the first whitespace token. Handles
 *  "Pete Crow-Armstrong" → "Crow-Armstrong" and "J.T. Realmuto" →
 *  "Realmuto". Single-token names (rare in MLB but possible) fall
 *  back to the full string. */
function lastNameOf(fullName: string): string {
  const trimmed = fullName.trim();
  const idx = trimmed.indexOf(' ');
  return idx < 0 ? trimmed : trimmed.slice(idx + 1).trim();
}

/** Match boundaries that look like word edges but tolerate punctuation
 *  and quotes around the name (opening: start-of-string, whitespace,
 *  or `(` `[` `"` `'` `“` `‘`; closing: end-of-string, whitespace, or
 *  any punctuation). `\b` alone breaks on hyphenated names like
 *  "Crow-Armstrong" because `-` is a non-word boundary. */
const OPEN_BOUNDARY = '(?:^|[\\s(\\["\'\\u2018\\u201C])';
const CLOSE_BOUNDARY = '(?=$|[\\s.,;:!?)\\]"\'\\u2019\\u201D])';

interface Match {
  start: number;
  end: number;
  name: string;
  playerId: string;
}

/** Find every disjoint match for `targets` (a list of {searchString,
 *  fullName, playerId}) in `text`. Earlier list entries take priority
 *  when ranges overlap. */
function findMatches(
  text: string,
  targets: { needle: string; displayName: string; playerId: string }[],
): Match[] {
  const matches: Match[] = [];
  for (const t of targets) {
    const pattern = new RegExp(
      `${OPEN_BOUNDARY}(${escapeRegex(t.needle)})${CLOSE_BOUNDARY}`,
      'g',
    );
    let m: RegExpExecArray | null;
    while ((m = pattern.exec(text)) !== null) {
      // m.index points at the boundary char (or 0 if start-of-string);
      // the captured group is at m.index + (m[0].length - m[1].length).
      const inner = m[1];
      const start = m.index + (m[0].length - inner.length);
      const end = start + inner.length;
      // Skip if any earlier-priority match already covers this span.
      const overlaps = matches.some((x) => start < x.end && end > x.start);
      if (overlaps) continue;
      matches.push({ start, end, name: inner, playerId: t.playerId });
    }
  }
  matches.sort((a, b) => a.start - b.start);
  return matches;
}

/** Render `text` with player mentions replaced by `<PlayerLink>`.
 *  `players` is the box-score map from the server response. */
export function renderRecapText(
  text: string,
  players: Record<string, string> | undefined,
): ReactNode {
  if (!text) return text;
  if (!players || Object.keys(players).length === 0) return text;

  // Pass 1: every full name. Sort by length DESC so longer names
  // (Pete Crow-Armstrong) match before shorter prefixes (Pete Crow).
  const fullNames = Object.entries(players)
    .map(([name, id]) => ({ needle: name, displayName: name, playerId: id }))
    .sort((a, b) => b.needle.length - a.needle.length);

  // Pass 2: last-name-only, but ONLY when unambiguous within the box
  // score. If two players share a last name we leave both as plain
  // text in the second-mention case.
  const lastNameCount = new Map<string, number>();
  for (const name of Object.keys(players)) {
    const ln = lastNameOf(name);
    lastNameCount.set(ln, (lastNameCount.get(ln) ?? 0) + 1);
  }
  const lastNames: { needle: string; displayName: string; playerId: string }[] = [];
  for (const [name, id] of Object.entries(players)) {
    const ln = lastNameOf(name);
    // Skip if ambiguous within this game, or if last name == full name
    // (single-token name, already handled by pass 1).
    if (lastNameCount.get(ln)! > 1) continue;
    if (ln === name) continue;
    lastNames.push({ needle: ln, displayName: ln, playerId: id });
  }
  lastNames.sort((a, b) => b.needle.length - a.needle.length);

  // Run pass 1 then pass 2 against the full text. Pass 2 only fills
  // in spans that pass 1 didn't already claim.
  const matches = findMatches(text, [...fullNames, ...lastNames]);
  if (matches.length === 0) return text;

  const out: ReactNode[] = [];
  let cursor = 0;
  matches.forEach((m, i) => {
    if (m.start > cursor) out.push(text.slice(cursor, m.start));
    out.push(
      createElement(PlayerLink, {
        key: `pl-${i}-${m.start}`,
        playerId: m.playerId,
        name: m.name,
      }),
    );
    cursor = m.end;
  });
  if (cursor < text.length) out.push(text.slice(cursor));
  return createElement(Fragment, null, ...out);
}
