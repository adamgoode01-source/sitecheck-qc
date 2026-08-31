/**
 * Persisted shapes.
 *
 * One rule governs this file: an inspection stores its INPUTS as well as its
 * results. If someone later discovers the tolerance profile was wrong, or the
 * dimension typed off the plan was misread, we can re-run the check against
 * the original measured points instead of sending a crew back to the floor.
 * Storing only the verdict would throw away the expensive part.
 */

import type { CheckResult } from '../domain/checks/types';
import type { FramingMemberType } from '../domain/checks/framingSpacing';
import type { Vec3 } from '../domain/geometry';
import type { ToleranceProfile } from '../domain/tolerance';
import type { Confidence } from '../measurement/provider';

export const SCHEMA_VERSION = 1;

export interface Project {
  id: string;
  name: string;
  number?: string;
  location: string;
  /** Id from TOLERANCE_PROFILES, or 'custom' when customProfile is set. */
  toleranceProfileId: string;
  /** Project-specific tolerances entered from the spec. Overrides the built-in profile. */
  customProfile?: ToleranceProfile;
  defaultInspector?: string;
  createdAt: string;
  updatedAt: string;
  /**
   * When this project was last exported to a package.
   *
   * Local storage can be evicted by the OS and phones get dropped, so the
   * only real protection for a day's work is a copy somewhere else. Comparing
   * this against inspection timestamps is what lets the UI say "you have
   * three inspections that exist nowhere but this handset".
   */
  lastExportedAt?: string;
}

export interface PlanScale {
  pageNumber: number;
  /**
   * Real-world inches per PDF user-space unit. Stored against PDF units, not
   * screen pixels, so the calibration survives zooming, a different monitor,
   * or being re-opened on the phone.
   */
  inchesPerPdfUnit: number;
  /** What the user measured against, kept so the calibration can be audited. */
  knownLengthIn: number;
  pdfUnitLength: number;
  calibratedAt: string;
}

export interface PlanSheet {
  id: string;
  projectId: string;
  name: string;
  sheetNumber?: string;
  fileName: string;
  blobId: string;
  pageCount: number;
  /** One calibration per page — sheets in a set are not all at the same scale. */
  scales: PlanScale[];
  createdAt: string;
}

export type CheckKind = 'framing' | 'rebar' | 'rough-in' | 'opening';

export interface PhaseGeometry {
  /** Inches, in the capture frame. */
  points: Vec3[];
  confidences: Confidence[];
}

/**
 * The measured input, kept verbatim so checks can be re-run.
 *
 * Points are keyed by capture phase — `primary` plus whatever else the check
 * asked for (`floor`, `datum`, `form-face`). Schema 1 stored a flat `points`
 * array with a bolted-on `formFacePoints`; `migrateGeometry` below converts
 * those records rather than stranding them.
 */
export interface CapturedGeometry {
  phases: Record<string, PhaseGeometry>;
  cameraPosition?: Vec3;
  /** Which way is up in this frame — needed to sort opening corners. */
  upDirection?: Vec3;
  providerId: string;
  method: string;
  warnings: string[];
  capturedAt: string;
}

/** Points for one phase, or an empty array when the phase was skipped. */
export const phasePoints = (geometry: CapturedGeometry, phaseId: string): Vec3[] =>
  geometry.phases?.[phaseId]?.points ?? [];

/** Schema 1 shape, kept only so stored records can be migrated. */
interface LegacyGeometry {
  points?: Vec3[];
  confidences?: Confidence[];
  formFacePoints?: Vec3[];
}

/**
 * Converts a schema-1 capture to the phase-keyed shape. Idempotent, so it is
 * safe to run over records that have already been migrated.
 */
export function migrateGeometry(geometry: CapturedGeometry & LegacyGeometry): CapturedGeometry {
  if (geometry.phases) return geometry;

  const phases: Record<string, PhaseGeometry> = {
    primary: {
      points: geometry.points ?? [],
      confidences: geometry.confidences ?? [],
    },
  };

  if (geometry.formFacePoints?.length) {
    phases['form-face'] = { points: geometry.formFacePoints, confidences: [] };
  }

  const { points: _p, confidences: _c, formFacePoints: _f, ...rest } = geometry;
  return { ...rest, phases };
}

export interface FramingCheckSpec {
  kind: 'framing';
  memberType: FramingMemberType;
  nominalOCIn: number;
  /** Where the expected value came from — typed, or measured off a plan sheet. */
  expectedSource: ExpectedSource;
}

export interface RebarCheckSpec {
  kind: 'rebar';
  barSize: string;
  nominalOCIn: number;
  specifiedCoverIn?: number;
  hitConvention: 'far-crown' | 'centreline' | 'near-face';
  expectedSource: ExpectedSource;
}

