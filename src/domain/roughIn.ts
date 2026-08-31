/**
 * Rough-in locations: electrical boxes, plumbing stub-outs, HVAC penetrations.
 *
 * Two independent questions, and they fail for different reasons:
 *
 *   Height above floor — wrong when someone worked off the wrong datum, and
 *   wrong for every box on the job at once.
 *
 *   Offset from a datum — wrong when someone eyeballed off the nearest stud
 *   instead of pulling from the corner, and wrong for one box at a time.
 *
 * There is also a third thing nobody specifies but everybody notices:
 * whether a row of boxes is at the SAME height as each other. Two switches
 * beside a door at 47 3/4" and 48 1/4" both pass a +/-1/2" spec and look
 * obviously wrong on the wall. That is checked separately.
 *
 * All lengths are INCHES.
 */

import {
  type Plane,
  type Vec3,
  fitPlane3,
  magnitude,
  orientPlaneToward,
  scale,
  signedDistanceToPlane,
  sub,
} from './geometry';

export interface RoughInOptions {
  /** Specified height above FINISHED floor, inches. */
  specifiedHeightIn: number;
  heightToleranceIn: number;
  /**
   * Thickness of floor build-up still to be added over the surface that was
   * captured, inches.
   *
   * This is the classic way a whole floor of rough-in ends up wrong. At
   * rough-in the captured surface is bare slab, while the drawing dimension
   * is to FINISHED floor. With 1 1/2" of topping and finish to come, a box
   * set 18" off the slab lands at 16 1/2" AFF — outside any tolerance, and
   * invisible until the floor goes down.
   */
  floorBuildUpIn?: number;
  /**
   * Specified horizontal distance from the datum point, inches. Omit to skip
   * the offset check — it is then reported as not assessed, not as a pass.
   */
  specifiedOffsetIn?: number;
  offsetToleranceIn?: number;
  /**
   * Maximum acceptable spread between the highest and lowest fixture in the
   * set. Omit to skip the alignment check.
   */
  alignmentToleranceIn?: number;
  /** Reject the floor capture if it is not flat to this RMS, inches. */
  maxFloorFitRms?: number;
}

export type RoughInStatus = 'pass' | 'high' | 'low';
export type OffsetStatus = 'pass' | 'long' | 'short' | 'not-checked';

export interface RoughInEntry {
  index: number;
  /** Height above the captured surface, inches. */
  heightAboveCapturedIn: number;
  /** Height above finished floor once build-up is allowed for, inches. */
  heightAffIn: number;
  heightDeviationIn: number;
  heightStatus: RoughInStatus;
  /** Horizontal distance from the datum, measured in the floor plane, inches. */
  offsetIn?: number;
  offsetDeviationIn?: number;
  offsetStatus: OffsetStatus;
}

export interface RoughInAnalysis {
  floorPlane: Plane;
  floorFitRmsIn: number;
  captureTrusted: boolean;
  /**
   * False when only three floor points were taken. Three points fit a plane
   * exactly, so `floorFitRmsIn` is meaningless — see `PlaneFit.verifiable`.
   */
  flatnessVerified: boolean;
  entries: RoughInEntry[];
  summary: RoughInSummary;
}

export interface RoughInSummary {
  fixturesMeasured: number;
  minHeightAffIn: number;
  maxHeightAffIn: number;
  /** max - min across the set: how level the row is with itself, inches. */
  heightSpreadIn: number;
  outOfHeightTolerance: number;
  outOfOffsetTolerance: number;
  alignmentChecked: boolean;
  alignmentPass: boolean;
  status: 'pass' | 'fail';
}

const DEFAULT_MAX_FLOOR_FIT_RMS_IN = 0.75;

/**
 * Analyse rough-in positions against a captured floor and an optional datum.
 *
 * `floorPoints` are three or more taps on the slab or floor. `datumPoint` is
 * the corner, jamb, or grid line the drawing dimensions from — omit it and
 * offsets simply are not reported.
 */
