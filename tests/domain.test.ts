import { describe, expect, it } from 'vitest';
import {
  formatDeviation,
  formatFeetInches,
  formatInches,
  parseLength,
} from '../src/domain/units';
import { fitLine3, fitPlane3, vec } from '../src/domain/geometry';
import { analyseSpacing } from '../src/domain/spacing';
import { analyseCover, surfaceDistanceToClearCover } from '../src/domain/rebar';
import { runFramingSpacingCheck } from '../src/domain/checks/framingSpacing';
import { runRebarCheck } from '../src/domain/checks/rebarMat';
import { describeAffected, formatIndexRanges } from '../src/domain/checks/grouping';
import { getProfile } from '../src/domain/tolerance';
import { renderReportHtml, summariseReport } from '../src/domain/report';
import { countUnexported } from '../src/storage/models';
import { describePersistence, formatBytes } from '../src/platform/persistence';

const CLOSE = 1e-6;

describe('parseLength', () => {
  it('reads the forms people actually type', () => {
    expect(parseLength('16')).toBe(16);
    expect(parseLength('16"')).toBe(16);
    expect(parseLength('16 1/2"')).toBe(16.5);
    expect(parseLength('16-1/2')).toBe(16.5);
    expect(parseLength('3/4')).toBe(0.75);
    expect(parseLength('.5"')).toBe(0.5);
    expect(parseLength("4'")).toBe(48);
    expect(parseLength(`4'-6"`)).toBe(54);
    expect(parseLength(`4' 6 1/2"`)).toBe(54.5);
    expect(parseLength('4 ft 6 in')).toBe(54);
  });

  it('reads metric', () => {
    expect(parseLength('400mm')).toBeCloseTo(15.748, 3);
    expect(parseLength('40cm')).toBeCloseTo(15.748, 3);
    expect(parseLength('1.2m')).toBeCloseTo(47.244, 3);
  });

  it('handles the prime marks phone keyboards insert', () => {
    expect(parseLength('4′-6″')).toBe(54);
  });

  it('returns null rather than guessing', () => {
    // A silently wrong expected dimension is the worst failure this app has.
    expect(parseLength('about 16')).toBeNull();
    expect(parseLength('')).toBeNull();
    expect(parseLength('16/0')).toBeNull();
  });

  it('treats a leading minus as negative but an interior dash as a separator', () => {
    expect(parseLength('-16')).toBe(-16);
    expect(parseLength(`4'-6"`)).toBe(54);
  });
});

describe('formatting', () => {
  it('renders feet and inches the way drawings do', () => {
    expect(formatFeetInches(54.5)).toBe(`4'-6 1/2"`);
    expect(formatFeetInches(48)).toBe(`4'-0"`);
    expect(formatInches(0.5)).toBe('1/2"');
    expect(formatInches(16)).toBe('16"');
  });

  it('carries when rounding fills the fraction', () => {
    // 11.99" must not render as 11 16/16".
    expect(formatFeetInches(11.99)).toBe(`1'-0"`);
  });

  it('always signs deviations', () => {
    expect(formatDeviation(0.125)).toBe('+1/8"');
    expect(formatDeviation(-0.25)).toBe('-1/4"');
    expect(formatDeviation(0)).toBe('0"');
  });
});

describe('geometry', () => {
  it('fits a line through a noisy run', () => {
    const points = [vec(0, 0, 0), vec(16, 0.01, 0), vec(32, -0.01, 0), vec(48, 0, 0)];
    const fit = fitLine3(points);

    expect(Math.abs(fit.line.direction.x)).toBeCloseTo(1, 3);
    expect(fit.rms).toBeLessThan(0.02);
  });

  it('fits a plane and finds its normal', () => {
    const fit = fitPlane3([vec(0, 0, 0), vec(10, 0, 0), vec(0, 10, 0), vec(10, 10, 0)]);

    expect(Math.abs(fit.plane.normal.z)).toBeCloseTo(1, 6);
    expect(fit.rms).toBeLessThan(CLOSE);
  });
});

