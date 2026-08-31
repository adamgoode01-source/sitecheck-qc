/**
 * Door and window rough openings.
 *
 * Four taps — one per corner — answer every question worth asking, which is
 * why the capture is built around corners rather than around separate width
 * and height measurements:
 *
 *   Width and height     do the leaf and frame fit at all
 *   Diagonal difference  is it square; a prehung door will not go into a
 *                        racked opening no matter how right the width is
 *   Jamb plumb           will the door swing or drift
 *   Sill level           will the unit sit without shimming
 *   Planarity            is the opening twisted, i.e. all four corners not
 *                        in one plane, which no 2D check can see at all
 *
 * The corners may be tapped in any order. They are sorted using gravity, so
 * the caller supplies which way is up — ARKit world space is gravity-aligned,
 * while a photograph's Y axis points down the image.
 *
 * All lengths are INCHES.
 */

import {
  type Plane,
  type Vec3,
  cross,
  distance,
  dot,
  fitPlane3,
  magnitude,
  normalize,
  scale,
  sub,
  vec,
} from './geometry';

export const UP_Y: Vec3 = { x: 0, y: 1, z: 0 };

export type OpeningKind = 'door' | 'window' | 'other';

export interface OpeningOptions {
  /** Specified rough opening width, inches. */
  specifiedWidthIn: number;
  /** Specified rough opening height, inches. */
  specifiedHeightIn: number;
  widthToleranceIn: number;
  heightToleranceIn: number;
  /** Allowed difference between the two diagonals, inches. */
  squarenessToleranceIn: number;
  /** Allowed horizontal wander of a jamb over its full height, inches. */
  plumbToleranceIn: number;
  /** Allowed height difference across the sill, inches. */
  levelToleranceIn: number;
  /** Specified horizontal distance from the datum to the near jamb, inches. */
  specifiedOffsetIn?: number;
  offsetToleranceIn?: number;
  /** Which way is up in the capture frame. Defaults to +Y. */
  up?: Vec3;
  /** Reject the capture if the corners are not coplanar to this RMS, inches. */
  maxPlanarityRms?: number;
}

export interface OrderedCorners {
  bottomLeft: Vec3;
  bottomRight: Vec3;
  topRight: Vec3;
  topLeft: Vec3;
}

export interface OpeningMeasurements {
  bottomWidthIn: number;
  topWidthIn: number;
  leftHeightIn: number;
  rightHeightIn: number;
  /** Mean of the two widths — what gets compared against the spec. */
  widthIn: number;
  heightIn: number;
  diagonal1In: number;
  diagonal2In: number;
  /** |diagonal1 - diagonal2|. Zero on a perfectly square opening. */
  diagonalDifferenceIn: number;
  /** Horizontal wander of each jamb over its height, inches. */
  leftJambOutOfPlumbIn: number;
  rightJambOutOfPlumbIn: number;
  /** Height difference across the sill and the head, inches. */
  sillOutOfLevelIn: number;
  headOutOfLevelIn: number;
  /** Horizontal distance from the datum to the nearer jamb, inches. */
  offsetIn?: number;
}

export type OpeningIssue =
  | 'width'
  | 'height'
  | 'square'
  | 'plumb'
  | 'level'
  | 'offset'
  | 'twist';

export interface OpeningAnalysis {
  wallPlane: Plane;
  planarityRmsIn: number;
  captureTrusted: boolean;
  corners: OrderedCorners;
  measurements: OpeningMeasurements;
  /** Signed deviations from spec, inches. */
  widthDeviationIn: number;
  heightDeviationIn: number;
  offsetDeviationIn?: number;
  issues: OpeningIssue[];
  status: 'pass' | 'fail';
}

const DEFAULT_MAX_PLANARITY_RMS_IN = 0.25;

export function analyseOpening(
  cornerPoints: readonly Vec3[],
  options: OpeningOptions,
  datumPoint?: Vec3,
): OpeningAnalysis {
  if (cornerPoints.length !== 4) {
    throw new Error(`An opening needs exactly 4 corners, got ${cornerPoints.length}`);
  }

  const up = options.up ?? UP_Y;
  const maxPlanarityRms = options.maxPlanarityRms ?? DEFAULT_MAX_PLANARITY_RMS_IN;

  const fit = fitPlane3(cornerPoints);
  const corners = orderCorners(cornerPoints, fit.plane, up);
  const measurements = measure(corners, fit.plane, up, datumPoint);

  const widthDeviationIn = measurements.widthIn - options.specifiedWidthIn;
  const heightDeviationIn = measurements.heightIn - options.specifiedHeightIn;

  const offsetDeviationIn =
    measurements.offsetIn !== undefined && options.specifiedOffsetIn !== undefined
      ? measurements.offsetIn - options.specifiedOffsetIn
      : undefined;

  const issues: OpeningIssue[] = [];
  if (Math.abs(widthDeviationIn) > options.widthToleranceIn) issues.push('width');
  if (Math.abs(heightDeviationIn) > options.heightToleranceIn) issues.push('height');
  if (measurements.diagonalDifferenceIn > options.squarenessToleranceIn) issues.push('square');
  if (
    Math.max(measurements.leftJambOutOfPlumbIn, measurements.rightJambOutOfPlumbIn) >
    options.plumbToleranceIn
  ) {
    issues.push('plumb');
  }
  if (
    Math.max(measurements.sillOutOfLevelIn, measurements.headOutOfLevelIn) >
    options.levelToleranceIn
  ) {
    issues.push('level');
  }
  if (
    offsetDeviationIn !== undefined &&
    Math.abs(offsetDeviationIn) > (options.offsetToleranceIn ?? 0)
  ) {
    issues.push('offset');
  }
  // Non-planar corners are a twisted opening, not a bad capture, once the
  // points themselves were confidently placed. Reported either way.
  if (fit.rms > maxPlanarityRms) issues.push('twist');

  return {
    wallPlane: fit.plane,
    planarityRmsIn: fit.rms,
    captureTrusted: fit.rms <= maxPlanarityRms,
    corners,
    measurements,
    widthDeviationIn,
    heightDeviationIn,
    offsetDeviationIn,
    issues,
    status: issues.length === 0 ? 'pass' : 'fail',
  };
}

