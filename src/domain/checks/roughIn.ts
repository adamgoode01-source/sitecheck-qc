/**
 * Rough-in check: are the boxes, stub-outs and penetrations where the
 * drawings put them?
 *
 * Findings are consolidated the same way the spacing checks are — a floor of
 * receptacles all set off the wrong datum is one problem, not forty.
 */

import type { Vec3 } from '../geometry';
import { type RoughInAnalysis, type RoughInEntry, analyseRoughIn } from '../roughIn';
import type { RoughInTolerances } from '../tolerance';
import { formatDeviation, formatFeetInches, formatInches, formatTolerance } from '../units';
import { CONSOLIDATE_THRESHOLD, describeAffected, rangeOf, worstBy } from './grouping';
import { type CheckResult, type Finding, type MetricLine, statusFromFindings } from './types';

export type RoughInFixture = 'receptacle' | 'switch' | 'data' | 'plumbing' | 'hvac' | 'other';

const FIXTURE_LABEL: Record<RoughInFixture, { one: string; many: string }> = {
  receptacle: { one: 'receptacle', many: 'receptacles' },
  switch: { one: 'switch', many: 'switches' },
  data: { one: 'data outlet', many: 'data outlets' },
  plumbing: { one: 'stub-out', many: 'stub-outs' },
  hvac: { one: 'penetration', many: 'penetrations' },
  other: { one: 'rough-in', many: 'rough-ins' },
};

export interface RoughInCheckInput {
  /** Taps on each fixture, at the point the drawing dimension is taken to. */
  fixturePoints: readonly Vec3[];
  /** Three or more taps on the slab or floor. */
  floorPoints: readonly Vec3[];
  /** The corner, jamb or grid line the drawing dimensions from. */
  datumPoint?: Vec3;
  fixtureType: RoughInFixture;
  specifiedHeightIn: number;
  /** Floor build-up still to come over the captured surface, inches. */
  floorBuildUpIn?: number;
  specifiedOffsetIn?: number;
  /** What the tapped point represents, printed on the report. */
  measuredTo?: string;
  tolerances: RoughInTolerances;
}

export const ROUGH_IN_CHECK_ID = 'rough-in';

export function runRoughInCheck(input: RoughInCheckInput): CheckResult {
  const label = FIXTURE_LABEL[input.fixtureType];
  const checkName = `${capitalise(label.many)} at ${formatFeetInches(input.specifiedHeightIn)} AFF`;

  if (input.fixturePoints.length < 1 || input.floorPoints.length < 3) {
    return {
      checkId: ROUGH_IN_CHECK_ID,
      checkName,
      status: 'invalid',
      points: [...input.fixturePoints],
      metrics: [],
      findings: [
        {
          code: 'RGH-CAPTURE',
          severity: 'invalid',
          title: 'Capture incomplete',
          detail: `Mark at least one ${label.one} and three points on the floor. Height above floor cannot be measured without a floor to measure from.`,
        },
      ],
    };
  }

  const analysis = analyseRoughIn(
    input.fixturePoints,
    input.floorPoints,
    {
      specifiedHeightIn: input.specifiedHeightIn,
      heightToleranceIn: input.tolerances.heightToleranceIn,
      floorBuildUpIn: input.floorBuildUpIn,
      specifiedOffsetIn: input.specifiedOffsetIn,
      offsetToleranceIn: input.tolerances.offsetToleranceIn,
      alignmentToleranceIn: input.tolerances.alignmentToleranceIn,
    },
    input.datumPoint,
  );

  const findings = analysis.captureTrusted
    ? collect(analysis, input, label)
    : [
        {
          code: 'RGH-CAPTURE',
          severity: 'invalid' as const,
          title: 'Floor capture is not flat',
          detail: `The points taken on the floor deviate ${formatInches(analysis.floorFitRmsIn)} RMS from a plane. Every height here is measured from that surface, so a bad floor reference makes all of them wrong. Re-take it on a clean, flat area.`,
          measuredIn: analysis.floorFitRmsIn,
        },
      ];

  return {
    checkId: ROUGH_IN_CHECK_ID,
    checkName,
    status: statusFromFindings(findings),
    findings,
    metrics: buildMetrics(analysis, input, label),
    points: [...input.fixturePoints],
  };
}

