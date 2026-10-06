/** Display formatting. Pure; every time-dependent helper takes the time explicitly. */

const nf = new Intl.NumberFormat('en-US');
export const int = (n: number): string => nf.format(Math.round(n));

export const pct = (p: number, digits = 0): string => `${(p * 100).toFixed(digits)}%`;

export const signed = (n: number): string => `${n >= 0 ? '+' : '−'}${int(Math.abs(n))}`;

/** `2026-09-28 22:41` in UTC (times are ISO-8601 UTC, 01 §1). */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toISOString().slice(0, 16).replace('T', ' ');
}

export function initials(name: string): string {
  return name
    .split(/[ .]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export const titleCase = (s: string): string => (s ? s[0]!.toUpperCase() + s.slice(1) : s);
