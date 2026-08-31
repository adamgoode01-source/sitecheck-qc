/**
 * 3D geometry used to turn a handful of tapped points into a measurement.
 *
 * Points arrive from ARKit in metres; callers convert to inches before
 * reaching this module. Nothing here knows about units — it is pure geometry.
 *
 * The two workhorses are `fitLine3` (a run of studs / a row of bars) and
 * `fitPlane3` (a form face / a sheathed wall). Both report an RMS residual,
 * which the checks use to decide whether a capture is trustworthy at all.
 * A tight fit is not proof the work is right, but a loose fit IS proof the
 * measurement is not worth reporting.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export const vec = (x: number, y: number, z: number): Vec3 => ({ x, y, z });
export const add = (a: Vec3, b: Vec3): Vec3 => vec(a.x + b.x, a.y + b.y, a.z + b.z);
export const sub = (a: Vec3, b: Vec3): Vec3 => vec(a.x - b.x, a.y - b.y, a.z - b.z);
export const scale = (a: Vec3, k: number): Vec3 => vec(a.x * k, a.y * k, a.z * k);
export const dot = (a: Vec3, b: Vec3): number => a.x * b.x + a.y * b.y + a.z * b.z;
export const cross = (a: Vec3, b: Vec3): Vec3 =>
  vec(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
export const magnitude = (a: Vec3): number => Math.sqrt(dot(a, a));
export const distance = (a: Vec3, b: Vec3): number => magnitude(sub(a, b));

export function normalize(a: Vec3): Vec3 {
  const len = magnitude(a);
  if (len === 0) throw new Error('Cannot normalize a zero-length vector');
  return scale(a, 1 / len);
}

export function centroid(points: readonly Vec3[]): Vec3 {
  if (points.length === 0) throw new Error('Cannot take the centroid of an empty point set');
  let sx = 0;
  let sy = 0;
  let sz = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
    sz += p.z;
  }
  const n = points.length;
  return vec(sx / n, sy / n, sz / n);
}

/* ------------------------------------------------------------------ *
 * Lines
 * ------------------------------------------------------------------ */

export interface Line3 {
  /** A point on the line — always the centroid of the input set. */
  origin: Vec3;
  /** Unit direction. */
  direction: Vec3;
}

export interface LineFit {
  line: Line3;
  /** RMS perpendicular distance from the input points to the fitted line. */
  rms: number;
  /** Largest single perpendicular deviation. */
  maxDeviation: number;
}

/**
 * Total-least-squares line through a point cloud: the principal axis of the
 * covariance matrix. Unlike an ordinary least-squares fit this has no
 * dependent variable, so a vertical run of studs is handled as gracefully as
 * a horizontal one.
 */
export function fitLine3(points: readonly Vec3[]): LineFit {
  if (points.length < 2) throw new Error('A line fit needs at least 2 points');

  const origin = centroid(points);
  const { vectors } = eigenSymmetric3(covariance(points, origin));
  // Eigenvectors come back sorted by descending eigenvalue: the first is the
  // direction of greatest spread, i.e. along the run.
  const direction = normalize(vectors[0]);

  let sumSq = 0;
  let maxDeviation = 0;
  for (const p of points) {
    const d = perpendicularDistanceToLine(p, { origin, direction });
    sumSq += d * d;
    if (d > maxDeviation) maxDeviation = d;
  }

  return {
    line: { origin, direction },
    rms: Math.sqrt(sumSq / points.length),
    maxDeviation,
  };
}

/** Signed position of a point along the line, measured from `origin`. */
export function projectOntoLine(p: Vec3, line: Line3): number {
  return dot(sub(p, line.origin), line.direction);
}

export function perpendicularDistanceToLine(p: Vec3, line: Line3): number {
  const d = sub(p, line.origin);
  const along = dot(d, line.direction);
  return magnitude(sub(d, scale(line.direction, along)));
}

/* ------------------------------------------------------------------ *
 * Planes
 * ------------------------------------------------------------------ */

export interface Plane {
  /** A point on the plane — always the centroid of the input set. */
  origin: Vec3;
  /** Unit normal. */
  normal: Vec3;
}

export interface PlaneFit {
  plane: Plane;
  /** RMS distance from the input points to the fitted plane. */
  rms: number;
  maxDeviation: number;
  /**
   * Whether `rms` actually tells you anything.
   *
   * Three points define a plane exactly, so the residual is always zero and a
   * flatness test on three taps can never fail — including when one of them
   * landed on a toe-board. Only a fourth point can contradict the first
   * three. Callers must not treat a zero residual from three points as
   * evidence the surface is flat.
   */
  verifiable: boolean;
}

/**
 * Best-fit plane through 3 or more points (the form face, when measuring
 * rebar cover). The normal is the axis of *least* spread.
 */
export function fitPlane3(points: readonly Vec3[]): PlaneFit {
  if (points.length < 3) throw new Error('A plane fit needs at least 3 points');

  const origin = centroid(points);
  const { vectors } = eigenSymmetric3(covariance(points, origin));
  const normal = normalize(vectors[2]);

  let sumSq = 0;
  let maxDeviation = 0;
  for (const p of points) {
    const d = Math.abs(signedDistanceToPlane(p, { origin, normal }));
    sumSq += d * d;
    if (d > maxDeviation) maxDeviation = d;
  }

  return {
    plane: { origin, normal },
    rms: Math.sqrt(sumSq / points.length),
    maxDeviation,
    verifiable: points.length >= 4,
  };
}

