/**
 * Framing check: stud and joist on-centre spacing.
 *
 * The inspector marks the centre of each member across a run. We fit the run
 * axis, measure bay to bay, and check two independent things: each bay
 * against the specified spacing, and each member against where it should sit
 * if the layout had been pulled from a single tape rather than measured stud
 * to stud. The second is the one that bites — see `spacing.ts`.
 */

import { type Vec3 } from '../geometry';
import { type SpacingAnalysis, analyseSpacing } from '../spacing';
import type { FramingTolerances } from '../tolerance';
import { formatDeviation, formatFeetInches, formatInches, formatTolerance } from '../units';
import { buildSpacingFindings } from './spacingFindings';
import { type CheckResult, type Finding, statusFromFindings } from './types';

export type FramingMemberType = 'stud' | 'joist' | 'truss' | 'furring';

const MEMBER_LABEL: Record<FramingMemberType, { one: string; many: string }> = {
  stud: { one: 'stud', many: 'studs' },
  joist: { one: 'joist', many: 'joists' },
  truss: { one: 'truss', many: 'trusses' },
  furring: { one: 'furring channel', many: 'furring channels' },
};

export interface FramingCheckInput {
  /** Member centres in the capture frame, inches. Order does not matter. */
  points: readonly Vec3[];
  memberType: FramingMemberType;
  /** Specified on-centre dimension read off the plans, inches. */
  nominalOCIn: number;
  tolerances: FramingTolerances;
}

export const FRAMING_CHECK_ID = 'framing-spacing';

export function runFramingSpacingCheck(input: FramingCheckInput): CheckResult {
  const label = MEMBER_LABEL[input.memberType];
  const checkName = `${cap(label.one)} spacing at ${formatInches(input.nominalOCIn)} o.c.`;

  if (input.points.length < 2) {
    return {
      checkId: FRAMING_CHECK_ID,
      checkName,
      status: 'invalid',
      points: [...input.points],
      metrics: [],
      findings: [
        {
          code: 'FRM-CAPTURE',
          severity: 'invalid',
          title: 'Not enough members marked',
          detail: `Mark at least two ${label.many} to measure a bay. Three or more is needed before layout drift means anything.`,
        },
      ],
    };
  }

  const analysis = analyseSpacing(input.points, {
    nominalOC: input.nominalOCIn,
    spacingTolerance: input.tolerances.spacingToleranceIn,
    cumulativeTolerance: input.tolerances.cumulativeToleranceIn,
    detectMissingMembers: true,
  });

  const findings = analysis.captureTrusted
    ? collectFindings(analysis, input, label)
    : [untrustedCapture(analysis, label)];

  return {
    checkId: FRAMING_CHECK_ID,
    checkName,
    status: statusFromFindings(findings),
    findings,
    points: [...input.points],
    metrics: buildMetrics(analysis, input),
  };
}

function collectFindings(
  analysis: SpacingAnalysis,
  input: FramingCheckInput,
  label: { one: string; many: string },
): Finding[] {
  const findings: Finding[] = buildSpacingFindings(analysis, {
    spacingCode: 'FRM-SPACING',
    missingCode: 'FRM-MISSING',
    nominalOCIn: input.nominalOCIn,
    spacingToleranceIn: input.tolerances.spacingToleranceIn,
    bay: { one: 'bay', many: 'bays' },
    member: label,
    missingNote:
      'Confirm against the plans — this is expected at an opening, and a defect if it is not one.',
  });

  const worstDrift = analysis.drift
    .filter((d) => d.status === 'fail')
    .sort((a, b) => Math.abs(b.driftIn) - Math.abs(a.driftIn))[0];

  if (worstDrift) {
    const failing = analysis.drift.filter((d) => d.status === 'fail').length;
    findings.push({
      code: 'FRM-DRIFT',
      severity: 'deficiency',
      title: `Layout has drifted ${formatDeviation(worstDrift.driftIn)} by ${label.one} ${worstDrift.index + 1}`,
      detail: `${failing} ${failing === 1 ? 'member sits' : 'members sit'} outside the allowed cumulative drift of ${formatTolerance(input.tolerances.cumulativeToleranceIn)}. ${cap(label.one)} ${worstDrift.index + 1} is at ${formatFeetInches(worstDrift.positionIn)} from the start of the run where the layout puts it at ${formatFeetInches(worstDrift.idealIn)}. Individual bays may each be acceptable while the run as a whole is not, which is what breaks sheet-goods layout at 4'-0" and 8'-0".`,
      measuredIn: worstDrift.positionIn,
      expectedIn: worstDrift.idealIn,
      deviationIn: worstDrift.driftIn,
      memberIndex: worstDrift.index,
    });
  }

  if (findings.length === 0) {
    findings.push({
      code: 'FRM-PASS',
      severity: 'pass',
      title: `${analysis.summary.baysMeasured} bays within tolerance`,
      detail: `All bays measured ${formatInches(analysis.summary.minSpacingIn)} to ${formatInches(analysis.summary.maxSpacingIn)} against ${formatInches(input.nominalOCIn)} specified. Worst cumulative drift over the run was ${formatDeviation(analysis.summary.maxAbsDriftIn)}.`,
    });
  }

  return findings;
}

function untrustedCapture(analysis: SpacingAnalysis, label: { one: string; many: string }): Finding {
  return {
    code: 'FRM-CAPTURE',
    severity: 'invalid',
    title: 'Capture is not a straight run',
    detail: `The marked points scatter ${formatInches(analysis.fitRmsIn)} RMS off a straight line, with one point ${formatInches(analysis.fitMaxDeviationIn)} out. That usually means a tap landed on the floor, on a brace, or on nothing. Re-mark the ${label.many} before reporting spacing.`,
    measuredIn: analysis.fitRmsIn,
  };
}

function buildMetrics(analysis: SpacingAnalysis, input: FramingCheckInput) {
  const s = analysis.summary;
  return [
    { label: 'Members marked', value: String(s.memberCount) },
    { label: 'Bays measured', value: String(s.baysMeasured) },
    { label: 'Specified', value: `${formatInches(input.nominalOCIn)} o.c.` },
    {
      label: 'Range',
      value: `${formatInches(s.minSpacingIn)} to ${formatInches(s.maxSpacingIn)}`,
    },
    { label: 'Mean', value: formatInches(s.meanSpacingIn) },
    {
      label: 'Worst bay deviation',
      value: formatDeviation(s.maxAbsDeviationIn),
      emphasis: s.maxAbsDeviationIn <= input.tolerances.spacingToleranceIn ? ('good' as const) : ('bad' as const),
    },
    {
      label: 'Worst layout drift',
      value: formatDeviation(s.maxAbsDriftIn),
      emphasis: s.maxAbsDriftIn <= input.tolerances.cumulativeToleranceIn ? ('good' as const) : ('bad' as const),
    },
    { label: 'Overall run', value: formatFeetInches(s.overallRunIn) },
    { label: 'Straightness (RMS)', value: formatInches(analysis.fitRmsIn) },
  ];
}

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