describe('spacing analysis', () => {
  const tolerances = { nominalOC: 16, spacingTolerance: 0.25, cumulativeTolerance: 0.25 };

  it('passes a correct run', () => {
    const points = [0, 16, 32, 48, 64].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    expect(result.captureTrusted).toBe(true);
    expect(result.summary.status).toBe('pass');
    expect(result.summary.baysMeasured).toBe(4);
    expect(result.summary.maxAbsDeviationIn).toBeLessThan(CLOSE);
  });

  it('sorts points that were tapped out of order', () => {
    const points = [32, 0, 64, 16, 48].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    expect(result.positionsIn.map(Math.round)).toEqual([0, 16, 32, 48, 64]);
    expect(result.summary.status).toBe('pass');
  });

  it('catches a single bad bay', () => {
    const points = [0, 16, 30.5, 46.5].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    const failed = result.spacings.filter((s) => s.status === 'fail');
    expect(failed.length).toBeGreaterThanOrEqual(1);
    expect(failed[0]?.deviationIn).toBeCloseTo(-1.5, 6);
  });

  it('catches cumulative drift when every individual bay passes', () => {
    // The case a tape-and-eyeball check misses: each bay is 1/8" over, which
    // is inside tolerance, but by the fourth member the run is 3/8" out.
    const points = [0, 16.125, 32.25, 48.375].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    expect(result.spacings.every((s) => s.status === 'pass')).toBe(true);
    expect(result.drift.some((d) => d.status === 'fail')).toBe(true);
    expect(result.summary.maxAbsDriftIn).toBeCloseTo(0.375, 6);
    expect(result.summary.status).toBe('fail');
  });

  it('reads a double-width gap as a missing member, not a wild bay', () => {
    const points = [0, 16, 48, 64].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    const gap = result.spacings.find((s) => s.missingMembers);
    expect(gap?.impliedBays).toBe(2);
    expect(gap?.status).toBe('pass');
    expect(result.summary.missingMemberGaps).toBe(1);
  });

  it('keeps drift honest across a missing member', () => {
    const points = [0, 16, 48, 64].map((x) => vec(x, 0, 0));
    const result = analyseSpacing(points, tolerances);

    // The last member spans 4 bays from the start, not 3.
    expect(result.drift[3]?.idealIn).toBe(64);
    expect(result.drift[3]?.driftIn).toBeCloseTo(0, 6);
  });

  it('refuses to trust points that are not a straight run', () => {
    const points = [vec(0, 0, 0), vec(16, 6, 0), vec(32, -5, 0), vec(48, 4, 0)];
    const result = analyseSpacing(points, tolerances);

    expect(result.captureTrusted).toBe(false);
  });
});

describe('rebar cover', () => {
  it('converts a surface hit to clear cover by convention', () => {
    // #5 bar, 0.625" diameter, sensor read 2.125" from the form face.
    expect(surfaceDistanceToClearCover(2.125, 0.625, 'far-crown')).toBeCloseTo(1.5, 6);
    expect(surfaceDistanceToClearCover(2.125, 0.625, 'centreline')).toBeCloseTo(1.8125, 6);
    expect(surfaceDistanceToClearCover(2.125, 0.625, 'near-face')).toBeCloseTo(2.125, 6);
  });

  it('measures cover against a captured form plane', () => {
    const formFace = [vec(0, 0, 0), vec(24, 0, 0), vec(0, 24, 0), vec(24, 24, 0)];
    const bars = [vec(0, 0, 2.125), vec(12, 0, 2.125), vec(24, 0, 2.125)];

    const result = analyseCover(bars, formFace, {
      barSize: '#5',
      specifiedCoverIn: 1.5,
      underToleranceIn: 0.375,
      hitConvention: 'far-crown',
    });

    expect(result.captureTrusted).toBe(true);
    expect(result.summary.minCoverIn).toBeCloseTo(1.5, 5);
    expect(result.summary.status).toBe('pass');
  });

  it('flags a bar short of cover', () => {
    const formFace = [vec(0, 0, 0), vec(24, 0, 0), vec(0, 24, 0), vec(24, 24, 0)];
    const bars = [vec(0, 0, 2.125), vec(12, 0, 1.5), vec(24, 0, 2.125)];

    const result = analyseCover(bars, formFace, {
      barSize: '#5',
      specifiedCoverIn: 1.5,
      underToleranceIn: 0.375,
      hitConvention: 'far-crown',
    });

    expect(result.summary.underCount).toBe(1);
    expect(result.summary.status).toBe('fail');
  });
});

