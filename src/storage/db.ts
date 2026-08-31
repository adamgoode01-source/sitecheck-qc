/**
 * Local database. IndexedDB via Dexie, on both platforms.
 *
 * There is no server and no sync endpoint by design — the offline decision
 * means drawings and site photographs never leave the device except through
 * an export the user explicitly performs. Everything here is local, which
 * also means a basement with no signal behaves exactly like the office.
 */

import Dexie, { type Table } from 'dexie';
import { getProfile } from '../domain/tolerance';
import type { ToleranceProfile } from '../domain/tolerance';
import {
  type AppSetting,
  type BlobKind,
  type CalibrationSession,
  type CalibrationTrial,
  type Inspection,
  type PlanSheet,
  type Project,
  type StoredBlob,
  type StoredCheck,
  countUnexported,
  migrateGeometry,
  newId,
  nowIso,
} from './models';

class SiteCheckDatabase extends Dexie {
  projects!: Table<Project, string>;
  planSheets!: Table<PlanSheet, string>;
  inspections!: Table<Inspection, string>;
  blobs!: Table<StoredBlob, string>;
  settings!: Table<AppSetting, string>;
  calibrations!: Table<CalibrationSession, string>;

  constructor() {
    super('sitecheck-qc');

    this.version(1).stores({
      projects: 'id, name, updatedAt',
      planSheets: 'id, projectId',
      inspections: 'id, projectId, status, updatedAt',
      blobs: 'id, kind',
      settings: 'key',
    });

    // v2: captures moved from a flat `points` array plus a bolted-on
    // `formFacePoints` to phase-keyed geometry, so checks needing a floor
    // reference or a datum could exist at all. Old inspections are converted
    // in place rather than left unreadable — a QC record has to stay
    // openable, and someone may need it years after this schema changed.
    this.version(2)
      .stores({})
      .upgrade(async (transaction) =>
        transaction
          .table<Inspection>('inspections')
          .toCollection()
          .modify((inspection) => {
            inspection.checks = inspection.checks.map((check) => ({
              ...check,
              geometry: migrateGeometry(check.geometry),
            }));
          }),
      );

    // v3: calibration sessions. Deliberately not scoped to a project — this
    // measures the tool, not a job, and the answer follows the device.
    this.version(3).stores({ calibrations: 'id, updatedAt' });
  }
}

export const db = new SiteCheckDatabase();

/* ------------------------------------------------------------------ *
 * Projects
 * ------------------------------------------------------------------ */

