/**
 * iOS measurement via ARKit — the primary, accurate path.
 *
 * The native side (see `packages/capacitor-sitecheck-ar/`) presents a full-screen AR view, raycasts
 * each tap against the scene mesh or a detected plane, and returns world-space
 * points in METRES. Conversion to inches happens here, at the boundary, so no
 * other module has to think about units.
 *
 * Accuracy in practice: on a LiDAR device over a few feet, point-to-point
 * error is typically a small fraction of an inch, which is adequate for
 * 16 o.c. framing and for cover. It degrades with distance, in bright sun,
 * and on dark or shiny surfaces — the native layer reports per-point
 * confidence and we surface low confidence rather than hiding it.
 */

import { registerPlugin } from '@capacitor/core';
import { vec } from '../domain/geometry';
import { metresToInches } from '../domain/units';
import type {
  CaptureRequest,
  CaptureResult,
  Confidence,
  MeasuredPoint,
  MeasurementProvider,
  PhasePoints,
  ProviderAvailability,
} from './provider';

interface NativePoint {
  x: number;
  y: number;
  z: number;
  confidence: 'high' | 'medium' | 'low';
}

interface NativeCaptureResult {
  cancelled: boolean;
  /** Points keyed by phase id. Phases the user skipped are absent. */
  phases: Record<string, NativePoint[]>;
  cameraPosition?: { x: number; y: number; z: number };
  /** Base64 JPEG without the data-url prefix. */
  photoBase64?: string;
  /** True when the device has a LiDAR scanner rather than plane-only tracking. */
  usedSceneDepth: boolean;
  /** Native-side warnings, e.g. tracking was limited. */
  warnings?: string[];
}

interface NativePhaseRequest {
  id: string;
  title: string;
  instruction: string;
  minPoints: number;
  maxPoints?: number;
  optional: boolean;
}

interface SiteCheckARPlugin {
  isSupported(): Promise<{ supported: boolean; hasLiDAR: boolean; reason?: string }>;
  startCapture(options: {
    title: string;
    phases: NativePhaseRequest[];
  }): Promise<NativeCaptureResult>;
}

const SiteCheckAR = registerPlugin<SiteCheckARPlugin>('SiteCheckAR');

export const ARKIT_PROVIDER_ID = 'arkit';

export class ArkitMeasurementProvider implements MeasurementProvider {
  id = ARKIT_PROVIDER_ID;
  displayName = 'ARKit depth measurement';
  accuracyNote =
    'Measured in 3D with the device depth sensor. Accurate to a fraction of an inch over short spans on a LiDAR-equipped device; accuracy falls off with distance and on dark, wet, or reflective surfaces.';

  private cached: ProviderAvailability | null = null;

  async isAvailable(): Promise<ProviderAvailability> {
    if (this.cached) return this.cached;

    try {
      const result = await SiteCheckAR.isSupported();
      this.cached = result.supported
        ? { available: true }
        : {
            available: false,
            reason: result.reason ?? 'ARKit is not supported on this device.',
          };

      if (result.supported && !result.hasLiDAR) {
        // Still usable, but the user deserves to know the accuracy is lower.
        this.accuracyNote =
          'Measured in 3D with ARKit plane tracking (no LiDAR scanner on this device). Expect roughly half an inch of error over short spans — verify anything close to tolerance with a tape.';
      }
    } catch {
      // The plugin is absent entirely, which is the normal case in a browser.
      this.cached = { available: false, reason: 'ARKit is only available in the iOS app.' };
    }

    return this.cached;
  }

  async capture(request: CaptureRequest): Promise<CaptureResult | null> {
    const native = await SiteCheckAR.startCapture({
      title: request.title,
      phases: request.phases.map((phase) => ({
        id: phase.id,
        title: phase.title,
        instruction: phase.instruction,
        minPoints: phase.minPoints,
        maxPoints: phase.maxPoints,
        optional: phase.optional ?? false,
      })),
    });

    if (native.cancelled) return null;

    const warnings = [...(native.warnings ?? [])];
    if (!native.usedSceneDepth) {
      warnings.push(
        'Captured without the LiDAR scanner — points were placed on estimated planes rather than measured depth.',
      );
    }

    const phases: Record<string, PhasePoints> = {};
    let total = 0;
    let lowConfidence = 0;

    for (const [phaseId, points] of Object.entries(native.phases ?? {})) {
      const measured = points.map(toMeasuredPoint);
      phases[phaseId] = { points: measured };
      total += measured.length;
      lowConfidence += measured.filter((p) => p.confidence === 'low').length;
    }

    if (lowConfidence > 0) {
      warnings.push(
        `${lowConfidence} of ${total} points were placed with low confidence. Re-take those marks before relying on the result.`,
      );
    }

    return {
      providerId: this.id,
      method: native.usedSceneDepth
        ? 'ARKit with LiDAR scene depth'
        : 'ARKit plane tracking (no LiDAR)',
      phases,
      // ARKit world space is gravity-aligned, so +Y is genuinely up.
      upDirection: vec(0, 1, 0),
      cameraPosition: native.cameraPosition
        ? vec(
            metresToInches(native.cameraPosition.x),
            metresToInches(native.cameraPosition.y),
            metresToInches(native.cameraPosition.z),
          )
        : undefined,
      photo: native.photoBase64 ? base64ToBlob(native.photoBase64, 'image/jpeg') : undefined,
      warnings,
    };
  }
}

function toMeasuredPoint(p: NativePoint): MeasuredPoint {
  return {
    position: vec(metresToInches(p.x), metresToInches(p.y), metresToInches(p.z)),
    confidence: p.confidence as Confidence,
  };
}

function base64ToBlob(base64: string, type: string): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
