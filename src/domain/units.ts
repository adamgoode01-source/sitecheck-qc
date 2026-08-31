/**
 * Length handling for construction work.
 *
 * The entire domain layer works in INCHES as a plain number. Sensor input
 * (ARKit reports metres) is converted at the boundary, never deeper in.
 * Everything a human types or reads goes through this module so that
 * feet-inch-fraction arithmetic is done in exactly one place.
 */

export const INCHES_PER_METRE = 39.37007874015748;
export const INCHES_PER_FOOT = 12;

export const metresToInches = (m: number): number => m * INCHES_PER_METRE;
export const inchesToMetres = (inches: number): number => inches / INCHES_PER_METRE;
export const inchesToMillimetres = (inches: number): number => inches * 25.4;
export const millimetresToInches = (mm: number): number => mm / 25.4;

export type UnitSystem = 'imperial' | 'metric';

/** Fractional denominator used when displaying imperial lengths. */
export type Denominator = 2 | 4 | 8 | 16 | 32;

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/* ------------------------------------------------------------------ *
 * Parsing
 * ------------------------------------------------------------------ */

/**
 * Parse a human-entered length into inches.
 *
 * Accepted (case-insensitive, whitespace-tolerant):
 *   16            16 3/4         3/4"        .5"
 *   16"           16-3/4"        4'          4ft
 *   4'-6"         4' 6 1/2"      4'6"        4 ft 6 in
 *   400mm         40cm           1.2m        1200 mm
 *
 * Returns null when the text cannot be understood. Callers must treat null as
 * "ask the user again" rather than substituting a default — a silently wrong
 * expected dimension is the worst possible failure mode for this app.
 */
export function parseLength(raw: string): number | null {
  if (typeof raw !== 'string') return null;
  let s = raw.trim().toLowerCase();
  if (s === '') return null;

  // Unicode prime marks and dashes that phone keyboards love to insert.
  s = s
    .replace(/[′‘’]/g, "'")
    .replace(/[″“”]/g, '"')
    .replace(/[‐-―−]/g, '-');

  let sign = 1;
  if (s.startsWith('-')) {
    // Leading minus is a negative length; an interior dash is a feet-inch separator.
    sign = -1;
    s = s.slice(1).trim();
  } else if (s.startsWith('+')) {
    s = s.slice(1).trim();
  }

  const metric = parseMetric(s);
  if (metric !== null) return sign * metric;

  const imperial = parseImperial(s);
  if (imperial !== null) return sign * imperial;

  return null;
}

function parseMetric(s: string): number | null {
  const m = /^([0-9]*\.?[0-9]+)\s*(mm|millimet(?:er|re)s?|cm|centimet(?:er|re)s?|m|met(?:er|re)s?)$/.exec(s);
  if (!m) return null;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return null;
  switch (m[2]![0]) {
    case 'm':
      // 'm' alone is metres; 'mm' is millimetres.
      return m[2]!.startsWith('mm') || m[2]!.startsWith('milli')
        ? millimetresToInches(value)
        : metresToInches(value);
    case 'c':
      return millimetresToInches(value * 10);
    default:
      return null;
  }
}