export function analyseRoughIn(
  fixturePoints: readonly Vec3[],
  floorPoints: readonly Vec3[],
  options: RoughInOptions,
  datumPoint?: Vec3,
): RoughInAnalysis {
  if (fixturePoints.length < 1) throw new Error('Rough-in analysis needs at least 1 fixture');
  if (floorPoints.length < 3) throw new Error('Rough-in analysis needs at least 3 points on the floor');

  const buildUp = options.floorBuildUpIn ?? 0;
  const maxRms = options.maxFloorFitRms ?? DEFAULT_MAX_FLOOR_FIT_RMS_IN;

  const fit = fitPlane3(floorPoints);
  // Orient the floor normal upward, toward the fixtures, so heights are positive.
  const floorPlane = orientPlaneToward(fit.plane, fixturePoints[0] as Vec3);

  const checkOffset = options.specifiedOffsetIn !== undefined && datumPoint !== undefined;
  const offsetTolerance = options.offsetToleranceIn ?? 0;

  const entries: RoughInEntry[] = fixturePoints.map((point, index) => {
    const heightAboveCapturedIn = signedDistanceToPlane(point, floorPlane);
    const heightAffIn = heightAboveCapturedIn - buildUp;
    const heightDeviationIn = heightAffIn - options.specifiedHeightIn;

    let heightStatus: RoughInStatus = 'pass';
    if (heightDeviationIn > options.heightToleranceIn) heightStatus = 'high';
    else if (heightDeviationIn < -options.heightToleranceIn) heightStatus = 'low';

    let offsetIn: number | undefined;
    let offsetDeviationIn: number | undefined;
    let offsetStatus: OffsetStatus = 'not-checked';

    if (checkOffset && datumPoint) {
      offsetIn = horizontalDistance(point, datumPoint, floorPlane);
      offsetDeviationIn = offsetIn - (options.specifiedOffsetIn as number);
      offsetStatus =
        offsetDeviationIn > offsetTolerance
          ? 'long'
          : offsetDeviationIn < -offsetTolerance
            ? 'short'
            : 'pass';
    }

    return {
      index,
      heightAboveCapturedIn,
      heightAffIn,
      heightDeviationIn,
      heightStatus,
      offsetIn,
      offsetDeviationIn,
      offsetStatus,
    };
  });

  const heights = entries.map((e) => e.heightAffIn);
  const minHeightAffIn = Math.min(...heights);
  const maxHeightAffIn = Math.max(...heights);
  const heightSpreadIn = maxHeightAffIn - minHeightAffIn;

  const alignmentChecked =
    options.alignmentToleranceIn !== undefined && fixturePoints.length > 1;
  const alignmentPass =
    !alignmentChecked || heightSpreadIn <= (options.alignmentToleranceIn as number);

  const outOfHeightTolerance = entries.filter((e) => e.heightStatus !== 'pass').length;
  const outOfOffsetTolerance = entries.filter(
    (e) => e.offsetStatus === 'long' || e.offsetStatus === 'short',
  ).length;

  return {
    floorPlane,
    floorFitRmsIn: fit.rms,
    captureTrusted: fit.rms <= maxRms,
    flatnessVerified: fit.verifiable,
    entries,
    summary: {
      fixturesMeasured: entries.length,
      minHeightAffIn,
      maxHeightAffIn,
      heightSpreadIn,
      outOfHeightTolerance,
      outOfOffsetTolerance,
      alignmentChecked,
      alignmentPass,
      status:
        outOfHeightTolerance === 0 && outOfOffsetTolerance === 0 && alignmentPass
          ? 'pass'
          : 'fail',
    },
  };
}

/**
 * Distance between two points measured in the plane of the floor — i.e. with
 * any height difference removed.
 *
 * Straight-line distance would be wrong: a box 48" up and 12" along from a
 * corner is 12" away by the drawing and 49 1/2" away in 3D. The drawing
 * dimension is always the plan distance.
 */
export function horizontalDistance(a: Vec3, b: Vec3, floor: Plane): number {
  const delta = sub(a, b);
  const vertical = signedDistanceToPlane(a, floor) - signedDistanceToPlane(b, floor);
  // Remove the component along the floor normal, leaving the in-plane part.
  return magnitude(sub(delta, scale(floor.normal, vertical)));
}