/**
 * Sort four arbitrary taps into bottom-left, bottom-right, top-right, top-left.
 *
 * Works in the plane of the wall using gravity for "up" and an arbitrary but
 * consistent in-plane right. Which physical side ends up called "left" does
 * not matter — every measurement below is symmetric — but the pairing does,
 * because measuring a diagonal as if it were a side would silently pass a
 * badly racked opening.
 */
export function orderCorners(points: readonly Vec3[], plane: Plane, up: Vec3): OrderedCorners {
  const axes = inPlaneAxes(plane, up);

  const projected = points.map((p) => {
    const d = sub(p, plane.origin);
    return { point: p, u: dot(d, axes.right), v: dot(d, axes.up) };
  });

  const byHeight = [...projected].sort((a, b) => a.v - b.v);
  const bottom = byHeight.slice(0, 2).sort((a, b) => a.u - b.u);
  const top = byHeight.slice(2).sort((a, b) => a.u - b.u);

  return {
    bottomLeft: (bottom[0] as { point: Vec3 }).point,
    bottomRight: (bottom[1] as { point: Vec3 }).point,
    topLeft: (top[0] as { point: Vec3 }).point,
    topRight: (top[1] as { point: Vec3 }).point,
  };
}

/** Orthonormal axes lying in the wall plane: one up, one across. */
export function inPlaneAxes(plane: Plane, up: Vec3): { up: Vec3; right: Vec3 } {
  const alongNormal = dot(up, plane.normal);
  const projectedUp = sub(up, scale(plane.normal, alongNormal));

  // Degenerate only if the "wall" is horizontal, i.e. up is parallel to the
  // normal. Fall back to any in-plane direction so we still return a frame.
  const inPlaneUp =
    magnitude(projectedUp) < 1e-6 ? anyPerpendicular(plane.normal) : normalize(projectedUp);

  return { up: inPlaneUp, right: normalize(cross(inPlaneUp, plane.normal)) };
}

function anyPerpendicular(normal: Vec3): Vec3 {
  const seed = Math.abs(normal.x) < 0.9 ? vec(1, 0, 0) : vec(0, 1, 0);
  return normalize(cross(normal, seed));
}

function measure(
  corners: OrderedCorners,
  plane: Plane,
  up: Vec3,
  datumPoint?: Vec3,
): OpeningMeasurements {
  const { bottomLeft, bottomRight, topLeft, topRight } = corners;
  const axes = inPlaneAxes(plane, up);

  const bottomWidthIn = distance(bottomLeft, bottomRight);
  const topWidthIn = distance(topLeft, topRight);
  const leftHeightIn = distance(bottomLeft, topLeft);
  const rightHeightIn = distance(bottomRight, topRight);

  const diagonal1In = distance(bottomLeft, topRight);
  const diagonal2In = distance(bottomRight, topLeft);

  const heightOf = (p: Vec3) => dot(sub(p, plane.origin), axes.up);
  const acrossOf = (p: Vec3) => dot(sub(p, plane.origin), axes.right);

  const measurements: OpeningMeasurements = {
    bottomWidthIn,
    topWidthIn,
    leftHeightIn,
    rightHeightIn,
    widthIn: (bottomWidthIn + topWidthIn) / 2,
    heightIn: (leftHeightIn + rightHeightIn) / 2,
    diagonal1In,
    diagonal2In,
    diagonalDifferenceIn: Math.abs(diagonal1In - diagonal2In),
    leftJambOutOfPlumbIn: Math.abs(acrossOf(topLeft) - acrossOf(bottomLeft)),
    rightJambOutOfPlumbIn: Math.abs(acrossOf(topRight) - acrossOf(bottomRight)),
    sillOutOfLevelIn: Math.abs(heightOf(bottomRight) - heightOf(bottomLeft)),
    headOutOfLevelIn: Math.abs(heightOf(topRight) - heightOf(topLeft)),
  };

  if (datumPoint) {
    // Measured to whichever jamb is nearer, since a drawing dimensions from
    // the reference to the opening, not to a particular side of it.
    const toLeft = Math.abs(acrossOf(bottomLeft) - acrossOf(datumPoint));
    const toRight = Math.abs(acrossOf(bottomRight) - acrossOf(datumPoint));
    measurements.offsetIn = Math.min(toLeft, toRight);
  }

  return measurements;
}

/** Common rough-opening allowance over the door leaf size, for the UI to suggest. */
export const DOOR_RO_ALLOWANCE_IN = { width: 2, height: 2.5 };
