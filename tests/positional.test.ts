import { describe, expect, it } from 'vitest';
import { vec } from '../src/domain/geometry';
import { analyseRoughIn, horizontalDistance } from '../src/domain/roughIn';
import { analyseOpening, orderCorners, UP_Y } from '../src/domain/opening';
import { runRoughInCheck } from '../src/domain/checks/roughIn';
import { runOpeningCheck } from '../src/domain/checks/openings';
import { getProfile } from '../src/domain/tolerance';
import { migrateGeometry } from '../src/storage/models';
import { runCheck } from '../src/domain/checks';

const profile = getProfile('standard');

/** A floor at y = 0, spanning enough area to fit a plane through. */
const FLOOR = [vec(0, 0, 0), vec(120, 0, 0), vec(0, 0, 120), vec(120, 0, 120)];

describe('rough-in geometry', () => {
  it('measures height above the captured floor', () => {
    const analysis = analyseRoughIn([vec(24, 18, 0)], FLOOR, {
      specifiedHeightIn: 18,
      heightToleranceIn: 0.5,
    });

    expect(analysis.captureTrusted).toBe(true);
    expect(analysis.entries[0]?.heightAffIn).toBeCloseTo(18, 5);
    expect(analysis.entries[0]?.heightStatus).toBe('pass');
  });

  it('subtracts floor build-up to get height above FINISHED floor', () => {
    // Boxes set 18" off bare slab, with 1 1/2" of topping still to come, land
    // at 16 1/2" AFF. This is the classic way a whole floor ends up wrong.
    const analysis = analyseRoughIn([vec(24, 18, 0)], FLOOR, {
      specifiedHeightIn: 18,
      heightToleranceIn: 0.5,
      floorBuildUpIn: 1.5,
    });

    expect(analysis.entries[0]?.heightAffIn).toBeCloseTo(16.5, 5);
    expect(analysis.entries[0]?.heightStatus).toBe('low');
    expect(analysis.summary.status).toBe('fail');
  });

  it('measures offset in the plane of the floor, not straight line', () => {
    // A box 48" up and 12" along from a datum is 12" away on the drawing and
    // ~49 1/2" away in 3D. The drawing dimension is always the plan distance.
    const floorPlane = { origin: vec(0, 0, 0), normal: vec(0, 1, 0) };
    expect(horizontalDistance(vec(12, 48, 0), vec(0, 0, 0), floorPlane)).toBeCloseTo(12, 5);
  });

  it('checks offset from a datum when one is given', () => {
    const analysis = analyseRoughIn(
      [vec(36, 18, 0)],
      FLOOR,
      {
        specifiedHeightIn: 18,
        heightToleranceIn: 0.5,
        specifiedOffsetIn: 36,
        offsetToleranceIn: 0.5,
      },
      vec(0, 12, 0),
    );

    expect(analysis.entries[0]?.offsetIn).toBeCloseTo(36, 5);
    expect(analysis.entries[0]?.offsetStatus).toBe('pass');
  });

  it('reports offset as not-checked rather than passing it', () => {
    const analysis = analyseRoughIn([vec(36, 18, 0)], FLOOR, {
      specifiedHeightIn: 18,
      heightToleranceIn: 0.5,
    });

    expect(analysis.entries[0]?.offsetStatus).toBe('not-checked');
    expect(analysis.summary.outOfOffsetTolerance).toBe(0);
  });

  it('catches a row that is uneven with itself even when each meets spec', () => {
    // Both inside a +/-1/2" spec, but 3/8" apart on the wall — visible.
    const analysis = analyseRoughIn(
      [vec(0, 17.8, 0), vec(24, 18.175, 0)],
      FLOOR,
      {
        specifiedHeightIn: 18,
        heightToleranceIn: 0.5,
        alignmentToleranceIn: 0.25,
      },
    );

    expect(analysis.entries.every((e) => e.heightStatus === 'pass')).toBe(true);
    expect(analysis.summary.alignmentPass).toBe(false);
    expect(analysis.summary.status).toBe('fail');
  });
});

