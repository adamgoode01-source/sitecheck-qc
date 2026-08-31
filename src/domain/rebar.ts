/**
 * Reinforcing steel: bar sizes and concrete cover.
 *
 * Cover is measured from the form face to the nearest bar surface ("clear
 * cover"). A depth sensor gives us the distance to whatever surface the ray
 * hit, so converting that to clear cover depends on WHERE on the bar the
 * user tapped. Getting this wrong biases every reading by up to a full bar
 * diameter — on a #5 bar that is 5/8 inch, which is larger than the entire
 * tolerance being checked. Hence the explicit convention below rather than a
 * silent assumption.
 *
 * All lengths are INCHES.
 */

import {
  type Plane,
  type Vec3,
  fitPlane3,
  orientPlaneToward,
  signedDistanceToPlane,
} from './geometry';

/** Nominal diameters, ASTM A615 imperial bar designations. */
export const BAR_DIAMETERS_IN: Readonly<Record<string, number>> = {
  '#3': 0.375,
  '#4': 0.5,
  '#5': 0.625,
  '#6': 0.75,
  '#7': 0.875,
  '#8': 1.0,
  '#9': 1.128,
  '#10': 1.27,
  '#11': 1.41,
  '#14': 1.693,
  '#18': 2.257,
};

export type BarSize = keyof typeof BAR_DIAMETERS_IN;

export const BAR_SIZES: readonly string[] = Object.keys(BAR_DIAMETERS_IN);

export function barDiameterIn(size: string): number {
  const d = BAR_DIAMETERS_IN[size];
  if (d === undefined) throw new Error(`Unknown bar size: ${size}`);
  return d;
}

/**
 * Where on the bar the user's tap landed, relative to the form face.
 *
 * Default is `far-crown`: standing in front of a wall form or over a slab
 * mat, the ray naturally hits the face of the bar closest to the camera,
 * which is the face furthest from the form.
 */
export type BarHitConvention = 'far-crown' | 'centreline' | 'near-face';

export interface CoverOptions {
  barSize: string;
  /** Specified minimum clear cover from the contract documents, inches. */
  specifiedCoverIn: number;
  /**
   * How much LESS than specified is acceptable, inches. Cover tolerances are
   * normally one-sided — under-cover is the durability problem.
   */
  underToleranceIn: number;
  /**
   * How much MORE than specified is acceptable, inches. Excess cover reduces
   * effective depth and therefore capacity, so it is worth flagging, but many
   * specs are silent on it. Undefined disables the over-cover check.
   */
  overToleranceIn?: number;
  hitConvention?: BarHitConvention;
  /**
   * Reject the form-plane capture if the points deviate from flat by more
   * than this RMS, inches. A bowed or mis-tapped plane poisons every reading.
   */
  maxPlaneFitRms?: number;
}

export type CoverStatus = 'pass' | 'under' | 'over';

export interface CoverEntry {
  index: number;
  /** Raw sensor distance from the form plane to the tapped point, inches. */
  rawDistanceIn: number;
  /** Distance converted to clear cover using the hit convention, inches. */
  clearCoverIn: number;
  /** clearCover - specified, inches. Signed. */
  deviationIn: number;
  status: CoverStatus;
}

export interface CoverAnalysis {
  formPlane: Plane;
  planeFitRmsIn: number;
  /** False when the form-face points do not describe a flat plane. */
  captureTrusted: boolean;
  /**
   * False when only three form-face points were taken. Three points fit a
   * plane exactly, so `planeFitRmsIn` proves nothing — see
   * `PlaneFit.verifiable`.
   */
  flatnessVerified: boolean;
  entries: CoverEntry[];
  summary: CoverSummary;
}

export interface CoverSummary {
  barsMeasured: number;
  minCoverIn: number;
  maxCoverIn: number;
  meanCoverIn: number;
  underCount: number;
  overCount: number;
  status: 'pass' | 'fail';
}

const DEFAULT_MAX_PLANE_FIT_RMS_IN = 0.5;

/**
 * Convert a measured surface distance into clear cover.
 *
 * Form face sits at 0 with the plane normal pointing toward the steel. A bar
 * with clear cover `c` and diameter `d` has its near face at `c`, its centre
 * at `c + d/2`, and its far crown at `c + d`.
 */
export function surfaceDistanceToClearCover(
  rawDistanceIn: number,
  diameterIn: number,
  convention: BarHitConvention,
): number {
  switch (convention) {
    case 'near-face':
      return rawDistanceIn;
    case 'centreline':
      return rawDistanceIn - diameterIn / 2;
    case 'far-crown':
      return rawDistanceIn - diameterIn;
    default:
      throw new Error(`Unknown bar hit convention: ${String(convention)}`);
  }
}

/**
 * Analyse concrete cover for a set of tapped bars against a captured form face.
 *
 * `formFacePoints` are 3 or more taps on the form/soffit surface itself.
 * `barPoints` are taps on the bars. `cameraPosition`, when supplied, orients
 * the plane normal so cover comes out positive no matter which side of the
 * wall the inspector is standing on; without it the bar centroid is used.
 */
export function analyseCover(
  barPoints: readonly Vec3[],
  formFacePoints: readonly Vec3[],
  options: CoverOptions,
  cameraPosition?: Vec3,
): CoverAnalysis {
  if (barPoints.length < 1) throw new Error('Cover analysis needs at least 1 marked bar');
  if (formFacePoints.length < 3) {
    throw new Error('Cover analysis needs at least 3 points on the form face');
  }

  const diameterIn = barDiameterIn(options.barSize);
  const convention = options.hitConvention ?? 'far-crown';
  const maxPlaneFitRms = options.maxPlaneFitRms ?? DEFAULT_MAX_PLANE_FIT_RMS_IN;

  const fit = fitPlane3(formFacePoints);
  const reference = cameraPosition ?? averagePoint(barPoints);
  const formPlane = orientPlaneToward(fit.plane, reference);

  const entries: CoverEntry[] = barPoints.map((p, index) => {
    const rawDistanceIn = signedDistanceToPlane(p, formPlane);
    const clearCoverIn = surfaceDistanceToClearCover(rawDistanceIn, diameterIn, convention);
    const deviationIn = clearCoverIn - options.specifiedCoverIn;

    let status: CoverStatus = 'pass';
    if (deviationIn < -options.underToleranceIn) status = 'under';
    else if (options.overToleranceIn !== undefined && deviationIn > options.overToleranceIn) {
      status = 'over';
    }

    return { index, rawDistanceIn, clearCoverIn, deviationIn, status };
  });

  const covers = entries.map((e) => e.clearCoverIn);
  const underCount = entries.filter((e) => e.status === 'under').length;
  const overCount = entries.filter((e) => e.status === 'over').length;

  return {
    formPlane,
    planeFitRmsIn: fit.rms,
    captureTrusted: fit.rms <= maxPlaneFitRms,
    flatnessVerified: fit.verifiable,
    entries,
    summary: {
      barsMeasured: entries.length,
      minCoverIn: Math.min(...covers),
      maxCoverIn: Math.max(...covers),
      meanCoverIn: covers.reduce((a, b) => a + b, 0) / covers.length,
      underCount,
      overCount,
      status: underCount === 0 && overCount === 0 ? 'pass' : 'fail',
    },
  };
}

function averagePoint(points: readonly Vec3[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (const p of points) {
    x += p.x;
    y += p.y;
    z += p.z;
  }
  const n = points.length;
  return { x: x / n, y: y / n, z: z / n };
}
