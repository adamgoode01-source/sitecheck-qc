/**
 * On-centre spacing analysis for a run of repeating members.
 *
 * Shared by framing (studs, joists) and reinforcing (bars in a mat), because
 * the question is identical: given points marked on a run, are consecutive
 * members at the specified spacing, and has the layout drifted?
 *
 * Everything in and out of this module is INCHES.
 *
 * Two failures get reported separately because they have different
 * consequences on site:
 *
 *   - Individual spacing error: one bay is wrong. Local problem.
 *   - Cumulative layout drift: every bay is slightly over, and by the eighth
 *     stud the layout is an inch off. Each bay passes, yet sheathing no
 *     longer breaks on a stud. Only visible when you sum the run, which is
 *     exactly what a tape-and-eyeball check in the field tends to miss.
 */

import {
  type Line3,
  type Vec3,
  fitLine3,
  orientLineAlong,
  projectOntoLine,
} from './geometry';

export interface SpacingOptions {
  /** Specified on-centre dimension, inches (e.g. 16 or 24). */
  nominalOC: number;
  /** Allowed +/- deviation on any single bay, inches. */
  spacingTolerance: number;
  /**
   * Allowed +/- drift of any member from its ideal layout position measured
   * from the first member, inches. Undefined disables the drift check.
   */
  cumulativeTolerance?: number;
  /**
   * Reject the capture outright if points deviate from a straight line by
   * more than this RMS, inches. Guards against taps that hit the floor, a
   * passing worker, or thin air.
   */
  maxFitRms?: number;
  /**
   * Treat a bay close to a whole multiple of the nominal spacing as a
   * missing member rather than a wildly out-of-tolerance bay. On by default:
   * it is the difference between "one stud is 16 inches out" and "a stud is
   * absent", and the second is what the report should say.
   */
  detectMissingMembers?: boolean;
}

export type SpacingStatus = 'pass' | 'fail';

export interface SpacingEntry {
  /** Indices into the ordered point list, not the order they were tapped. */
  fromIndex: number;
  toIndex: number;
  /** Measured centre-to-centre distance, inches. */
  actualIn: number;
  /** actual - (nominal * impliedBays), inches. Signed. */
  deviationIn: number;
  /** How many nominal bays this gap appears to span. 1 unless a member is missing. */
  impliedBays: number;
  missingMembers: boolean;
  status: SpacingStatus;
}

export interface DriftEntry {
  index: number;
  /** Distance from the first member along the run, inches. */
  positionIn: number;
  /** Where this member should sit if every bay were exact, inches. */
  idealIn: number;
  /** position - ideal, inches. Signed. */
  driftIn: number;
  status: SpacingStatus;
}

export interface SpacingAnalysis {
  /** Best-fit run direction, oriented from the first tapped point onward. */
  axis: Line3;
  fitRmsIn: number;
  fitMaxDeviationIn: number;
  /**
   * False when the points do not describe a straight run. Callers must not
   * report spacings from an untrusted capture as findings.
   */
  captureTrusted: boolean;
  /** Positions along the axis, ascending, measured from the first member. */
  positionsIn: number[];
  /** Maps ordered index back to the index in the caller's input array. */
  sourceIndices: number[];
  spacings: SpacingEntry[];
  drift: DriftEntry[];
  summary: SpacingSummary;
}

export interface SpacingSummary {
  memberCount: number;
  baysMeasured: number;
  minSpacingIn: number;
  maxSpacingIn: number;
  meanSpacingIn: number;
  /** Largest absolute single-bay deviation, inches. */
  maxAbsDeviationIn: number;
  /** Largest absolute cumulative drift, inches. Zero when drift is unchecked. */
  maxAbsDriftIn: number;
  failedBays: number;
  missingMemberGaps: number;
  overallRunIn: number;
  status: SpacingStatus;
}

const DEFAULT_MAX_FIT_RMS_IN = 0.75;

/**
 * Analyse tapped member positions.
 *
 * `points` are member centres in a consistent 3D frame, already converted to
 * inches. They do not need to be tapped in order — they are projected onto
 * the fitted run axis and sorted, so a worker can back-fill a stud they
 * skipped without invalidating the capture.
 */
