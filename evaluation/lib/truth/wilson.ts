/**
 * The Wilson score interval for a share of hits out of a count, at 95%.
 *
 * It stays inside 0 to 1 at 0 hits and at every hit, unlike the normal
 * approximation, and is honest about small counts: 5 of 6 is anything from
 * about 0.44 to 0.97.
 */

/** The two-sided 95% normal quantile. */
const Z = 1.959963984540054;

export interface Share {
  hits: number;
  of: number;
  /** Null when `of` is 0: there is nothing to share. */
  share: number | null;
  low: number | null;
  high: number | null;
}

export function wilson(hits: number, of: number): Share {
  if (!Number.isInteger(hits) || !Number.isInteger(of) || hits < 0 || of < 0 || hits > of) {
    throw new Error(`a share needs whole counts with 0 <= hits <= of, got ${hits} of ${of}`);
  }
  if (of === 0) return { hits, of, share: null, low: null, high: null };
  const p = hits / of;
  const z2 = Z * Z;
  const denominator = 1 + z2 / of;
  const centre = (p + z2 / (2 * of)) / denominator;
  const half = (Z * Math.sqrt((p * (1 - p)) / of + z2 / (4 * of * of))) / denominator;
  // At 0 hits the low end is exactly 0, and at every hit the high end exactly 1; rounding would leave a crumb.
  const low = hits === 0 ? 0 : Math.max(0, centre - half);
  const high = hits === of ? 1 : Math.min(1, centre + half);
  return { hits, of, share: p, low, high };
}