function parseImperial(s: string): number | null {
  // Normalise word forms to symbols, then split on the foot mark.
  s = s
    .replace(/\s*(feet|foot|ft\.?)\s*/g, "'")
    .replace(/\s*(inches|inch|in\.?)\s*/g, '"')
    .trim();

  let feetPart = '';
  let inchPart = s;

  const footIdx = s.indexOf("'");
  if (footIdx >= 0) {
    feetPart = s.slice(0, footIdx).trim();
    inchPart = s.slice(footIdx + 1).trim();
    // "4'-6" — the dash here separates feet from inches, it is not a minus.
    if (inchPart.startsWith('-')) inchPart = inchPart.slice(1).trim();
  }

  let total = 0;

  if (feetPart !== '') {
    const feet = parseMixedNumber(feetPart);
    if (feet === null) return null;
    total += feet * INCHES_PER_FOOT;
  }

  inchPart = inchPart.replace(/"/g, '').trim();
  if (inchPart !== '') {
    const inches = parseMixedNumber(inchPart);
    if (inches === null) return null;
    total += inches;
  } else if (feetPart === '') {
    return null;
  }

  return total;
}

/** Parses `16`, `3/4`, `16 3/4`, `16-3/4`, `.5`. */
function parseMixedNumber(s: string): number | null {
  const t = s.trim().replace(/-/g, ' ');
  if (t === '') return null;

  const mixed = /^([0-9]*\.?[0-9]+)\s+([0-9]+)\s*\/\s*([0-9]+)$/.exec(t);
  if (mixed) {
    const den = Number(mixed[3]);
    if (den === 0) return null;
    return Number(mixed[1]) + Number(mixed[2]) / den;
  }

  const frac = /^([0-9]+)\s*\/\s*([0-9]+)$/.exec(t);
  if (frac) {
    const den = Number(frac[2]);
    if (den === 0) return null;
    return Number(frac[1]) / den;
  }

  const plain = /^[0-9]*\.?[0-9]+$/.exec(t);
  if (plain) return Number(t);

  return null;
}

/* ------------------------------------------------------------------ *
 * Formatting
 * ------------------------------------------------------------------ */

/** `6 1/2"` — inches only, no feet rollover. Used for spacings and tolerances. */
export function formatInches(inches: number, denom: Denominator = 16): string {
  const sign = inches < 0 ? '-' : '';
  const { whole, num, den } = splitFraction(Math.abs(inches), denom);
  if (num === 0) return `${sign}${whole}"`;
  if (whole === 0) return `${sign}${num}/${den}"`;
  return `${sign}${whole} ${num}/${den}"`;
}

/** `4'-6 1/2"` — the form used on drawings and in reports. */
export function formatFeetInches(inches: number, denom: Denominator = 16): string {
  const sign = inches < 0 ? '-' : '';
  const abs = Math.abs(inches);
  const { whole, num, den } = splitFraction(abs, denom);

  const feet = Math.floor(whole / INCHES_PER_FOOT);
  const remInches = whole - feet * INCHES_PER_FOOT;

  if (feet === 0) return formatInches(sign === '-' ? -abs : abs, denom);

  const fracText = num === 0 ? '' : ` ${num}/${den}`;
  return `${sign}${feet}'-${remInches}${fracText}"`;
}

/** `+1/8"` / `-1/4"` / `0"` — deviations always carry an explicit sign. */
export function formatDeviation(inches: number, denom: Denominator = 16): string {
  const rounded = roundTo(inches, denom);
  if (rounded === 0) return '0"';
  const body = formatInches(Math.abs(rounded), denom);
  return `${rounded > 0 ? '+' : '-'}${body}`;
}

/**
 * `±1/4"` — a two-sided tolerance.
 *
 * Distinct from `formatDeviation`, which signs a measured error. Printing an
 * allowance as "+1/4"" reads as a one-sided limit, which is a different
 * requirement from the one being applied.
 */
export function formatTolerance(inches: number, denom: Denominator = 32): string {
  return `±${formatInches(Math.abs(inches), denom)}`;
}

export function formatMetric(inches: number): string {
  const mm = inchesToMillimetres(inches);
  return Math.abs(mm) >= 1000 ? `${(mm / 1000).toFixed(3)} m` : `${mm.toFixed(1)} mm`;
}

/** Single entry point the UI uses so the unit toggle is honoured everywhere. */
export function formatLength(inches: number, system: UnitSystem, denom: Denominator = 16): string {
  return system === 'metric' ? formatMetric(inches) : formatFeetInches(inches, denom);
}

/** Rounds to the nearest 1/denom of an inch. */
export function roundTo(inches: number, denom: Denominator = 16): number {
  return Math.round(inches * denom) / denom;
}

/**
 * Splits a non-negative length into whole inches plus a reduced fraction,
 * carrying correctly when rounding pushes the fraction to a full inch
 * (11.99" at 1/16 must become 12", not `11 16/16"`).
 */
function splitFraction(abs: number, denom: Denominator): { whole: number; num: number; den: number } {
  const ticks = Math.round(abs * denom);
  let whole = Math.floor(ticks / denom);
  let num = ticks - whole * denom;
  let den = denom as number;

  if (num === 0) return { whole, num: 0, den };

  const g = gcd(num, den);
  num /= g;
  den /= g;

  if (num === den) {
    whole += 1;
    num = 0;
  }
  return { whole, num, den };
}
