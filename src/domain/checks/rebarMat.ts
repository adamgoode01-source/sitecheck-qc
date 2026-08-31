/**
 * Reinforcing check: bar spacing across a mat, plus clear cover to the form face.
 *
 * Spacing reuses the same run analysis as framing. Cover is the part that is
 * specific to concrete, and it is the one that matters for durability — under
 * cover is what corrodes a structure twenty years later, and it is invisible
 * the moment the pour starts. This is the single highest-value thing to catch
 * before concrete arrives, which is why it is worth the extra step of
 * capturing the form face.
 */

import type { Vec3 } from '../geometry';
import {
  type CoverAnalysis,
  type CoverEntry,
  type CoverOptions,
  analyseCover,
  barDiameterIn,
} from '../rebar';
import {
  CONSOLIDATE_THRESHOLD,
  describeAffected,
  rangeOf,
  worstBy,
} from './grouping';
import { buildSpacingFindings } from './spacingFindings';
import { type SpacingAnalysis, analyseSpacing } from '../spacing';
import type { RebarTolerances } from '../tolerance';
import { formatDeviation, formatFeetInches, formatInches, formatTolerance } from '../units';
import { type CheckResult, type Finding, type MetricLine, statusFromFindings } from './types';

export interface RebarCheckInput {
  /** Taps on the bars being checked, inches, in the capture frame. */
  barPoints: readonly Vec3[];
  /**
   * Three or more taps on the form face / soffit / subgrade. Omit to run the
   * spacing check alone — cover is then simply not reported, rather than
   * guessed at.
   */
  formFacePoints?: readonly Vec3[];
  barSize: string;
  /** Specified bar spacing from the drawings, inches. */
  nominalOCIn: number;
  /** Specified minimum clear cover from the drawings, inches. */
  specifiedCoverIn?: number;
  hitConvention?: CoverOptions['hitConvention'];
  tolerances: RebarTolerances;
  /** Device position at capture, used to orient the form plane. */
  cameraPosition?: Vec3;
}

export const REBAR_CHECK_ID = 'rebar-mat';

export function runRebarCheck(input: RebarCheckInput): CheckResult {
  const checkName = `${input.barSize} bar at ${formatInches(input.nominalOCIn)} o.c.`;
  const findings: Finding[] = [];
  const metrics: MetricLine[] = [];

  let spacing: SpacingAnalysis | null = null;

  if (input.barPoints.length >= 2) {
    spacing = analyseSpacing(input.barPoints, {
      nominalOC: input.nominalOCIn,
      spacingTolerance: input.tolerances.spacingToleranceIn,
      cumulativeTolerance: input.tolerances.cumulativeToleranceIn,
      detectMissingMembers: true,
    });

    if (spacing.captureTrusted) {
      findings.push(...spacingFindings(spacing, input));
    } else {
      findings.push({
        code: 'RBR-CAPTURE',
        severity: 'invalid',
        title: 'Bar marks are not a straight run',
        detail: `The marked bars scatter ${formatInches(spacing.fitRmsIn)} RMS off a straight line. In a congested mat this usually means a tap picked up a crossing bar in the other direction. Re-mark along a single bar direction.`,
        measuredIn: spacing.fitRmsIn,
      });
    }

    metrics.push(...spacingMetrics(spacing, input));
  } else {
    findings.push({
      code: 'RBR-CAPTURE',
      severity: 'invalid',
      title: 'Not enough bars marked',
      detail: 'Mark at least two bars to measure spacing.',
    });
  }

  const cover = runCover(input, findings, metrics);
  if (cover) metrics.push(...coverMetrics(cover, input));

  return {
    checkId: REBAR_CHECK_ID,
    checkName,
    status: statusFromFindings(findings),
    findings,
    metrics,
    points: [...input.barPoints],
  };
}

