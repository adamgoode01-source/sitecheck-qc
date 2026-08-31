/**
 * The shape every QC check produces.
 *
 * Checks never format text for the screen and never touch storage. They take
 * measured geometry plus the expected values read off the plans, and return
 * findings. That separation is what lets the same check run on the phone at
 * the point of capture and again on the desktop when the report is built,
 * with identical results.
 */

import type { Vec3 } from '../geometry';

/**
 * `invalid` is deliberately distinct from `deficiency`. It means the app
 * could not measure reliably — bad capture, points that do not form a line,
 * too few members. Reporting "the work is wrong" when the truth is "we
 * couldn't tell" would be the most damaging bug this app could have.
 */
export type Severity = 'pass' | 'observation' | 'deficiency' | 'invalid';

export type CheckStatus = 'pass' | 'fail' | 'invalid';

export interface Finding {
  /** Stable machine code, e.g. `FRM-SPACING`. Safe to filter and count on. */
  code: string;
  severity: Severity;
  title: string;
  /** One or two sentences a superintendent can act on. Plain language. */
  detail: string;
  /** Inches. Present when the finding refers to a specific measurement. */
  measuredIn?: number;
  expectedIn?: number;
  deviationIn?: number;
  /** Index of the member this finding refers to, in run order from the start. */
  memberIndex?: number;
  /** For spacing findings: the bay between these two members, in run order. */
  bayFromIndex?: number;
  bayToIndex?: number;
  /**
   * How many individual failures this finding represents. 1 unless it is a
   * consolidated group.
   *
   * Every tally must sum this rather than count findings. Collapsing five
   * short-cover bars into one readable line must not turn "5 deficiencies"
   * into "1 deficiency" on the front page of the report — that would be a
   * presentation change quietly rewriting the result.
   */
  occurrences?: number;
  /**
   * Zero-based indices of every item this finding covers, in run order.
   * Present on consolidated findings so the UI can highlight them all.
   */
  affectedIndexes?: number[];
}

/** Findings represent one failure each unless they say otherwise. */
export const occurrencesOf = (finding: Finding): number => finding.occurrences ?? 1;

export interface CheckResult {
  checkId: string;
  checkName: string;
  status: CheckStatus;
  findings: Finding[];
  /** Short human-readable lines summarising what was measured. */
  metrics: MetricLine[];
  /** Points as analysed, inches, in the capture frame. Kept for the UI overlay. */
  points: Vec3[];
}

export interface MetricLine {
  label: string;
  value: string;
  /** Set when the metric itself is the thing that failed. */
  emphasis?: 'good' | 'bad';
}

/** Counts underlying failures, not findings — see `occurrences`. */
export const countBySeverity = (findings: readonly Finding[], severity: Severity): number =>
  findings.filter((f) => f.severity === severity).reduce((sum, f) => sum + occurrencesOf(f), 0);

export function statusFromFindings(findings: readonly Finding[]): CheckStatus {
  if (findings.some((f) => f.severity === 'invalid')) return 'invalid';
  if (findings.some((f) => f.severity === 'deficiency')) return 'fail';
  return 'pass';
}
