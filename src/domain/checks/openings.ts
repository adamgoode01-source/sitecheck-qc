/**
 * Openings check: door and window rough openings.
 *
 * Unlike the other checks this one reports on a single item, so there is
 * nothing to consolidate — but there are six independent ways one opening can
 * be wrong, and they carry very different consequences. A quarter inch narrow
 * is a trim problem; a quarter inch out of square is a door that will not
 * hang. The findings are separated so the reader can tell which they have.
 */

import type { Vec3 } from '../geometry';
import { type OpeningAnalysis, type OpeningKind, analyseOpening } from '../opening';
import type { OpeningTolerances } from '../tolerance';
import { formatDeviation, formatFeetInches, formatInches, formatTolerance } from '../units';
import { type CheckResult, type Finding, type MetricLine, statusFromFindings } from './types';

export interface OpeningCheckInput {
  /** Exactly four taps, one per corner of the rough opening, any order. */
  cornerPoints: readonly Vec3[];
  /** Optional reference the drawing dimensions the opening from. */
  datumPoint?: Vec3;
  kind: OpeningKind;
  /** Free text, e.g. "Door 204" or "Window W3". Printed on the report. */
  reference?: string;
  specifiedWidthIn: number;
  specifiedHeightIn: number;
  specifiedOffsetIn?: number;
  tolerances: OpeningTolerances;
  /** Which way is up in the capture frame. */
  up?: Vec3;
}

export const OPENING_CHECK_ID = 'opening';

export function runOpeningCheck(input: OpeningCheckInput): CheckResult {
  const noun = input.kind === 'door' ? 'Door' : input.kind === 'window' ? 'Window' : 'Opening';
  const checkName = `${noun}${input.reference ? ` ${input.reference}` : ''} rough opening ${formatFeetInches(input.specifiedWidthIn)} x ${formatFeetInches(input.specifiedHeightIn)}`;

  if (input.cornerPoints.length !== 4) {
    return {
      checkId: OPENING_CHECK_ID,
      checkName,
      status: 'invalid',
      points: [...input.cornerPoints],
      metrics: [],
      findings: [
        {
          code: 'OPN-CAPTURE',
          severity: 'invalid',
          title: 'Needs exactly four corners',
          detail: `${input.cornerPoints.length} points were marked. Tap all four corners of the rough opening — squareness and plumb cannot be derived from fewer.`,
        },
      ],
    };
  }

  const analysis = analyseOpening(
    input.cornerPoints,
    {
      specifiedWidthIn: input.specifiedWidthIn,
      specifiedHeightIn: input.specifiedHeightIn,
      widthToleranceIn: input.tolerances.widthToleranceIn,
      heightToleranceIn: input.tolerances.heightToleranceIn,
      squarenessToleranceIn: input.tolerances.squarenessToleranceIn,
      plumbToleranceIn: input.tolerances.plumbToleranceIn,
      levelToleranceIn: input.tolerances.levelToleranceIn,
      specifiedOffsetIn: input.specifiedOffsetIn,
      offsetToleranceIn: input.tolerances.offsetToleranceIn,
      up: input.up,
    },
    input.datumPoint,
  );

  const findings = collect(analysis, input, noun);

  return {
    checkId: OPENING_CHECK_ID,
    checkName,
    status: statusFromFindings(findings),
    findings,
    metrics: buildMetrics(analysis, input),
    points: [...input.cornerPoints],
  };
}