describe('rough-in check', () => {
  it('says explicitly when horizontal position was not assessed', () => {
    const result = runRoughInCheck({
      fixturePoints: [vec(24, 18, 0)],
      floorPoints: FLOOR,
      fixtureType: 'receptacle',
      specifiedHeightIn: 18,
      tolerances: profile.roughIn,
    });

    expect(result.status).toBe('pass');
    expect(result.findings.some((f) => f.code === 'RGH-OFFSET-SKIPPED')).toBe(true);
  });

  it('consolidates a floor of boxes set off the wrong datum', () => {
    const boxes = Array.from({ length: 12 }, (_, i) => vec(i * 24, 16.5, 0));
    const result = runRoughInCheck({
      fixturePoints: boxes,
      floorPoints: FLOOR,
      fixtureType: 'receptacle',
      specifiedHeightIn: 18,
      tolerances: profile.roughIn,
    });

    const height = result.findings.filter((f) => f.code === 'RGH-HEIGHT');
    expect(height).toHaveLength(1);
    expect(height[0]?.occurrences).toBe(12);
    expect(height[0]?.detail).toMatch(/every receptacle/i);
  });

  it('refuses to report heights from a floor capture that is not flat', () => {
    // Four points, one well off the plane the other three define.
    const result = runRoughInCheck({
      fixturePoints: [vec(24, 18, 0)],
      floorPoints: [vec(0, 0, 0), vec(120, 0, 0), vec(0, 0, 120), vec(60, 9, 60)],
      fixtureType: 'receptacle',
      specifiedHeightIn: 18,
      tolerances: profile.roughIn,
    });

    expect(result.status).toBe('invalid');
  });

  it('says flatness is unverified when only three floor points were taken', () => {
    // Three points always fit a plane exactly, so a zero residual proves
    // nothing. Reporting it as verified would be the dangerous option.
    const result = runRoughInCheck({
      fixturePoints: [vec(24, 18, 0)],
      floorPoints: [vec(0, 0, 0), vec(120, 0, 0), vec(0, 0, 120)],
      fixtureType: 'receptacle',
      specifiedHeightIn: 18,
      tolerances: profile.roughIn,
    });

    expect(result.findings.some((f) => f.code === 'RGH-FLOOR-UNVERIFIED')).toBe(true);
  });
});

describe('plane fit verifiability', () => {
  it('marks a three-point plane as unverifiable', () => {
    const three = analyseRoughIn([vec(0, 18, 0)], [vec(0, 0, 0), vec(10, 0, 0), vec(0, 0, 10)], {
      specifiedHeightIn: 18,
      heightToleranceIn: 0.5,
    });

    expect(three.floorFitRmsIn).toBeCloseTo(0, 9);
    expect(three.flatnessVerified).toBe(false);
  });

  it('marks a four-point plane as verifiable', () => {
    const four = analyseRoughIn([vec(0, 18, 0)], FLOOR, {
      specifiedHeightIn: 18,
      heightToleranceIn: 0.5,
    });

    expect(four.flatnessVerified).toBe(true);
  });
});

describe('opening geometry', () => {
  /** A 38 x 84 opening in the x-y plane, corners given out of order. */
  const opening = [vec(38, 84, 0), vec(0, 0, 0), vec(0, 84, 0), vec(38, 0, 0)];

  it('sorts arbitrary corner taps into the right corners', () => {
    const plane = { origin: vec(19, 42, 0), normal: vec(0, 0, 1) };
    const corners = orderCorners(opening, plane, UP_Y);

    expect(corners.bottomLeft.y).toBeCloseTo(0, 5);
    expect(corners.bottomRight.y).toBeCloseTo(0, 5);
    expect(corners.topLeft.y).toBeCloseTo(84, 5);
    expect(corners.bottomLeft.x).not.toBeCloseTo(corners.bottomRight.x, 5);
  });

  it('measures a square opening as square', () => {
    const analysis = analyseOpening(opening, {
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      widthToleranceIn: 0.25,
      heightToleranceIn: 0.25,
      squarenessToleranceIn: 0.25,
      plumbToleranceIn: 0.25,
      levelToleranceIn: 0.25,
    });

    expect(analysis.measurements.widthIn).toBeCloseTo(38, 5);
    expect(analysis.measurements.heightIn).toBeCloseTo(84, 5);
    expect(analysis.measurements.diagonalDifferenceIn).toBeCloseTo(0, 5);
    expect(analysis.status).toBe('pass');
  });

  it('catches a racked opening whose width and height both pass', () => {
    // Top edge shifted 1" sideways: both widths and both heights are still
    // fine, but the diagonals differ and no prehung door will go in.
    const racked = [vec(0, 0, 0), vec(38, 0, 0), vec(1, 84, 0), vec(39, 84, 0)];
    const analysis = analyseOpening(racked, {
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      widthToleranceIn: 0.25,
      heightToleranceIn: 0.25,
      squarenessToleranceIn: 0.25,
      plumbToleranceIn: 0.25,
      levelToleranceIn: 0.25,
    });

    expect(analysis.measurements.topWidthIn).toBeCloseTo(38, 5);
    expect(analysis.measurements.bottomWidthIn).toBeCloseTo(38, 5);
    expect(analysis.measurements.diagonalDifferenceIn).toBeGreaterThan(0.25);
    expect(analysis.issues).toContain('square');
    expect(analysis.issues).toContain('plumb');
  });

  it('catches an out-of-level sill', () => {
    const sloped = [vec(0, 0, 0), vec(38, 0.5, 0), vec(0, 84, 0), vec(38, 84.5, 0)];
    const analysis = analyseOpening(sloped, {
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      widthToleranceIn: 0.5,
      heightToleranceIn: 0.5,
      squarenessToleranceIn: 0.5,
      plumbToleranceIn: 0.5,
      levelToleranceIn: 0.25,
    });

    expect(analysis.measurements.sillOutOfLevelIn).toBeCloseTo(0.5, 5);
    expect(analysis.issues).toContain('level');
  });

  it('detects a twisted opening that no 2D check could see', () => {
    // One corner pushed out of the wall plane.
    const twisted = [vec(0, 0, 0), vec(38, 0, 0), vec(0, 84, 0), vec(38, 84, 1.5)];
    const analysis = analyseOpening(twisted, {
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      widthToleranceIn: 1,
      heightToleranceIn: 1,
      squarenessToleranceIn: 1,
      plumbToleranceIn: 1,
      levelToleranceIn: 1,
    });

    expect(analysis.issues).toContain('twist');
    expect(analysis.captureTrusted).toBe(false);
  });

  it('handles a photo frame where up is negative Y', () => {
    // Image coordinates run down the page; without the up hint the corners
    // would sort upside down and jamb/sill measurements would swap.
    const inImageSpace = [vec(0, 84, 0), vec(38, 84, 0), vec(0, 0, 0), vec(38, 0, 0)];
    const corners = orderCorners(
      inImageSpace,
      { origin: vec(19, 42, 0), normal: vec(0, 0, 1) },
      vec(0, -1, 0),
    );

    // "Bottom" in the real world is the larger image Y.
    expect(corners.bottomLeft.y).toBeCloseTo(84, 5);
    expect(corners.topLeft.y).toBeCloseTo(0, 5);
  });
});