function collect(
  analysis: RoughInAnalysis,
  input: RoughInCheckInput,
  label: { one: string; many: string },
): Finding[] {
  const findings: Finding[] = [];
  const total = analysis.entries.length;

  const heightAllowed = `Specified is ${formatFeetInches(input.specifiedHeightIn)} AFF, allowed ${formatTolerance(input.tolerances.heightToleranceIn)}.`;

  findings.push(
    ...heightFindings(
      analysis.entries.filter((e) => e.heightStatus === 'high'),
      total,
      label,
      'high',
      heightAllowed,
    ),
    ...heightFindings(
      analysis.entries.filter((e) => e.heightStatus === 'low'),
      total,
      label,
      'low',
      heightAllowed,
    ),
  );

  const offsetFailures = analysis.entries.filter(
    (e) => e.offsetStatus === 'long' || e.offsetStatus === 'short',
  );

  if (offsetFailures.length > 0 && input.specifiedOffsetIn !== undefined) {
    const indices = offsetFailures.map((e) => e.index);
    const worst = worstBy(offsetFailures, (e) => e.offsetDeviationIn ?? 0);
    const worstEntry = worst?.item as RoughInEntry;

    findings.push({
      code: 'RGH-OFFSET',
      severity: 'deficiency',
      title:
        offsetFailures.length === 1
          ? `${capitalise(label.one)} ${(offsetFailures[0] as RoughInEntry).index + 1} is the wrong distance from the datum`
          : `${offsetFailures.length} ${label.many} are the wrong distance from the datum`,
      detail: `${capitalise(describeAffected(indices, total, label.one, label.many))} measured from the datum against ${formatFeetInches(input.specifiedOffsetIn)} specified. Worst is ${label.one} ${worstEntry.index + 1} at ${formatFeetInches(worstEntry.offsetIn ?? 0)}, ${formatDeviation(worstEntry.offsetDeviationIn ?? 0)}. Allowed is ${formatTolerance(input.tolerances.offsetToleranceIn)}.`,
      measuredIn: worstEntry.offsetIn,
      expectedIn: input.specifiedOffsetIn,
      deviationIn: worstEntry.offsetDeviationIn,
      memberIndex: worstEntry.index,
      occurrences: offsetFailures.length,
      affectedIndexes: indices,
    });
  }

  // Reported even when every fixture individually meets spec: a row that is
  // uneven with itself is the thing the client actually sees.
  if (analysis.summary.alignmentChecked && !analysis.summary.alignmentPass) {
    findings.push({
      code: 'RGH-ALIGN',
      severity: 'deficiency',
      title: `${capitalise(label.many)} are not level with each other`,
      detail: `Heights range ${formatFeetInches(analysis.summary.minHeightAffIn)} to ${formatFeetInches(analysis.summary.maxHeightAffIn)} AFF, a spread of ${formatInches(analysis.summary.heightSpreadIn)}. Allowed spread across one set is ${formatInches(input.tolerances.alignmentToleranceIn)}. Adjacent devices at visibly different heights get picked up on walkthrough even when each one meets its tolerance.`,
      measuredIn: analysis.summary.heightSpreadIn,
      expectedIn: input.tolerances.alignmentToleranceIn,
      deviationIn: analysis.summary.heightSpreadIn - input.tolerances.alignmentToleranceIn,
    });
  }

  if (!analysis.flatnessVerified) {
    findings.push({
      code: 'RGH-FLOOR-UNVERIFIED',
      severity: 'observation',
      title: 'Floor reference could not be checked for flatness',
      detail:
        'Only three points were taken on the floor. Three points always fit a plane exactly, so there is no way to tell whether one of them landed on a toe-board, a cable or debris — and every height here is measured from that plane. Take four or more next time so the reference can be verified.',
    });
  }

  if (input.specifiedOffsetIn === undefined || !input.datumPoint) {
    findings.push({
      code: 'RGH-OFFSET-SKIPPED',
      severity: 'observation',
      title: 'Horizontal position was not checked',
      detail: `Only height above floor was assessed. No datum point and specified offset were provided, so how far these ${label.many} sit from the corner or opening remains unverified.`,
    });
  }

  if (findings.every((f) => f.severity === 'observation')) {
    findings.unshift({
      code: 'RGH-PASS',
      severity: 'pass',
      title: `${total} ${total === 1 ? label.one : label.many} within tolerance`,
      detail: `Heights measured ${formatFeetInches(analysis.summary.minHeightAffIn)} to ${formatFeetInches(analysis.summary.maxHeightAffIn)} AFF against ${formatFeetInches(input.specifiedHeightIn)} specified.`,
    });
  }

  return findings;
}