export interface RoughInCheckSpec {
  kind: 'rough-in';
  fixtureType: 'receptacle' | 'switch' | 'data' | 'plumbing' | 'hvac' | 'other';
  specifiedHeightIn: number;
  /** Floor build-up still to come over the captured surface, inches. */
  floorBuildUpIn: number;
  specifiedOffsetIn?: number;
  /** What the tapped point represents, e.g. "centre of box". */
  measuredTo?: string;
  expectedSource: ExpectedSource;
}

export interface OpeningCheckSpec {
  kind: 'opening';
  openingKind: 'door' | 'window' | 'other';
  /** e.g. "Door 204". */
  reference?: string;
  specifiedWidthIn: number;
  specifiedHeightIn: number;
  specifiedOffsetIn?: number;
  expectedSource: ExpectedSource;
}

export type CheckSpec =
  | FramingCheckSpec
  | RebarCheckSpec
  | RoughInCheckSpec
  | OpeningCheckSpec;

export interface ExpectedSource {
  kind: 'typed' | 'plan-measured' | 'plan-note';
  /** e.g. "S-201, wall type W3 schedule" — printed on the report. */
  reference?: string;
  planSheetId?: string;
}

export interface StoredCheck {
  id: string;
  spec: CheckSpec;
  geometry: CapturedGeometry;
  /** Cached result. Always reproducible from spec + geometry + profile. */
  result: CheckResult;
}

export type InspectionStatus = 'draft' | 'complete';

export interface Inspection {
  id: string;
  projectId: string;
  title: string;
  area?: string;
  planSheetId?: string;
  planReference?: string;
  inspector: string;
  status: InspectionStatus;
  notes?: string;
  checks: StoredCheck[];
  photoIds: string[];
  createdAt: string;
  updatedAt: string;
  /** Device the capture came from, so a reviewer knows the provenance. */
  capturedOn?: string;
}

/* ------------------------------------------------------------------ *
 * Calibration
 * ------------------------------------------------------------------ */

/**
 * Conditions a trial was taken under. Kept as loose string unions rather than
 * free text so trials can actually be grouped and compared afterwards — the
 * whole point of the factor sweep is answering "does distance matter?", which
 * needs consistent labels.
 */
export interface TrialConditions {
  distance: '2ft' | '4ft' | '8ft' | '12ft';
  angle: 'square' | 'oblique';
  light: 'good' | 'dim' | 'sun';
  surface: 'matte' | 'dark' | 'glossy';
  note?: string;
}

export const DEFAULT_TRIAL_CONDITIONS: TrialConditions = {
  distance: '4ft',
  angle: 'square',
  light: 'good',
  surface: 'matte',
};

export interface CalibrationTrial {
  id: string;
  /** Measured span, inches. */
  measuredIn: number;
  /** measured - true, inches. Signed: positive reads long. */
  deviationIn: number;
  conditions: TrialConditions;
  /** True when any point came back low confidence, or tracking was limited. */
  lowConfidence: boolean;
  warnings: string[];
  method: string;
  capturedAt: string;
}

export interface CalibrationSession {
  id: string;
  name: string;
  /** The tape-measured truth every trial is compared against, inches. */
  trueValueIn: number;
  /** Tolerance the tool is being judged fit for, plus-or-minus inches. */
  toleranceIn: number;
  trials: CalibrationTrial[];
  createdAt: string;
  updatedAt: string;
}

export type BlobKind = 'photo' | 'plan';

export interface StoredBlob {
  id: string;
  kind: BlobKind;
  mime: string;
  data: Blob;
  createdAt: string;
  /** Free-text caption for photos. */
  caption?: string;
}

export interface AppSetting {
  key: string;
  value: unknown;
}

/**
 * How many inspections have changed since the last export — work that exists
 * nowhere but this device.
 *
 * Compares `updatedAt`, not `createdAt`, so editing an already-exported
 * inspection puts it back at risk: the package on the other machine no longer
 * matches the handset. Timestamps are ISO-8601 UTC, which sorts correctly as
 * plain strings, so no date parsing is involved.
 *
 * Erring toward over-reporting is deliberate. Telling someone to export again
 * when they need not costs them a few seconds; failing to tell them costs a
 * day of inspections.
 */
export function countUnexported(
  inspections: ReadonlyArray<Pick<Inspection, 'updatedAt'>>,
  lastExportedAt?: string,
): number {
  if (!lastExportedAt) return inspections.length;
  return inspections.filter((i) => i.updatedAt > lastExportedAt).length;
}

/** RFC4122-ish id. `crypto.randomUUID` is present in both targets. */
export function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export const nowIso = (): string => new Date().toISOString();