export function analyseSpacing(points: readonly Vec3[], options: SpacingOptions): SpacingAnalysis {
  if (points.length < 2) {
    throw new Error('Spacing analysis needs at least 2 marked members');
  }
  if (!(options.nominalOC > 0)) {
    throw new Error('Nominal on-centre spacing must be greater than zero');
  }
  if (!(options.spacingTolerance >= 0)) {
    throw new Error('Spacing tolerance cannot be negative');
  }

  const detectMissing = options.detectMissingMembers ?? true;
  const maxFitRms = options.maxFitRms ?? DEFAULT_MAX_FIT_RMS_IN;

  const fit = fitLine3(points);
  const first = points[0] as Vec3;
  const last = points[points.length - 1] as Vec3;
  const axis = orientLineAlong(fit.line, first, last);

  const projected = points
    .map((p, sourceIndex) => ({ sourceIndex, t: projectOntoLine(p, axis) }))
    .sort((a, b) => a.t - b.t);

  const zero = projected[0]?.t ?? 0;
  const positionsIn = projected.map((p) => p.t - zero);
  const sourceIndices = projected.map((p) => p.sourceIndex);

  const spacings = buildSpacings(positionsIn, options, detectMissing);
  const drift = buildDrift(positionsIn, spacings, options);

  return {
    axis,
    fitRmsIn: fit.rms,
    fitMaxDeviationIn: fit.maxDeviation,
    captureTrusted: fit.rms <= maxFitRms,
    positionsIn,
    sourceIndices,
    spacings,
    drift,
    summary: summarise(positionsIn, spacings, drift),
  };
}

function buildSpacings(
  positionsIn: readonly number[],
  options: SpacingOptions,
  detectMissing: boolean,
): SpacingEntry[] {
  const entries: SpacingEntry[] = [];

  for (let i = 1; i < positionsIn.length; i++) {
    const actualIn = (positionsIn[i] as number) - (positionsIn[i - 1] as number);
    const impliedBays = detectMissing ? impliedBayCount(actualIn, options) : 1;
    const deviationIn = actualIn - options.nominalOC * impliedBays;

    entries.push({
      fromIndex: i - 1,
      toIndex: i,
      actualIn,
      deviationIn,
      impliedBays,
      missingMembers: impliedBays > 1,
      status: Math.abs(deviationIn) <= options.spacingTolerance ? 'pass' : 'fail',
    });
  }

  return entries;
}

/**
 * How many nominal bays a gap spans.
 *
 * A gap only counts as spanning multiple bays when it lands near a whole
 * multiple AND is much closer to that multiple than to a single bay — so a
 * genuinely botched 30-inch stud bay at 16 OC still reads as one bad bay,
 * while a clean 32-inch gap reads as a missing stud.
 */
function impliedBayCount(actualIn: number, options: SpacingOptions): number {
  const ratio = actualIn / options.nominalOC;
  if (ratio < 1.5) return 1;

  const nearest = Math.max(2, Math.round(ratio));
  const errorAtMultiple = Math.abs(actualIn - options.nominalOC * nearest);
  // Allow a little more slack than a single bay, since a missing member means
  // two bays' worth of accumulated error shows up in one gap.
  const allowance = Math.max(options.spacingTolerance * 2, options.nominalOC * 0.15);

  return errorAtMultiple <= allowance ? nearest : 1;
}

function buildDrift(
  positionsIn: readonly number[],
  spacings: readonly SpacingEntry[],
  options: SpacingOptions,
): DriftEntry[] {
  const tolerance = options.cumulativeTolerance;
  const entries: DriftEntry[] = [];

  let bays = 0;
  for (let i = 0; i < positionsIn.length; i++) {
    if (i > 0) bays += (spacings[i - 1] as SpacingEntry).impliedBays;

    const positionIn = positionsIn[i] as number;
    const idealIn = bays * options.nominalOC;
    const driftIn = positionIn - idealIn;

    entries.push({
      index: i,
      positionIn,
      idealIn,
      driftIn,
      status: tolerance === undefined || Math.abs(driftIn) <= tolerance ? 'pass' : 'fail',
    });
  }

  return entries;
}

function summarise(
  positionsIn: readonly number[],
  spacings: readonly SpacingEntry[],
  drift: readonly DriftEntry[],
): SpacingSummary {
  const actuals = spacings.map((s) => s.actualIn);
  const sum = actuals.reduce((acc, n) => acc + n, 0);

  const maxAbsDeviationIn = spacings.reduce((acc, s) => Math.max(acc, Math.abs(s.deviationIn)), 0);
  const maxAbsDriftIn = drift.reduce((acc, d) => Math.max(acc, Math.abs(d.driftIn)), 0);
  const failedBays = spacings.filter((s) => s.status === 'fail').length;
  const driftFailures = drift.filter((d) => d.status === 'fail').length;

  return {
    memberCount: positionsIn.length,
    baysMeasured: spacings.length,
    minSpacingIn: actuals.length ? Math.min(...actuals) : 0,
    maxSpacingIn: actuals.length ? Math.max(...actuals) : 0,
    meanSpacingIn: actuals.length ? sum / actuals.length : 0,
    maxAbsDeviationIn,
    maxAbsDriftIn,
    failedBays,
    missingMemberGaps: spacings.filter((s) => s.missingMembers).length,
    overallRunIn: (positionsIn[positionsIn.length - 1] as number) - (positionsIn[0] as number),
    status: failedBays === 0 && driftFailures === 0 ? 'pass' : 'fail',
  };
}