function collect(analysis: OpeningAnalysis, input: OpeningCheckInput, noun: string): Finding[] {
  const findings: Finding[] = [];
  const m = analysis.measurements;
  const t = input.tolerances;

  if (analysis.issues.includes('width')) {
    findings.push({
      code: 'OPN-WIDTH',
      severity: 'deficiency',
      title: `Rough opening is ${analysis.widthDeviationIn > 0 ? 'too wide' : 'too narrow'}`,
      detail: `Measured ${formatFeetInches(m.widthIn)} against ${formatFeetInches(input.specifiedWidthIn)} specified, ${formatDeviation(analysis.widthDeviationIn)}. Allowed is ${formatTolerance(t.widthToleranceIn)}. Top and bottom measured ${formatInches(m.topWidthIn)} and ${formatInches(m.bottomWidthIn)}.`,
      measuredIn: m.widthIn,
      expectedIn: input.specifiedWidthIn,
      deviationIn: analysis.widthDeviationIn,
    });
  }

  if (analysis.issues.includes('height')) {
    findings.push({
      code: 'OPN-HEIGHT',
      severity: 'deficiency',
      title: `Rough opening is ${analysis.heightDeviationIn > 0 ? 'too tall' : 'too short'}`,
      detail: `Measured ${formatFeetInches(m.heightIn)} against ${formatFeetInches(input.specifiedHeightIn)} specified, ${formatDeviation(analysis.heightDeviationIn)}. Allowed is ${formatTolerance(t.heightToleranceIn)}. Left and right jambs measured ${formatInches(m.leftHeightIn)} and ${formatInches(m.rightHeightIn)}.`,
      measuredIn: m.heightIn,
      expectedIn: input.specifiedHeightIn,
      deviationIn: analysis.heightDeviationIn,
    });
  }

  if (analysis.issues.includes('square')) {
    findings.push({
      code: 'OPN-SQUARE',
      severity: 'deficiency',
      title: `Opening is out of square by ${formatInches(m.diagonalDifferenceIn)}`,
      detail: `Diagonals measured ${formatInches(m.diagonal1In)} and ${formatInches(m.diagonal2In)}, a difference of ${formatInches(m.diagonalDifferenceIn)}. Allowed is ${formatInches(t.squarenessToleranceIn)}. A racked opening will not take a prehung unit however correct the width is, and it cannot be shimmed out.`,
      measuredIn: m.diagonalDifferenceIn,
      expectedIn: 0,
      deviationIn: m.diagonalDifferenceIn,
    });
  }

  if (analysis.issues.includes('plumb')) {
    const worst = Math.max(m.leftJambOutOfPlumbIn, m.rightJambOutOfPlumbIn);
    const side = m.leftJambOutOfPlumbIn >= m.rightJambOutOfPlumbIn ? 'left' : 'right';
    findings.push({
      code: 'OPN-PLUMB',
      severity: 'deficiency',
      title: `${capitalise(side)} jamb is out of plumb by ${formatInches(worst)}`,
      detail: `Over the full ${formatFeetInches(m.heightIn)} height the ${side} jamb wanders ${formatInches(worst)} horizontally. Allowed is ${formatInches(t.plumbToleranceIn)}. An out-of-plumb jamb makes a door swing open or closed on its own.`,
      measuredIn: worst,
      expectedIn: 0,
      deviationIn: worst,
    });
  }

  if (analysis.issues.includes('level')) {
    const worst = Math.max(m.sillOutOfLevelIn, m.headOutOfLevelIn);
    const which = m.sillOutOfLevelIn >= m.headOutOfLevelIn ? 'sill' : 'head';
    findings.push({
      code: 'OPN-LEVEL',
      severity: 'deficiency',
      title: `${capitalise(which)} is out of level by ${formatInches(worst)}`,
      detail: `Measured across the ${which}, one side sits ${formatInches(worst)} higher than the other. Allowed is ${formatInches(t.levelToleranceIn)}.`,
      measuredIn: worst,
      expectedIn: 0,
      deviationIn: worst,
    });
  }

  if (analysis.issues.includes('offset') && input.specifiedOffsetIn !== undefined) {
    findings.push({
      code: 'OPN-OFFSET',
      severity: 'deficiency',
      title: `${noun} is in the wrong place`,
      detail: `Measured ${formatFeetInches(m.offsetIn ?? 0)} from the datum against ${formatFeetInches(input.specifiedOffsetIn)} specified, ${formatDeviation(analysis.offsetDeviationIn ?? 0)}. Allowed is ${formatTolerance(t.offsetToleranceIn)}.`,
      measuredIn: m.offsetIn,
      expectedIn: input.specifiedOffsetIn,
      deviationIn: analysis.offsetDeviationIn,
    });
  }

  if (analysis.issues.includes('twist')) {
    // Deliberately an observation rather than a deficiency: at this residual
    // we cannot separate a genuinely twisted opening from four sloppy taps,
    // and saying which it is would be inventing certainty.
    findings.push({
      code: 'OPN-TWIST',
      severity: 'observation',
      title: 'Corners are not in one plane',
      detail: `The four corners deviate ${formatInches(analysis.planarityRmsIn)} RMS from a flat plane. That is either a twisted opening — which no tape or square will find, and which shows up when the unit is fitted — or four imprecise taps. Re-take it; if it repeats, it is the opening.`,
      measuredIn: analysis.planarityRmsIn,
    });
  }

  if (input.specifiedOffsetIn === undefined || !input.datumPoint) {
    findings.push({
      code: 'OPN-OFFSET-SKIPPED',
      severity: 'observation',
      title: 'Opening position was not checked',
      detail: `Size, squareness, plumb and level were assessed. Without a datum point and a specified dimension, where this ${noun.toLowerCase()} sits along the wall remains unverified.`,
    });
  }

  if (!findings.some((f) => f.severity === 'deficiency')) {
    findings.unshift({
      code: 'OPN-PASS',
      severity: 'pass',
      title: 'Rough opening within tolerance',
      detail: `Measured ${formatFeetInches(m.widthIn)} x ${formatFeetInches(m.heightIn)} against ${formatFeetInches(input.specifiedWidthIn)} x ${formatFeetInches(input.specifiedHeightIn)} specified, square to ${formatInches(m.diagonalDifferenceIn)} on the diagonals.`,
    });
  }

  return findings;
}