describe('framing check', () => {
  const profile = getProfile('standard');

  it('reports a pass with no deficiencies', () => {
    const points = [0, 16, 32, 48].map((x) => vec(x, 0, 0));
    const result = runFramingSpacingCheck({
      points,
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    expect(result.status).toBe('pass');
    expect(result.findings.every((f) => f.severity === 'pass')).toBe(true);
  });

  it('distinguishes "could not measure" from "the work is wrong"', () => {
    const scattered = [vec(0, 0, 0), vec(16, 8, 0), vec(32, -7, 0)];
    const result = runFramingSpacingCheck({
      points: scattered,
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    expect(result.status).toBe('invalid');
    expect(result.findings[0]?.severity).toBe('invalid');
  });

  it('raises a deficiency for an out-of-tolerance bay', () => {
    const points = [0, 16, 31, 47].map((x) => vec(x, 0, 0));
    const result = runFramingSpacingCheck({
      points,
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'FRM-SPACING')).toBe(true);
  });
});

describe('index range formatting', () => {
  it('collapses consecutive runs and reports 1-based numbers', () => {
    expect(formatIndexRanges([0, 1, 2, 3])).toBe('1-4');
    expect(formatIndexRanges([0, 1, 2, 3, 6, 11, 12, 13])).toBe('1-4, 7 and 12-14');
    expect(formatIndexRanges([4])).toBe('5');
  });

  it('sorts and de-duplicates whatever it is given', () => {
    expect(formatIndexRanges([3, 1, 2, 1, 0])).toBe('1-4');
  });

  it('truncates a very scattered list rather than printing forever', () => {
    const scattered = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18];
    expect(formatIndexRanges(scattered, 3)).toBe('1, 3, 5 and 7 more');
  });

  it('says "every" when nothing was spared', () => {
    expect(describeAffected([0, 1, 2], 3, 'bar', 'bars')).toBe('every bar');
    expect(describeAffected([0, 2], 4, 'bar', 'bars')).toBe('bars 1 and 3');
    expect(describeAffected([1], 4, 'bar', 'bars')).toBe('bar 2');
  });
});

describe('finding consolidation', () => {
  const profile = getProfile('standard');

  const matWithBadCover = (barCount: number) =>
    runRebarCheck({
      barPoints: Array.from({ length: barCount }, (_, i) => vec(i * 12, 0, 1.5)),
      formFacePoints: [vec(0, 0, 0), vec(48, 0, 0), vec(0, 24, 0), vec(48, 24, 0)],
      barSize: '#5',
      nominalOCIn: 12,
      specifiedCoverIn: 2,
      tolerances: profile.rebar,
    });

  it('keeps findings separate while that is still readable', () => {
    const result = matWithBadCover(2);
    const cover = result.findings.filter((f) => f.code === 'RBR-COVER-UNDER');

    expect(cover).toHaveLength(2);
    expect(cover.every((f) => (f.occurrences ?? 1) === 1)).toBe(true);
  });

  it('collapses a systemic failure into one finding', () => {
    const result = matWithBadCover(40);
    const cover = result.findings.filter((f) => f.code === 'RBR-COVER-UNDER');

    expect(cover).toHaveLength(1);
    expect(cover[0]?.occurrences).toBe(40);
    expect(cover[0]?.title).toBe('40 bars short of cover');
    // The whole point: it must still say which bars, and how bad it got.
    expect(cover[0]?.detail).toMatch(/every bar/i);
    expect(cover[0]?.affectedIndexes).toHaveLength(40);
  });

  it('does not let consolidation shrink the deficiency count', () => {
    // The invariant that makes this a formatting change rather than a
    // quiet rewriting of the result.
    const summary = summariseReport([matWithBadCover(40)]);
    expect(summary.deficiencies).toBeGreaterThanOrEqual(40);
    expect(summary.overall).toBe('fail');
  });

  it('names the affected bays and the worst one when spacing fails in bulk', () => {
    // Every bay 1 1/2" over: individually reported that is 5 paragraphs.
    const points = [0, 17.5, 35, 52.5, 70, 87.5].map((x) => vec(x, 0, 0));
    const result = runFramingSpacingCheck({
      points,
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    const spacing = result.findings.filter((f) => f.code === 'FRM-SPACING');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]?.occurrences).toBe(5);
    expect(spacing[0]?.title).toBe('5 bays out of tolerance');
    expect(spacing[0]?.detail).toMatch(/every bay/i);
    expect(spacing[0]?.detail).toMatch(/Worst is bay \d+/);
  });

  it('still reports a lone bad bay individually, with its bounding members', () => {
    const points = [0, 16, 32, 46, 62].map((x) => vec(x, 0, 0));
    const result = runFramingSpacingCheck({
      points,
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    const spacing = result.findings.filter((f) => f.code === 'FRM-SPACING');
    expect(spacing).toHaveLength(1);
    expect(spacing[0]?.occurrences).toBe(1);
    expect(spacing[0]?.detail).toContain('Between stud 3 and 4');
  });
});

describe('unexported work tracking', () => {
  const inspection = (updatedAt: string) => ({ updatedAt });

  it('treats everything as at risk when never exported', () => {
    expect(countUnexported([inspection('2026-08-23T09:00:00.000Z')], undefined)).toBe(1);
    expect(countUnexported([], undefined)).toBe(0);
  });

  it('counts only what changed after the export', () => {
    const exported = '2026-08-23T12:00:00.000Z';
    const list = [
      inspection('2026-08-23T09:00:00.000Z'),
      inspection('2026-08-23T11:59:59.000Z'),
      inspection('2026-08-23T12:00:01.000Z'),
      inspection('2026-08-24T08:00:00.000Z'),
    ];

    expect(countUnexported(list, exported)).toBe(2);
  });

  it('puts an edited inspection back at risk', () => {
    // Exported this morning, then edited this afternoon: the package on the
    // office machine no longer matches the handset.
    const exported = '2026-08-23T08:00:00.000Z';
    expect(countUnexported([inspection('2026-08-23T16:30:00.000Z')], exported)).toBe(1);
  });

  it('does not re-flag work that has not changed since export', () => {
    const exported = '2026-08-23T18:00:00.000Z';
    const list = [inspection('2026-08-23T09:00:00.000Z'), inspection('2026-08-23T17:00:00.000Z')];
    expect(countUnexported(list, exported)).toBe(0);
  });
});

describe('storage reporting', () => {
  it('formats byte counts for humans', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(20 * 1024 * 1024)).toBe('20 MB');
    expect(formatBytes(undefined)).toBe('unknown');
  });

  it('tells the user to export whenever protection is not guaranteed', () => {
    // The one thing that must never be dropped from these strings.
    expect(describePersistence({ state: 'not-persisted' })).toMatch(/export/i);
    expect(describePersistence({ state: 'unsupported' })).toMatch(/export/i);
    expect(describePersistence({ state: 'persisted' })).toMatch(/export/i);
  });
});

describe('report', () => {
  const profile = getProfile('standard');

  const sampleReport = () => {
    // Every bay within tolerance, but the run walks off — the case the whole
    // drift check exists for.
    const drifted = runFramingSpacingCheck({
      points: [0, 16.2, 32.4, 48.6, 64.8].map((x) => vec(x, 0, 0)),
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    return renderReportHtml({
      projectName: 'Test Project',
      location: 'Somewhere',
      inspector: 'A. Inspector',
      capturedAt: new Date('2026-08-23T09:15:00'),
      measurementMethod: 'ARKit with LiDAR scene depth',
      toleranceProfile: profile,
      checks: [drifted],
    });
  };

  it('prints tolerances as fractions, never as decimals', () => {
    // A QC document that says "±0.25 in" reads as machined tolerance and
    // does not match any other number on the page.
    const html = sampleReport();

    expect(html).toContain('Framing bay spacing: &plusmn;1/4&quot;');
    expect(html).toContain('Clear cover, allowed reduction: 3/8&quot;');
    expect(html).not.toMatch(/0\.25|0\.375|0\.5&Prime;/);
  });

  it('states where the tolerance numbers came from', () => {
    // Nobody should be able to mistake a shipped default for a spec value.
    expect(sampleReport()).toContain(profile.sourceNote.slice(0, 40));
  });

  it('escapes user-entered text', () => {
    const html = renderReportHtml({
      projectName: '<script>alert(1)</script>',
      location: 'Site',
      inspector: 'A & B',
      capturedAt: new Date('2026-08-23T09:15:00'),
      measurementMethod: 'test',
      toleranceProfile: profile,
      checks: [],
    });

    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).toContain('A &amp; B');
  });

  it('separates "could not measure" from "passed"', () => {
    const invalid = runFramingSpacingCheck({
      points: [vec(0, 0, 0), vec(16, 8, 0), vec(32, -7, 0)],
      memberType: 'stud',
      nominalOCIn: 16,
      tolerances: profile.framing,
    });

    const summary = summariseReport([invalid]);
    expect(summary.invalid).toBe(1);
    expect(summary.overall).toBe('invalid');
    expect(summary.passed).toBe(0);
  });
});