function runCover(
  input: RebarCheckInput,
  findings: Finding[],
  _metrics: MetricLine[],
): CoverAnalysis | null {
  const { formFacePoints, specifiedCoverIn } = input;

  if (!formFacePoints || formFacePoints.length < 3 || specifiedCoverIn === undefined) {
    // Deliberately silent: cover was not requested, so nothing is claimed
    // about it. The report states which checks ran, so an omission is visible.
    return null;
  }

  const analysis = analyseCover(
    input.barPoints,
    formFacePoints,
    {
      barSize: input.barSize,
      specifiedCoverIn,
      underToleranceIn: input.tolerances.coverUnderToleranceIn,
      overToleranceIn: input.tolerances.coverOverToleranceIn,
      hitConvention: input.hitConvention ?? 'far-crown',
    },
    input.cameraPosition,
  );

  if (!analysis.captureTrusted) {
    findings.push({
      code: 'RBR-COVER-CAPTURE',
      severity: 'invalid',
      title: 'Form face is not flat enough to measure cover from',
      detail: `The points taken on the form deviate ${formatInches(analysis.planeFitRmsIn)} RMS from a plane. Cover measured against a bad reference plane is worse than no measurement. Re-take the form face on a clean, flat area.`,
      measuredIn: analysis.planeFitRmsIn,
    });
    return analysis;
  }

  if (!analysis.flatnessVerified) {
    findings.push({
      code: 'RBR-FORM-UNVERIFIED',
      severity: 'observation',
      title: 'Form face could not be checked for flatness',
      detail:
        'Only three points were taken on the form. Three points always fit a plane exactly, so there is no way to tell whether one landed on a tie, a chair or a bulge — and every cover reading is measured from that plane. Take four or more next time so the reference can be verified.',
    });
  }

  const under = analysis.entries.filter((e) => e.status === 'under');
  const over = analysis.entries.filter((e) => e.status === 'over');

  findings.push(
    ...coverFindings(under, {
      code: 'RBR-COVER-UNDER',
      severity: 'deficiency',
      totalBars: analysis.entries.length,
      specifiedCoverIn,
      singleTitle: (i) => `Bar ${i + 1} is short of cover`,
      groupTitle: (n) => `${n} bars short of cover`,
      closing: `Allowed reduction is ${formatInches(input.tolerances.coverUnderToleranceIn)}. Correct before the pour — this is not recoverable afterwards.`,
    }),
  );

  findings.push(
    ...coverFindings(over, {
      code: 'RBR-COVER-OVER',
      severity: 'observation',
      totalBars: analysis.entries.length,
      specifiedCoverIn,
      singleTitle: (i) => `Bar ${i + 1} has excess cover`,
      groupTitle: (n) => `${n} bars have excess cover`,
      closing:
        'Excess cover reduces effective depth and therefore capacity. Refer to the engineer of record if it is significant.',
    }),
  );

  if (under.length === 0 && over.length === 0) {
    findings.push({
      code: 'RBR-COVER-PASS',
      severity: 'pass',
      title: `Cover within tolerance on ${analysis.summary.barsMeasured} bars`,
      detail: `Clear cover ranged ${formatInches(analysis.summary.minCoverIn)} to ${formatInches(analysis.summary.maxCoverIn)} against ${formatInches(specifiedCoverIn)} specified.`,
    });
  }

  return analysis;
}

interface CoverGroupCopy {
  code: string;
  severity: Finding['severity'];
  totalBars: number;
  specifiedCoverIn: number;
  singleTitle: (index: number) => string;
  groupTitle: (count: number) => string;
  closing: string;
}

/**
 * One finding per bar while that is still readable; a single grouped finding
 * once it is not. The grouped form keeps the bar numbers and leads with the
 * worst reading, because that is the one that decides whether the pour stops.
 */
