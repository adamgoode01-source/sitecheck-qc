/**
 * The seam between "how points were measured" and "what the points mean".
 *
 * Everything above this interface — checks, reports, storage — is identical
 * on iOS and Windows. Everything below it is platform-specific and, crucially,
 * differs in accuracy. Each provider therefore has to declare how good it is,
 * and that declaration is carried through onto the printed report. A reader
 * must never be left guessing whether a number came from a LiDAR sensor or
 * from someone dragging a line across a photograph.
 *
 * A capture is a sequence of named PHASES. Framing needs one ("mark each
 * stud"); rebar cover needs two (bars, then the form face); a rough-in check
 * needs three (floor, datum, fixtures). Rather than grow a boolean per
 * question, the check describes the phases it wants and gets back points
 * keyed by phase.
 */

import type { Vec3 } from '../domain/geometry';

export type Confidence = 'high' | 'medium' | 'low';

export interface MeasuredPoint {
  /** Position in the capture frame, INCHES. Providers convert from metres. */
  position: Vec3;
  confidence: Confidence;
}

/**
 * Well-known phase ids. Checks may use any string, but sharing these keeps
 * stored captures readable and lets the UI show sensible labels.
 */
export const PHASE = {
  /** The things being checked: studs, bars, boxes, opening corners. */
  PRIMARY: 'primary',
  /** Form face / soffit, for concrete cover. */
  FORM_FACE: 'form-face',
  /** Floor or slab surface, for heights above floor. */
  FLOOR: 'floor',
  /** A single reference point: a corner, a jamb, a grid line. */
  DATUM: 'datum',
} as const;

export interface CapturePhase {
  id: string;
  /** Screen title while this phase is active. */
  title: string;
  /** One-line instruction shown over the camera. */
  instruction: string;
  minPoints: number;
  maxPoints?: number;
  /**
   * The user may skip this phase. Checks must treat a missing optional phase
   * as "not assessed" and say so, never as a pass.
   */
  optional?: boolean;
}

export interface CaptureRequest {
  /** Overall title, e.g. "Rough-in locations". */
  title: string;
  phases: CapturePhase[];
}

export interface PhasePoints {
  points: MeasuredPoint[];
}

export interface CaptureResult {
  providerId: string;
  /** Human-readable method string printed on the report. */
  method: string;
  /** Captured points keyed by phase id. Skipped phases are absent. */
  phases: Record<string, PhasePoints>;
  /** Device position at capture, used to orient planes. */
  cameraPosition?: Vec3;
  /**
   * Which way is up in this capture's frame. ARKit world space is
   * gravity-aligned (+Y); a photograph's Y axis runs down the image. Checks
   * that sort points by height — openings, rough-in — need this rather than
   * assuming a convention and silently mirroring the result.
   */
  upDirection?: Vec3;
  /** JPEG of the scene, stored with the inspection as evidence. */
  photo?: Blob;
  /** Anything the user should know about this capture's reliability. */
  warnings: string[];
}

export interface ProviderAvailability {
  available: boolean;
  /** Why not, when unavailable — shown directly to the user. */
  reason?: string;
}

export interface MeasurementProvider {
  id: string;
  displayName: string;
  /**
   * Plain-language statement of what this provider can and cannot do.
   * Printed on the report and shown before the first capture.
   */
  accuracyNote: string;
  isAvailable(): Promise<ProviderAvailability>;
  capture(request: CaptureRequest): Promise<CaptureResult | null>;
}

/** Convenience: positions for one phase, or an empty array when it was skipped. */
export function phasePositions(result: CaptureResult, phaseId: string): Vec3[] {
  return result.phases[phaseId]?.points.map((p) => p.position) ?? [];
}

/** Thrown when the user backs out of a capture. Not an error condition. */
export class CaptureCancelled extends Error {
  constructor() {
    super('Capture cancelled');
    this.name = 'CaptureCancelled';
  }
}