describe('opening check', () => {
  it('separates a size problem from a squareness problem', () => {
    const racked = [vec(0, 0, 0), vec(38, 0, 0), vec(1, 84, 0), vec(39, 84, 0)];
    const result = runOpeningCheck({
      cornerPoints: racked,
      kind: 'door',
      reference: '204',
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      tolerances: profile.openings,
    });

    expect(result.status).toBe('fail');
    expect(result.findings.some((f) => f.code === 'OPN-SQUARE')).toBe(true);
    expect(result.findings.some((f) => f.code === 'OPN-WIDTH')).toBe(false);
  });

  it('rejects a capture that is not four corners', () => {
    const result = runOpeningCheck({
      cornerPoints: [vec(0, 0, 0), vec(38, 0, 0), vec(0, 84, 0)],
      kind: 'door',
      specifiedWidthIn: 38,
      specifiedHeightIn: 84,
      tolerances: profile.openings,
    });

    expect(result.status).toBe('invalid');
  });
});

describe('capture geometry migration', () => {
  it('converts a schema-1 capture without losing points', () => {
    const legacy = {
      points: [vec(0, 0, 0), vec(16, 0, 0)],
      confidences: ['high', 'high'],
      formFacePoints: [vec(0, 0, -2), vec(16, 0, -2), vec(8, 4, -2)],
      providerId: 'arkit',
      method: 'ARKit with LiDAR scene depth',
      warnings: [],
      capturedAt: '2026-08-23T09:00:00.000Z',
    } as never;

    const migrated = migrateGeometry(legacy);

    expect(migrated.phases['primary']?.points).toHaveLength(2);
    expect(migrated.phases['form-face']?.points).toHaveLength(3);
    expect('points' in migrated).toBe(false);
  });

  it('is idempotent', () => {
    const already = {
      phases: { primary: { points: [vec(0, 0, 0)], confidences: ['high' as const] } },
      providerId: 'arkit',
      method: 'test',
      warnings: [],
      capturedAt: '2026-08-23T09:00:00.000Z',
    };

    expect(migrateGeometry(already)).toBe(already);
  });

  it('still runs an old stored framing check after migration', () => {
    // The reason the migration exists: a QC record has to stay openable.
    const legacy = {
      points: [0, 16, 32, 48].map((x) => vec(x, 0, 0)),
      confidences: ['high', 'high', 'high', 'high'],
      providerId: 'arkit',
      method: 'ARKit with LiDAR scene depth',
      warnings: [],
      capturedAt: '2026-08-23T09:00:00.000Z',
    } as never;

    const result = runCheck(
      {
        kind: 'framing',
        memberType: 'stud',
        nominalOCIn: 16,
        expectedSource: { kind: 'typed' },
      },
      legacy,
      profile,
    );

    expect(result.status).toBe('pass');
  });
});