function coverFindings(entries: readonly CoverEntry[], copy: CoverGroupCopy): Finding[] {
  if (entries.length === 0) return [];

  if (entries.length < CONSOLIDATE_THRESHOLD) {
    return entries.map((entry) => ({
      code: copy.code,
      severity: copy.severity,
      title: copy.singleTitle(entry.index),
      detail: `Clear cover measured ${formatInches(entry.clearCoverIn)} against ${formatInches(copy.specifiedCoverIn)} specified, ${formatDeviation(entry.deviationIn)}. ${copy.closing}`,
      measuredIn: entry.clearCoverIn,
      expectedIn: copy.specifiedCoverIn,
      deviationIn: entry.deviationIn,
      memberIndex: entry.index,
      occurrences: 1,
      affectedIndexes: [entry.index],
    }));
  }

  const indices = entries.map((e) => e.index);
  const covers = entries.map((e) => e.clearCoverIn);
  const span = rangeOf(covers);
  const worst = worstBy(entries, (e) => e.deviationIn);
  const worstEntry = worst?.item as CoverEntry;

  const where = describeAffected(indices, copy.totalBars, 'bar', 'bars');
  const measured = span
    ? span.min === span.max
      ? `measured ${formatInches(span.min)}`
      : `measured ${formatInches(span.min)} to ${formatInches(span.max)}`
    : '';

  return [
    {
      code: copy.code,
      severity: copy.severity,
      title: copy.groupTitle(entries.length),
      detail: `${capitalise(where)} ${measured} clear cover against ${formatInches(copy.specifiedCoverIn)} specified. Worst is bar ${worstEntry.index + 1} at ${formatInches(worstEntry.clearCoverIn)}, ${formatDeviation(worstEntry.deviationIn)}. ${copy.closing}`,
      measuredIn: worstEntry.clearCoverIn,
      expectedIn: copy.specifiedCoverIn,
      deviationIn: worstEntry.deviationIn,
      memberIndex: worstEntry.index,
      occurrences: entries.length,
      affectedIndexes: indices,
    },
  ];
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function spacingFindings(analysis: SpacingAnalysis, input: RebarCheckInput): Finding[] {
  const findings: Finding[] = buildSpacingFindings(analysis, {
    spacingCode: 'RBR-SPACING',
    missingCode: 'RBR-MISSING',
    nominalOCIn: input.nominalOCIn,
    spacingToleranceIn: input.tolerances.spacingToleranceIn,
    bay: { one: 'bar space', many: 'bar spaces' },
    member: { one: 'bar', many: 'bars' },
    missingNote:
      'Confirm the bar count against the schedule — a missing bar reduces the area of steel provided.',
  });

  const worstDrift = analysis.drift
    .filter((d) => d.status === 'fail')
    .sort((a, b) => Math.abs(b.driftIn) - Math.abs(a.driftIn))[0];

  if (worstDrift) {
    findings.push({
      code: 'RBR-DRIFT',
      severity: 'deficiency',
      title: `Mat layout has drifted ${formatDeviation(worstDrift.driftIn)} by bar ${worstDrift.index + 1}`,
      detail: `Bar ${worstDrift.index + 1} sits at ${formatFeetInches(worstDrift.positionIn)} from the first bar where the layout puts it at ${formatFeetInches(worstDrift.idealIn)}. Allowed drift is ${formatTolerance(input.tolerances.cumulativeToleranceIn)}. Check that the total number of bars across the member still matches the schedule.`,
      measuredIn: worstDrift.positionIn,
      expectedIn: worstDrift.idealIn,
      deviationIn: worstDrift.driftIn,
      memberIndex: worstDrift.index,
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: 'RBR-SPACING-PASS',
      severity: 'pass',
      title: `${analysis.summary.baysMeasured} bar spaces within tolerance`,
      detail: `Spacing measured ${formatInches(analysis.summary.minSpacingIn)} to ${formatInches(analysis.summary.maxSpacingIn)} against ${formatInches(input.nominalOCIn)} specified.`,
    });
  }

  return findings;
}

function spacingMetrics(analysis: SpacingAnalysis, input: RebarCheckInput): MetricLine[] {
  const s = analysis.summary;
  return [
    { label: 'Bars marked', value: String(s.memberCount) },
    { label: 'Specified spacing', value: `${formatInches(input.nominalOCIn)} o.c.` },
    { label: 'Spacing range', value: `${formatInches(s.minSpacingIn)} to ${formatInches(s.maxSpacingIn)}` },
    {
      label: 'Worst spacing deviation',
      value: formatDeviation(s.maxAbsDeviationIn),
      emphasis: s.maxAbsDeviationIn <= input.tolerances.spacingToleranceIn ? 'good' : 'bad',
    },
    { label: 'Mat width measured', value: formatFeetInches(s.overallRunIn) },
  ];
}

function coverMetrics(analysis: CoverAnalysis, input: RebarCheckInput): MetricLine[] {
  const s = analysis.summary;
  const specified = input.specifiedCoverIn;
  return [
    { label: 'Bar diameter', value: formatInches(barDiameterIn(input.barSize), 32) },
    { label: 'Specified cover', value: specified === undefined ? 'not checked' : formatInches(specified) },
    { label: 'Cover range', value: `${formatInches(s.minCoverIn)} to ${formatInches(s.maxCoverIn)}` },
    { label: 'Mean cover', value: formatInches(s.meanCoverIn) },
    {
      label: 'Bars short of cover',
      value: String(s.underCount),
      emphasis: s.underCount === 0 ? 'good' : 'bad',
    },
    { label: 'Form plane flatness (RMS)', value: formatInches(analysis.planeFitRmsIn) },
  ];
}
