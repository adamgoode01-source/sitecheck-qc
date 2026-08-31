import { describe, expect, it } from 'vitest';
import {
  MIN_TRUSTWORTHY_SAMPLE,
  assessAgainstTolerance,
  assessConfidenceSignal,
  summariseTrials,
} from '../src/domain/calibration';
import { calibrationToCsv } from '../src/domain/calibrationCsv';
import type { CalibrationSession } from '../src/storage/models';

describe('trial statistics', () => {
  it('separates bias from spread', () => {
    // Every reading 1/8" long, with no scatter at all: pure bias.
    const stats = summariseTrials([0.125, 0.125, 0.125, 0.125]);

    expect(stats?.meanIn).toBeCloseTo(0.125, 9);
    expect(stats?.sdIn).toBeCloseTo(0, 9);
    expect(stats?.spread95In).toBeCloseTo(0, 9);
  });

  it('uses the sample standard deviation, not the population one', () => {
    // n-1 denominator: sd of [1,-1] is sqrt(2) ≈ 1.414, not 1.
    const stats = summariseTrials([1, -1]);
    expect(stats?.sdIn).toBeCloseTo(Math.SQRT2, 9);
  });

  it('reports the worst single trial, not just the spread', () => {
    const stats = summariseTrials([0.05, -0.4, 0.1]);
    expect(stats?.worstIn).toBeCloseTo(0.4, 9);
  });

  it('refuses to call a small sample trustworthy', () => {
    expect(summariseTrials([0.1, 0.2, 0.1])?.sufficientSample).toBe(false);

    const many = Array.from({ length: MIN_TRUSTWORTHY_SAMPLE }, () => 0.1);
    expect(summariseTrials(many)?.sufficientSample).toBe(true);
  });

  it('handles a single trial without dividing by zero', () => {
    const stats = summariseTrials([0.25]);
    expect(stats?.n).toBe(1);
    expect(stats?.sdIn).toBe(0);
    expect(Number.isFinite(stats?.ci95HighIn ?? NaN)).toBe(true);
  });

  it('returns null for no trials at all', () => {
    expect(summariseTrials([])).toBeNull();
  });
});

describe('gauge assessment', () => {
  const TOLERANCE = 0.25; // band = 0.5"

  /**
   * Stats whose 95% spread is a chosen fraction of the tolerance band.
   *
   * Values are placed inside each band rather than on its edge: the symmetric
   * pair goes through a sqrt round-trip, so a ratio of "exactly 1.0" lands a
   * hair either side of it and the test would assert on floating-point noise
   * rather than on behaviour.
   */
  const atRatio = (ratio: number) => {
    const sd = (ratio * TOLERANCE * 2) / 4;
    const x = sd / Math.SQRT2;
    return summariseTrials([x, -x])!;
  };

  it('passes an instrument that barely touches the band', () => {
    expect(assessAgainstTolerance(atRatio(0.05), TOLERANCE)?.verdict).toBe('excellent');
  });

  it('accepts under the usual one-third threshold', () => {
    const assessment = assessAgainstTolerance(atRatio(0.25), TOLERANCE);
    expect(assessment?.verdict).toBe('usable');
    expect(assessment?.percentOfBand).toBeCloseTo(25, 5);
  });

  it('calls it marginal when the tool eats much of the band', () => {
    expect(assessAgainstTolerance(atRatio(0.5), TOLERANCE)?.verdict).toBe('marginal');
  });

  it('refuses deficiencies once the tool error matches the tolerance', () => {
    const assessment = assessAgainstTolerance(atRatio(1.5), TOLERANCE);
    expect(assessment?.verdict).toBe('screening-only');
    expect(assessment?.headline).toMatch(/screening only/i);
  });

  it('puts the boundary at 100% of the band, erring toward the stricter verdict', () => {
    // The consequential edge: at 100% a pass and a fail are indistinguishable,
    // so it must not be reported as merely marginal.
    expect(assessAgainstTolerance(atRatio(1.02), TOLERANCE)?.verdict).toBe('screening-only');
    expect(assessAgainstTolerance(atRatio(0.98), TOLERANCE)?.verdict).toBe('marginal');
  });

  it('rejects a zero tolerance rather than dividing by it', () => {
    expect(assessAgainstTolerance(atRatio(0.5), 0)).toBeNull();
  });
});

describe('confidence signal', () => {
  const trial = (deviationIn: number, lowConfidence: boolean) => ({ deviationIn, lowConfidence });

  it('says nothing until both groups have trials', () => {
    const result = assessConfidenceSignal([trial(0.5, true), trial(0.1, false)]);
    expect(result.predictive).toBeNull();
    expect(result.summary).toMatch(/not enough/i);
  });

  it('confirms a flag that really does pick out the bad captures', () => {
    const result = assessConfidenceSignal([
      trial(0.4, true),
      trial(0.5, true),
      trial(0.45, true),
      trial(0.05, false),
      trial(0.06, false),
      trial(0.04, false),
    ]);

    expect(result.predictive).toBe(true);
    expect(result.summary).toMatch(/real information/i);
  });

  it('calls out a flag that predicts nothing', () => {
    // The finding that matters: a warning implying reliability it does not have.
    const result = assessConfidenceSignal([
      trial(0.1, true),
      trial(0.11, true),
      trial(0.09, true),
      trial(0.1, false),
      trial(0.1, false),
      trial(0.11, false),
    ]);

    expect(result.predictive).toBe(false);
    expect(result.summary).toMatch(/not predicting/i);
  });

  it('ignores the sign of the deviation when comparing groups', () => {
    // A consistently short low-confidence group is just as bad as a long one.
    const result = assessConfidenceSignal([
      trial(-0.4, true),
      trial(-0.5, true),
      trial(-0.45, true),
      trial(0.05, false),
      trial(0.06, false),
      trial(0.04, false),
    ]);
    expect(result.predictive).toBe(true);
  });
});

describe('calibration CSV', () => {
  const session = (note: string): CalibrationSession => ({
    id: 's1',
    name: 'Baseline',
    trueValueIn: 16,
    toleranceIn: 0.25,
    createdAt: '2026-08-23T09:00:00.000Z',
    updatedAt: '2026-08-23T09:00:00.000Z',
    trials: [
      {
        id: 't1',
        measuredIn: 16.0625,
        deviationIn: 0.0625,
        conditions: { distance: '4ft', angle: 'square', light: 'good', surface: 'matte', note },
        lowConfidence: false,
        warnings: [],
        method: 'ARKit with LiDAR scene depth',
        capturedAt: '2026-08-23T09:01:00.000Z',
      },
    ],
  });

  it('writes decimal inches, not fractions', () => {
    // Rounding to 1/16 would discard most of the signal being measured.
    const csv = calibrationToCsv(session(''));
    expect(csv).toContain('0.0625');
    expect(csv).not.toContain('1/16');
  });

  it('defuses spreadsheet formula injection in the free-text note', () => {
    const csv = calibrationToCsv(session('=SUM(A1:A9)'));
    expect(csv).not.toMatch(/,=SUM/);
    expect(csv).toContain("'=SUM(A1:A9)");
  });

  it('quotes values containing commas', () => {
    const csv = calibrationToCsv(session('windy, bright'));
    expect(csv).toContain('"windy, bright"');
  });
});