function heightFindings(
  entries: readonly RoughInEntry[],
  total: number,
  label: { one: string; many: string },
  direction: 'high' | 'low',
  allowed: string,
): Finding[] {
  if (entries.length === 0) return [];

  const word = direction === 'high' ? 'high' : 'low';

  if (entries.length < CONSOLIDATE_THRESHOLD) {
    return entries.map((entry) => ({
      code: 'RGH-HEIGHT',
      severity: 'deficiency' as const,
      title: `${capitalise(label.one)} ${entry.index + 1} is ${word}`,
      detail: `Measured ${formatFeetInches(entry.heightAffIn)} AFF, ${formatDeviation(entry.heightDeviationIn)}. ${allowed}`,
      measuredIn: entry.heightAffIn,
      deviationIn: entry.heightDeviationIn,
      memberIndex: entry.index,
      occurrences: 1,
      affectedIndexes: [entry.index],
    }));
  }

  const indices = entries.map((e) => e.index);
  const span = rangeOf(entries.map((e) => e.heightAffIn));
  const worst = worstBy(entries, (e) => e.heightDeviationIn);
  const worstEntry = worst?.item as RoughInEntry;

  return [
    {
      code: 'RGH-HEIGHT',
      severity: 'deficiency',
      title: `${entries.length} ${label.many} set too ${word}`,
      detail: `${capitalise(describeAffected(indices, total, label.one, label.many))} measured ${formatFeetInches(span?.min ?? 0)} to ${formatFeetInches(span?.max ?? 0)} AFF. Worst is ${label.one} ${worstEntry.index + 1} at ${formatFeetInches(worstEntry.heightAffIn)}, ${formatDeviation(worstEntry.heightDeviationIn)}. ${allowed}`,
      measuredIn: worstEntry.heightAffIn,
      deviationIn: worstEntry.heightDeviationIn,
      memberIndex: worstEntry.index,
      occurrences: entries.length,
      affectedIndexes: indices,
    },
  ];
}

function buildMetrics(
  analysis: RoughInAnalysis,
  input: RoughInCheckInput,
  label: { one: string; many: string },
): MetricLine[] {
  const s = analysis.summary;
  const buildUp = input.floorBuildUpIn ?? 0;

  const metrics: MetricLine[] = [
    { label: `${capitalise(label.many)} marked`, value: String(s.fixturesMeasured) },
    { label: 'Specified height', value: `${formatFeetInches(input.specifiedHeightIn)} AFF` },
    {
      label: 'Measured range',
      value: `${formatFeetInches(s.minHeightAffIn)} to ${formatFeetInches(s.maxHeightAffIn)}`,
    },
    {
      label: 'Spread across the set',
      value: formatInches(s.heightSpreadIn),
      emphasis: s.alignmentPass ? 'good' : 'bad',
    },
    {
      label: 'Out of height tolerance',
      value: String(s.outOfHeightTolerance),
      emphasis: s.outOfHeightTolerance === 0 ? 'good' : 'bad',
    },
  ];

  // Always stated, because a zero here is a claim: it says the captured
  // surface IS the finished floor.
  metrics.push({
    label: 'Floor build-up allowed for',
    value: buildUp > 0 ? formatInches(buildUp) : 'none — measured to finished floor',
  });

  if (input.measuredTo) metrics.push({ label: 'Dimension taken to', value: input.measuredTo });

  if (input.specifiedOffsetIn !== undefined && input.datumPoint) {
    metrics.push(
      { label: 'Specified offset', value: formatFeetInches(input.specifiedOffsetIn) },
      {
        label: 'Out of offset tolerance',
        value: String(s.outOfOffsetTolerance),
        emphasis: s.outOfOffsetTolerance === 0 ? 'good' : 'bad',
      },
    );
  }

  metrics.push({ label: 'Floor flatness (RMS)', value: formatInches(analysis.floorFitRmsIn) });
  return metrics;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