export async function listProjects(): Promise<Project[]> {
  const all = await db.projects.toArray();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getProject = (id: string): Promise<Project | undefined> => db.projects.get(id);

export async function createProject(
  input: Pick<Project, 'name' | 'location'> & Partial<Project>,
): Promise<Project> {
  const project: Project = {
    id: newId(),
    toleranceProfileId: 'standard',
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
  };
  await db.projects.put(project);
  return project;
}

export async function updateProject(id: string, patch: Partial<Project>): Promise<void> {
  await db.projects.update(id, { ...patch, updatedAt: nowIso() });
}

/**
 * Inspections changed since the project was last exported — i.e. work that
 * exists nowhere but this device.
 *
 * Counts by `updatedAt` rather than `createdAt` so that editing a previously
 * exported inspection puts it back in the at-risk list; the exported package
 * no longer reflects what is on the handset.
 */
export async function unexportedWork(
  projectId: string,
): Promise<{ count: number; lastExportedAt?: string }> {
  const project = await db.projects.get(projectId);
  if (!project) return { count: 0 };

  const inspections = await db.inspections.where('projectId').equals(projectId).toArray();

  return {
    count: countUnexported(inspections, project.lastExportedAt),
    lastExportedAt: project.lastExportedAt,
  };
}

export async function markProjectExported(projectId: string): Promise<void> {
  // Not `updateProject` — that bumps `updatedAt`, and an export is not a
  // change to the project.
  await db.projects.update(projectId, { lastExportedAt: nowIso() });
}

/** Resolves the tolerance profile actually in force for a project. */
export function effectiveProfile(project: Project): ToleranceProfile {
  return project.customProfile ?? getProfile(project.toleranceProfileId);
}

/**
 * Deleting a project takes its plans, inspections and blobs with it. Done in
 * one transaction so a failure part-way cannot leave orphaned photographs
 * consuming storage with nothing pointing at them.
 */
export async function deleteProject(id: string): Promise<void> {
  await db.transaction('rw', db.projects, db.planSheets, db.inspections, db.blobs, async () => {
    const sheets = await db.planSheets.where('projectId').equals(id).toArray();
    const inspections = await db.inspections.where('projectId').equals(id).toArray();

    const blobIds = [
      ...sheets.map((s) => s.blobId),
      ...inspections.flatMap((i) => i.photoIds),
    ];

    await db.blobs.bulkDelete(blobIds);
    await db.planSheets.bulkDelete(sheets.map((s) => s.id));
    await db.inspections.bulkDelete(inspections.map((i) => i.id));
    await db.projects.delete(id);
  });
}

/* ------------------------------------------------------------------ *
 * Plan sheets
 * ------------------------------------------------------------------ */

export const listPlanSheets = (projectId: string): Promise<PlanSheet[]> =>
  db.planSheets.where('projectId').equals(projectId).toArray();

export const getPlanSheet = (id: string): Promise<PlanSheet | undefined> => db.planSheets.get(id);

export async function addPlanSheet(
  projectId: string,
  file: File,
  pageCount: number,
  sheetNumber?: string,
): Promise<PlanSheet> {
  const blobId = await putBlob(file, 'plan', file.type || 'application/pdf');

  const sheet: PlanSheet = {
    id: newId(),
    projectId,
    name: file.name.replace(/\.pdf$/i, ''),
    sheetNumber,
    fileName: file.name,
    blobId,
    pageCount,
    scales: [],
    createdAt: nowIso(),
  };

  await db.planSheets.put(sheet);
  return sheet;
}

export async function savePlanScale(
  sheetId: string,
  scale: PlanSheet['scales'][number],
): Promise<void> {
  const sheet = await db.planSheets.get(sheetId);
  if (!sheet) throw new Error('Plan sheet not found');

  // One calibration per page: a re-calibration replaces the old one rather
  // than accumulating, so there is never ambiguity about which is in force.
  const scales = sheet.scales.filter((s) => s.pageNumber !== scale.pageNumber);
  scales.push(scale);

  await db.planSheets.update(sheetId, { scales });
}

export const scaleForPage = (sheet: PlanSheet, pageNumber: number) =>
  sheet.scales.find((s) => s.pageNumber === pageNumber);

/* ------------------------------------------------------------------ *
 * Inspections
 * ------------------------------------------------------------------ */

export const listInspections = async (projectId: string): Promise<Inspection[]> => {
  const all = await db.inspections.where('projectId').equals(projectId).toArray();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

export const getInspection = (id: string): Promise<Inspection | undefined> =>
  db.inspections.get(id);

export async function createInspection(
  projectId: string,
  input: Partial<Inspection> & Pick<Inspection, 'title' | 'inspector'>,
): Promise<Inspection> {
  const inspection: Inspection = {
    id: newId(),
    projectId,
    status: 'draft',
    checks: [],
    photoIds: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
  };
  await db.inspections.put(inspection);
  return inspection;
}

export async function updateInspection(id: string, patch: Partial<Inspection>): Promise<void> {
  await db.inspections.update(id, { ...patch, updatedAt: nowIso() });
}

export async function addCheck(inspectionId: string, check: StoredCheck): Promise<void> {
  const inspection = await db.inspections.get(inspectionId);
  if (!inspection) throw new Error('Inspection not found');
  await db.inspections.update(inspectionId, {
    checks: [...inspection.checks, check],
    updatedAt: nowIso(),
  });
}

export async function replaceChecks(inspectionId: string, checks: StoredCheck[]): Promise<void> {
  await db.inspections.update(inspectionId, { checks, updatedAt: nowIso() });
}

export async function deleteInspection(id: string): Promise<void> {
  await db.transaction('rw', db.inspections, db.blobs, async () => {
    const inspection = await db.inspections.get(id);
    if (!inspection) return;
    await db.blobs.bulkDelete(inspection.photoIds);
    await db.inspections.delete(id);
  });
}

/* ------------------------------------------------------------------ *
 * Blobs
 * ------------------------------------------------------------------ */

export async function putBlob(
  data: Blob,
  kind: BlobKind,
  mime?: string,
  caption?: string,
): Promise<string> {
  const record: StoredBlob = {
    id: newId(),
    kind,
    mime: mime ?? data.type ?? 'application/octet-stream',
    data,
    createdAt: nowIso(),
    caption,
  };
  await db.blobs.put(record);
  return record.id;
}

export const getBlob = (id: string): Promise<StoredBlob | undefined> => db.blobs.get(id);

export async function getBlobUrl(id: string): Promise<string | null> {
  const record = await db.blobs.get(id);
  return record ? URL.createObjectURL(record.data) : null;
}

/** Base64 data URL, used when inlining photographs into a report. */
export async function getBlobDataUrl(id: string): Promise<string | null> {
  const record = await db.blobs.get(id);
  if (!record) return null;

  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(record.data);
  });
}

/* ------------------------------------------------------------------ *
 * Calibration
 * ------------------------------------------------------------------ */

export async function listCalibrations(): Promise<CalibrationSession[]> {
  const all = await db.calibrations.toArray();
  return all.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export const getCalibration = (id: string): Promise<CalibrationSession | undefined> =>
  db.calibrations.get(id);

export async function createCalibration(
  input: Pick<CalibrationSession, 'name' | 'trueValueIn' | 'toleranceIn'>,
): Promise<CalibrationSession> {
  const session: CalibrationSession = {
    id: newId(),
    trials: [],
    createdAt: nowIso(),
    updatedAt: nowIso(),
    ...input,
  };
  await db.calibrations.put(session);
  return session;
}

export async function addTrial(sessionId: string, trial: CalibrationTrial): Promise<void> {
  const session = await db.calibrations.get(sessionId);
  if (!session) throw new Error('Calibration session not found');
  await db.calibrations.update(sessionId, {
    trials: [...session.trials, trial],
    updatedAt: nowIso(),
  });
}

export async function deleteTrial(sessionId: string, trialId: string): Promise<void> {
  const session = await db.calibrations.get(sessionId);
  if (!session) return;
  await db.calibrations.update(sessionId, {
    trials: session.trials.filter((t) => t.id !== trialId),
    updatedAt: nowIso(),
  });
}

export const deleteCalibration = (id: string): Promise<void> => db.calibrations.delete(id);

/* ------------------------------------------------------------------ *
 * Settings
 * ------------------------------------------------------------------ */

export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const row = await db.settings.get(key);
  return row === undefined ? fallback : (row.value as T);
}

export async function setSetting(key: string, value: unknown): Promise<void> {
  await db.settings.put({ key, value });
}
