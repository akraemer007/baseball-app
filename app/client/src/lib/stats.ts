/**
 * MLB-convention stat formatting:
 * - Slash-line + win pct (AVG/OBP/SLG/OPS/winPct): always 3 decimals, no
 *   leading zero when |v| < 1 — e.g. ".289", ".805", "1.015".
 * - Everything else (ERA, K/9, HR/9, WHIP, ratios, counts): unchanged —
 *   2 decimals for floats, integers as-is.
 */

export const SLASH_STATS = new Set(['avg', 'obp', 'slg', 'ops', 'winPct']);

export function isSlashStat(statKey: string | undefined): boolean {
  return !!statKey && SLASH_STATS.has(statKey);
}

export function formatSlashStat(value: number): string {
  const s = value.toFixed(3);
  if (s.startsWith('0.')) return s.slice(1);
  if (s.startsWith('-0.')) return '-' + s.slice(2);
  return s;
}

export function formatStat(value: number, statKey?: string): string {
  if (isSlashStat(statKey)) return formatSlashStat(value);
  if (Number.isInteger(value)) return String(value);
  return value.toFixed(2);
}
