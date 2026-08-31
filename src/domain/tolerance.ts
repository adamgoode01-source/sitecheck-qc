/**
 * Tolerance profiles.
 *
 * ---------------------------------------------------------------------------
 * READ THIS BEFORE TRUSTING ANY NUMBER IN THIS FILE.
 *
 * The values below are EDITABLE STARTING POINTS chosen to be reasonable for
 * general commercial work. They are NOT quoted from ACI 117, the IBC, or any
 * other standard, and they are not legal or engineering advice. The governing
 * tolerance for any given inspection is whatever the project specification,
 * the structural drawings, and the engineer of record say it is — and those
 * routinely differ from each other and from anything generic.
 *
 * Every profile is editable in the app and stored per project. The intended
 * workflow is that someone reads the spec section once at project setup and
 * enters the real numbers. Shipping defaults exists so the app is usable on
 * day one, not so anyone can skip that step.
 * ---------------------------------------------------------------------------
 */

export interface FramingTolerances {
  /** Allowed +/- deviation on any single stud/joist bay, inches. */
  spacingToleranceIn: number;
  /**
   * Allowed +/- drift of any member from its ideal layout position measured
   * from the start of the run, inches. This is the one that decides whether
   * sheathing and drywall still break on a member at the far end of a wall.
   */
  cumulativeToleranceIn: number;
}

export interface RebarTolerances {
  /** Allowed +/- deviation on bar-to-bar spacing, inches. */
  spacingToleranceIn: number;
  /** Allowed +/- drift across the mat, inches. */
  cumulativeToleranceIn: number;
  /** How much LESS than specified clear cover is acceptable, inches. */
  coverUnderToleranceIn: number;
  /**
   * How much MORE than specified clear cover is acceptable, inches.
   * Undefined disables the excess-cover check.
   */
  coverOverToleranceIn?: number;
}

export interface RoughInTolerances {
  /** Allowed +/- on height above finished floor, inches. */
  heightToleranceIn: number;
  /** Allowed +/- on horizontal offset from the datum, inches. */
  offsetToleranceIn: number;
  /**
   * Allowed spread between the highest and lowest fixture in one set, inches.
   * Tighter than the height tolerance on purpose: two switches beside a door
   * can both meet a +/-1/2" spec and still look plainly wrong on the wall.
   */
  alignmentToleranceIn: number;
}

export interface OpeningTolerances {
  widthToleranceIn: number;
  heightToleranceIn: number;
  /** Allowed difference between the two diagonals, inches. */
  squarenessToleranceIn: number;
  /** Allowed horizontal wander of a jamb over its full height, inches. */
  plumbToleranceIn: number;
  /** Allowed height difference across the sill or head, inches. */
  levelToleranceIn: number;
  /** Allowed +/- on the dimension from a datum to the opening, inches. */
  offsetToleranceIn: number;
}

export interface ToleranceProfile {
  id: string;
  name: string;
  /** Shown in the UI and printed on every report, so nobody mistakes a default for a spec. */
  sourceNote: string;
  framing: FramingTolerances;
  rebar: RebarTolerances;
  roughIn: RoughInTolerances;
  openings: OpeningTolerances;
}

const UNVERIFIED =
  'Default starting values — not taken from any standard. Confirm against the project specification before relying on results.';

export const TOLERANCE_PROFILES: readonly ToleranceProfile[] = [
  {
    id: 'tight',
    name: 'Tight (architectural / exposed work)',
    sourceNote: UNVERIFIED,
    framing: { spacingToleranceIn: 1 / 8, cumulativeToleranceIn: 1 / 8 },
    rebar: {
      spacingToleranceIn: 1 / 4,
      cumulativeToleranceIn: 1 / 2,
      coverUnderToleranceIn: 1 / 8,
      coverOverToleranceIn: 1 / 2,
    },
    roughIn: {
      heightToleranceIn: 1 / 4,
      offsetToleranceIn: 1 / 4,
      alignmentToleranceIn: 1 / 8,
    },
    openings: {
      widthToleranceIn: 1 / 8,
      heightToleranceIn: 1 / 8,
      squarenessToleranceIn: 1 / 8,
      plumbToleranceIn: 1 / 8,
      levelToleranceIn: 1 / 8,
      offsetToleranceIn: 1 / 4,
    },
  },
  {
    id: 'standard',
    name: 'Standard (general commercial)',
    sourceNote: UNVERIFIED,
    framing: { spacingToleranceIn: 1 / 4, cumulativeToleranceIn: 1 / 4 },
    rebar: {
      spacingToleranceIn: 1 / 2,
      cumulativeToleranceIn: 1,
      coverUnderToleranceIn: 3 / 8,
      coverOverToleranceIn: 1,
    },
    roughIn: {
      heightToleranceIn: 1 / 2,
      offsetToleranceIn: 1 / 2,
      alignmentToleranceIn: 1 / 4,
    },
    openings: {
      widthToleranceIn: 1 / 4,
      heightToleranceIn: 1 / 4,
      squarenessToleranceIn: 1 / 4,
      plumbToleranceIn: 1 / 4,
      levelToleranceIn: 1 / 4,
      offsetToleranceIn: 1 / 2,
    },
  },
  {
    id: 'loose',
    name: 'Loose (rough / concealed work)',
    sourceNote: UNVERIFIED,
    framing: { spacingToleranceIn: 3 / 8, cumulativeToleranceIn: 1 / 2 },
    rebar: {
      spacingToleranceIn: 1,
      cumulativeToleranceIn: 2,
      coverUnderToleranceIn: 1 / 2,
    },
    roughIn: {
      heightToleranceIn: 1,
      offsetToleranceIn: 1,
      alignmentToleranceIn: 1 / 2,
    },
    openings: {
      widthToleranceIn: 1 / 2,
      heightToleranceIn: 1 / 2,
      squarenessToleranceIn: 1 / 2,
      plumbToleranceIn: 3 / 8,
      levelToleranceIn: 3 / 8,
      offsetToleranceIn: 1,
    },
  },
];

/**
 * Common rough-in heights above finished floor, offered in the UI.
 *
 * Labels are kept short deliberately: they render as preset chips on a phone
 * held in one hand, and a long label wraps to two lines and makes the row of
 * buttons ragged.
 */
export const COMMON_ROUGH_IN_HEIGHTS_IN: readonly { label: string; heightIn: number }[] = [
  { label: 'Outlet', heightIn: 18 },
  { label: 'Switch', heightIn: 48 },
  { label: 'Counter', heightIn: 42 },
  { label: 'Stat', heightIn: 48 },
  { label: 'Data', heightIn: 18 },
];

export const DEFAULT_PROFILE_ID = 'standard';

export function getProfile(id: string): ToleranceProfile {
  const found = TOLERANCE_PROFILES.find((p) => p.id === id);
  if (found) return found;
  const fallback = TOLERANCE_PROFILES.find((p) => p.id === DEFAULT_PROFILE_ID);
  if (!fallback) throw new Error('No tolerance profiles are defined');
  return fallback;
}

/** Common on-centre layouts offered in the UI. Free entry is also allowed. */
export const COMMON_FRAMING_OC_IN: readonly number[] = [12, 16, 19.2, 24];
export const COMMON_REBAR_OC_IN: readonly number[] = [6, 8, 10, 12, 16, 18, 24];
