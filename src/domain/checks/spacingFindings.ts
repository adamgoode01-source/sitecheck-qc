/**
 * Turning a spacing analysis into findings, shared by framing and rebar.
 *
 * Both checks ask the same question of a run and previously answered it with
 * near-identical code, one finding per failed bay. A wall where the whole
 * layout is 1/2 inch over produced twenty paragraphs that differed only in
 * their numbers — which reads as noise, not thoroughness.
 *
 * Bays are numbered from the start of the run: bay 1 sits between member 1
 * and member 2. That numbering is used consistently in titles, while the
 * bounding members appear in the detail, because "bay 7" is what someone
 * counts along the wall and "between stud 7 and 8" is what they confirm when
 * they get there.
 */

import type { SpacingAnalysis, SpacingEntry } from '../spacing';
import { formatDeviation, formatFeetInches, formatInches, formatTolerance } from '../units';
import {
  CONSOLIDATE_THRESHOLD,
  describeAffected,
  formatIndexRanges,
  rangeOf,
  worstBy,
} from './grouping';
import type { Finding } from './types';

export interface SpacingCopy {
  spacingCode: string;
  missingCode: string;
  nominalOCIn: number;
  spacingToleranceIn: number;
  /** "bay" / "bays" for framing, "bar space" / "bar spaces" for reinforcing. */
  bay: { one: string; many: string };
  /** "stud" / "studs", "bar" / "bars". */
  member: { one: string; many: string };
  /** Closing sentence appended to every missing-member finding. */
  missingNote: string;
}

export function buildSpacingFindings(analysis: SpacingAnalysis, copy: SpacingCopy): Finding[] {
  return [
    ...missingFindings(
      analysis.spacings.filter((s) => s.missingMembers),
      copy,
    ),
    ...outOfToleranceFindings(
      analysis.spacings.filter((s) => s.status === 'fail'),
      analysis.spacings.length,
      copy,
    ),
  ];
}

function outOfToleranceFindings(
  failed: readonly SpacingEntry[],
  totalBays: number,
  copy: SpacingCopy,
): Finding[] {
  if (failed.length === 0) return [];

  const allowed = `Allowed is ${formatTolerance(copy.spacingToleranceIn)}.`;

  if (failed.length < CONSOLIDATE_THRESHOLD) {
    return failed.map((bay) => ({
      code: copy.spacingCode,
      severity: 'deficiency' as const,
      title: `${capitalise(copy.bay.one)} ${bay.fromIndex + 1} out of tolerance`,
      detail: `Between ${copy.member.one} ${bay.fromIndex + 1} and ${bay.toIndex + 1}, measured ${formatInches(bay.actualIn)} against ${formatInches(copy.nominalOCIn * bay.impliedBays)} specified, ${formatDeviation(bay.deviationIn)}. ${allowed}`,
      measuredIn: bay.actualIn,
      expectedIn: copy.nominalOCIn * bay.impliedBays,
      deviationIn: bay.deviationIn,
      bayFromIndex: bay.fromIndex,
      bayToIndex: bay.toIndex,
      occurrences: 1,
      affectedIndexes: [bay.fromIndex],
    }));
  }

  const indices = failed.map((b) => b.fromIndex);
  const span = rangeOf(failed.map((b) => b.actualIn));
  const worst = worstBy(failed, (b) => b.deviationIn);
  const worstBay = worst?.item as SpacingEntry;

  const where = describeAffected(indices, totalBays, copy.bay.one, copy.bay.many);
  const measured =
    span && span.min !== span.max
      ? `measured ${formatInches(span.min)} to ${formatInches(span.max)}`
      : `measured ${formatInches(span?.min ?? 0)}`;

  return [
    {
      code: copy.spacingCode,
      severity: 'deficiency',
      title: `${failed.length} ${copy.bay.many} out of tolerance`,
      detail: `${capitalise(where)} ${measured} against ${formatInches(copy.nominalOCIn)} specified. Worst is ${copy.bay.one} ${worstBay.fromIndex + 1} at ${formatInches(worstBay.actualIn)}, ${formatDeviation(worstBay.deviationIn)}. ${allowed}`,
      measuredIn: worstBay.actualIn,
      expectedIn: copy.nominalOCIn,
      deviationIn: worstBay.deviationIn,
      bayFromIndex: worstBay.fromIndex,
      bayToIndex: worstBay.toIndex,
      occurrences: failed.length,
      affectedIndexes: indices,
    },
  ];
}

function missingFindings(gaps: readonly SpacingEntry[], copy: SpacingCopy): Finding[] {
  if (gaps.length === 0) return [];

  if (gaps.length < CONSOLIDATE_THRESHOLD) {
    return gaps.map((gap) => {
      const missing = gap.impliedBays - 1;
      return {
        code: copy.missingCode,
        severity: 'observation' as const,
        title: `Gap spans ${gap.impliedBays} ${copy.bay.many} between ${copy.member.one} ${gap.fromIndex + 1} and ${gap.toIndex + 1}`,
        detail: `Measured ${formatFeetInches(gap.actualIn)} where one ${copy.bay.one} is ${formatInches(copy.nominalOCIn)}. That reads as ${missing} absent ${missing === 1 ? copy.member.one : copy.member.many}. ${copy.missingNote}`,
        measuredIn: gap.actualIn,
        expectedIn: copy.nominalOCIn * gap.impliedBays,
        deviationIn: gap.deviationIn,
        bayFromIndex: gap.fromIndex,
        bayToIndex: gap.toIndex,
        occurrences: 1,
        affectedIndexes: [gap.fromIndex],
      };
    });
  }

  const indices = gaps.map((g) => g.fromIndex);
  const totalMissing = gaps.reduce((sum, g) => sum + (g.impliedBays - 1), 0);

  return [
    {
      code: copy.missingCode,
      severity: 'observation',
      title: `${gaps.length} gaps span more than one ${copy.bay.one}`,
      detail: `At ${copy.bay.many} ${formatIndexRanges(indices)}, the run skips ahead — ${totalMissing} ${totalMissing === 1 ? copy.member.one : copy.member.many} appear absent in total. ${copy.missingNote}`,
      occurrences: gaps.length,
      affectedIndexes: indices,
    },
  ];
}

const capitalise = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