/** Positive on the side the normal points toward. */
export function signedDistanceToPlane(p: Vec3, plane: Plane): number {
  return dot(sub(p, plane.origin), plane.normal);
}

/**
 * Flips a plane's normal so it points toward `reference`. Used to orient a
 * form-face plane toward the camera, so cover distances come out positive
 * regardless of which way the user walked around the wall.
 */
export function orientPlaneToward(plane: Plane, reference: Vec3): Plane {
  return signedDistanceToPlane(reference, plane) < 0
    ? { origin: plane.origin, normal: scale(plane.normal, -1) }
    : plane;
}

/**
 * Flips a line's direction so that points run from `from` toward `to`.
 * Without this the reported "first stud" could be either end of the wall,
 * because eigenvector sign is arbitrary.
 */
export function orientLineAlong(line: Line3, from: Vec3, to: Vec3): Line3 {
  return dot(sub(to, from), line.direction) < 0
    ? { origin: line.origin, direction: scale(line.direction, -1) }
    : line;
}

/* ------------------------------------------------------------------ *
 * Linear algebra
 * ------------------------------------------------------------------ */

/** Row-major symmetric 3x3. */
export type Mat3 = readonly number[];

function covariance(points: readonly Vec3[], mean: Vec3): Mat3 {
  let xx = 0;
  let xy = 0;
  let xz = 0;
  let yy = 0;
  let yz = 0;
  let zz = 0;
  for (const p of points) {
    const dx = p.x - mean.x;
    const dy = p.y - mean.y;
    const dz = p.z - mean.z;
    xx += dx * dx;
    xy += dx * dy;
    xz += dx * dz;
    yy += dy * dy;
    yz += dy * dz;
    zz += dz * dz;
  }
  const n = points.length;
  return [xx / n, xy / n, xz / n, xy / n, yy / n, yz / n, xz / n, yz / n, zz / n];
}

/**
 * Cyclic Jacobi eigenvalue decomposition for a symmetric 3x3 matrix.
 *
 * Chosen over the closed-form trigonometric solution because it stays
 * numerically stable when eigenvalues are nearly equal — exactly the
 * degenerate case we hit when a user taps points that are almost coincident,
 * and precisely when we most need the RMS residual to come out meaningful
 * rather than NaN.
 *
 * Returns eigenvalues in descending order with matching unit eigenvectors.
 */
export function eigenSymmetric3(input: Mat3): {
  values: [number, number, number];
  vectors: [Vec3, Vec3, Vec3];
} {
  const a = input.slice();
  const at = (r: number, c: number): number => a[r * 3 + c] as number;
  const setA = (r: number, c: number, value: number): void => {
    a[r * 3 + c] = value;
  };

  // V accumulates the rotations; its columns end up as the eigenvectors.
  const v = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  const vt = (r: number, c: number): number => v[r * 3 + c] as number;
  const setV = (r: number, c: number, value: number): void => {
    v[r * 3 + c] = value;
  };

  const pairs: ReadonlyArray<readonly [number, number]> = [
    [0, 1],
    [0, 2],
    [1, 2],
  ];

  for (let sweep = 0; sweep < 50; sweep++) {
    const off = at(0, 1) ** 2 + at(0, 2) ** 2 + at(1, 2) ** 2;
    if (off < 1e-24) break;

    for (const pair of pairs) {
      const p = pair[0];
      const q = pair[1];
      const apq = at(p, q);
      if (Math.abs(apq) < 1e-30) continue;

      // Rotation angle chosen to zero out a[p][q].
      const theta = (at(q, q) - at(p, p)) / (2 * apq);
      const sign = theta >= 0 ? 1 : -1;
      const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1);
      const s = t * c;

      for (let k = 0; k < 3; k++) {
        const akp = at(k, p);
        const akq = at(k, q);
        setA(k, p, c * akp - s * akq);
        setA(k, q, s * akp + c * akq);
      }
      for (let k = 0; k < 3; k++) {
        const apk = at(p, k);
        const aqk = at(q, k);
        setA(p, k, c * apk - s * aqk);
        setA(q, k, s * apk + c * aqk);
      }
      for (let k = 0; k < 3; k++) {
        const vkp = vt(k, p);
        const vkq = vt(k, q);
        setV(k, p, c * vkp - s * vkq);
        setV(k, q, s * vkp + c * vkq);
      }
    }
  }

  const eigen = [0, 1, 2]
    .map((i) => ({ value: at(i, i), vector: vec(vt(0, i), vt(1, i), vt(2, i)) }))
    .sort((l, r) => r.value - l.value);

  return {
    values: [
      eigen[0]?.value ?? 0,
      eigen[1]?.value ?? 0,
      eigen[2]?.value ?? 0,
    ],
    vectors: [
      eigen[0]?.vector ?? vec(1, 0, 0),
      eigen[1]?.vector ?? vec(0, 1, 0),
      eigen[2]?.vector ?? vec(0, 0, 1),
    ],
  };
}
