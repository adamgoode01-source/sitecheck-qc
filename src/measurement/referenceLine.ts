/**
 * Windows fallback: measuring from a flat photograph using a known reference.
 *
 * ---------------------------------------------------------------------------
 * This is deliberately the weaker path, and the app says so everywhere it is
 * used. Windows has no ARKit and no depth sensor, so a photo emailed in from
 * the field can only be scaled, never truly measured. The maths below is a
 * plain similarity transform: it assumes the camera was square-on to the wall
 * and that everything measured lies in the same plane as the reference. Both
 * assumptions are routinely violated on a jobsite, and every degree of
 * off-axis shot puts a cosine error into the result.
 *
 * Use it to triage — "that bay looks a long way over" — and to review what the
 * field crew captured. Do not issue a deficiency off it without a tape.
 * ---------------------------------------------------------------------------
 */

import { type Vec3, vec } from '../domain/geometry';
import {
  type CaptureRequest,
  type CaptureResult,
  type MeasurementProvider,
  type PhasePoints,
  type ProviderAvailability,
  PHASE,
} from './provider';

export interface PixelPoint {
  x: number;
  y: number;
}

export interface ReferenceCalibration {
  /** Scale factor applied to pixel distances. */
  inchesPerPixel: number;
  /** Length of the drawn reference line, pixels. */
  referencePixelLength: number;
  /** What the user said that line measures in the real world, inches. */
  knownLengthIn: number;
}

/**
 * Build a scale from a line drawn along something of known length — a tape
 * held against the work, a 4'-0" sheet edge, a door leaf.
 *
 * Longer references are dramatically better: the user's two clicks each carry
 * a pixel or two of error, so a reference spanning a quarter of the frame
 * gives roughly ten times the precision of one spanning a fortieth.
 */
export function calibrate(
  from: PixelPoint,
  to: PixelPoint,
  knownLengthIn: number,
): ReferenceCalibration {
  if (!(knownLengthIn > 0)) throw new Error('Reference length must be greater than zero');

  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const referencePixelLength = Math.sqrt(dx * dx + dy * dy);

  if (referencePixelLength < 1) {
    throw new Error('Reference line is too short to calibrate from — draw it along the full known length');
  }

  return {
    inchesPerPixel: knownLengthIn / referencePixelLength,
    referencePixelLength,
    knownLengthIn,
  };
}

/**
 * Project a pixel tap onto the calibrated plane. Z is always zero: this
 * method produces 2D points only, which is exactly why cover cannot be
 * measured from a photograph.
 */
export function pixelToPoint(px: PixelPoint, calibration: ReferenceCalibration): Vec3 {
  return vec(px.x * calibration.inchesPerPixel, px.y * calibration.inchesPerPixel, 0);
}

/**
 * How much of the frame the reference spans, 0..1. Below about 0.15 the
 * scale is too sensitive to click error to be worth reporting.
 */
export function referenceQuality(
  calibration: ReferenceCalibration,
  imageWidth: number,
  imageHeight: number,
): { fraction: number; adequate: boolean } {
  const diagonal = Math.sqrt(imageWidth * imageWidth + imageHeight * imageHeight);
  const fraction = diagonal > 0 ? calibration.referencePixelLength / diagonal : 0;
  return { fraction, adequate: fraction >= 0.15 };
}

/* ------------------------------------------------------------------ *
 * Provider
 * ------------------------------------------------------------------ */

export interface ReferenceCaptureOutcome {
  image: Blob;
  imageWidth: number;
  imageHeight: number;
  calibration: ReferenceCalibration;
  /** Marks per capture phase, in image pixel coordinates. */
  pixelPoints: Record<string, PixelPoint[]>;
}

/**
 * The desktop capture is an interactive screen, so the provider cannot drive
 * it alone. The React shell registers a host on start-up; the provider calls
 * it and stays free of any UI import.
 */
export type ReferenceCaptureHost = (
  request: CaptureRequest,
) => Promise<ReferenceCaptureOutcome | null>;

let host: ReferenceCaptureHost | null = null;

export function setReferenceCaptureHost(fn: ReferenceCaptureHost | null): void {
  host = fn;
}

export const REFERENCE_PROVIDER_ID = 'reference-line';

export class ReferenceLineProvider implements MeasurementProvider {
  id = REFERENCE_PROVIDER_ID;
  displayName = 'Photo with known reference';
  accuracyNote =
    'Scaled from a photograph against a reference of known length. Assumes the camera was square-on and that everything measured lies in the same plane as the reference. Treat results as indicative only and confirm deficiencies with a tape.';

  /**
   * Availability is a property of the environment, not of the UI.
   *
   * This used to report on whether the capture host had registered, which
   * made the answer depend on React mount order — the settings screen asked
   * before `PhotoMeasureHost`'s effect had run and was told "unavailable",
   * while the capture screen a moment later got "available". Host
   * registration is an implementation detail of the shell; if it is somehow
   * missing when a capture is actually requested, `capture()` throws with a
   * clear message rather than the whole method quietly disappearing from the
   * settings list.
   */
  async isAvailable(): Promise<ProviderAvailability> {
    return typeof document === 'undefined'
      ? { available: false, reason: 'Photo measurement needs a browser environment.' }
      : { available: true };
  }

  async capture(request: CaptureRequest): Promise<CaptureResult | null> {
    if (!host) throw new Error('No reference capture host is registered');

    const outcome = await host(request);
    if (!outcome) return null;

    const phases: Record<string, PhasePoints> = {};
    for (const [phaseId, marks] of Object.entries(outcome.pixelPoints)) {
      phases[phaseId] = {
        points: marks.map((px) => ({
          position: pixelToPoint(px, outcome.calibration),
          confidence: 'low' as const,
        })),
      };
    }

    const warnings = [
      'Measured from a photograph, not a depth sensor. Off-axis camera angle and any depth difference between the reference and the work introduce error that this method cannot detect.',
    ];

    const quality = referenceQuality(outcome.calibration, outcome.imageWidth, outcome.imageHeight);
    if (!quality.adequate) {
      warnings.push(
        `The reference line spans only ${Math.round(quality.fraction * 100)}% of the image. Small click errors are magnified at this scale — re-draw it along a longer known dimension.`,
      );
    }

    // Anything needing a real surface cannot come from a flat photograph.
    // Say which specific check is unavailable rather than letting the
    // geometry produce a confident, meaningless number.
    if (request.phases.some((p) => p.id === PHASE.FORM_FACE)) {
      warnings.push(
        'Concrete cover cannot be measured from a photograph — it needs a 3D form-face plane. Cover was not assessed. Capture it on iOS with ARKit.',
      );
    }
    if (request.phases.some((p) => p.id === PHASE.FLOOR)) {
      warnings.push(
        'Height above floor measured from a photograph assumes the camera was square-on to the wall. Confirm anything close to tolerance with a tape.',
      );
    }

    return {
      providerId: this.id,
      method: `Photo scaled from a ${outcome.calibration.knownLengthIn}" reference`,
      phases,
      // Image Y runs down the page, so "up" is negative Y in this frame.
      upDirection: vec(0, -1, 0),
      photo: outcome.image,
      warnings,
    };
  }
}