function buildMetrics(analysis: OpeningAnalysis, input: OpeningCheckInput): MetricLine[] {
  const m = analysis.measurements;
  const t = input.tolerances;

  const metrics: MetricLine[] = [
    { label: 'Specified', value: `${formatFeetInches(input.specifiedWidthIn)} x ${formatFeetInches(input.specifiedHeightIn)}` },
    { label: 'Measured', value: `${formatFeetInches(m.widthIn)} x ${formatFeetInches(m.heightIn)}` },
    {
      label: 'Width deviation',
      value: formatDeviation(analysis.widthDeviationIn),
      emphasis: Math.abs(analysis.widthDeviationIn) <= t.widthToleranceIn ? 'good' : 'bad',
    },
    {
      label: 'Height deviation',
      value: formatDeviation(analysis.heightDeviationIn),
      emphasis: Math.abs(analysis.heightDeviationIn) <= t.heightToleranceIn ? 'good' : 'bad',
    },
    { label: 'Width top / bottom', value: `${formatInches(m.topWidthIn)} / ${formatInches(m.bottomWidthIn)}` },
    { label: 'Height left / right', value: `${formatInches(m.leftHeightIn)} / ${formatInches(m.rightHeightIn)}` },
    { label: 'Diagonals', value: `${formatInches(m.diagonal1In)} / ${formatInches(m.diagonal2In)}` },
    {
      label: 'Out of square',
      value: formatInches(m.diagonalDifferenceIn),
      emphasis: m.diagonalDifferenceIn <= t.squarenessToleranceIn ? 'good' : 'bad',
    },
    {
      label: 'Jamb plumb, worst',
      value: formatInches(Math.max(m.leftJambOutOfPlumbIn, m.rightJambOutOfPlumbIn)),
      emphasis:
        Math.max(m.leftJambOutOfPlumbIn, m.rightJambOutOfPlumbIn) <= t.plumbToleranceIn
          ? 'good'
          : 'bad',
    },
    {
      label: 'Sill out of level',
      value: formatInches(m.sillOutOfLevelIn),
      emphasis: m.sillOutOfLevelIn <= t.levelToleranceIn ? 'good' : 'bad',
    },
  ];

  if (m.offsetIn !== undefined) {
    metrics.push({ label: 'Offset from datum', value: formatFeetInches(m.offsetIn) });
  }

  metrics.push({ label: 'Corner planarity (RMS)', value: formatInches(analysis.planarityRmsIn) });
  return metrics;
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
