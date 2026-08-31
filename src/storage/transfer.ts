/**
 * Offline transfer between devices — the substitute for a cloud sync.
 *
 * A `.qcpkg` file is a plain zip: a JSON manifest plus every photograph and
 * plan PDF the project references. The field crew exports from the iPhone and
 * sends it by AirDrop, email, or a USB cable; the office imports it on
 * Windows to review and issue reports.
 *
 * Ids are preserved rather than regenerated, so re-importing a newer package
 * updates the existing records in place instead of creating a second copy of
 * the same project. That makes "export at the end of every day" a safe habit
 * rather than a way to accumulate duplicates.
 */

import { unzipSync, zipSync } from 'fflate';
import type { Inspection, PlanSheet, Project, StoredBlob } from './models';
import { SCHEMA_VERSION, nowIso } from './models';
import { db } from './db';

export const PACKAGE_EXTENSION = '.qcpkg';

interface BlobManifestEntry {
  id: string;
  kind: StoredBlob['kind'];
  mime: string;
  createdAt: string;
  caption?: string;
  /** Path inside the zip. */
  path: string;
}

interface PackageManifest {
  format: 'sitecheck-qc-package';
  schemaVersion: number;
  exportedAt: string;
  exportedFrom: string;
  project: Project;
  planSheets: PlanSheet[];
  inspections: Inspection[];
  blobs: BlobManifestEntry[];
}

export interface ImportSummary {
  projectId: string;
  projectName: string;
  planSheets: number;
  inspections: number;
  blobs: number;
  /** True when a project with this id was already present and got updated. */
  replacedExisting: boolean;
  warnings: string[];
}

/* ------------------------------------------------------------------ *
 * Export
 * ------------------------------------------------------------------ */

export async function exportProject(projectId: string, exportedFrom: string): Promise<Blob> {
  const project = await db.projects.get(projectId);
  if (!project) throw new Error('Project not found');

  const planSheets = await db.planSheets.where('projectId').equals(projectId).toArray();
  const inspections = await db.inspections.where('projectId').equals(projectId).toArray();

  const blobIds = new Set<string>([
    ...planSheets.map((s) => s.blobId),
    ...inspections.flatMap((i) => i.photoIds),
  ]);

  const files: Record<string, Uint8Array> = {};
  const blobEntries: BlobManifestEntry[] = [];

  for (const id of blobIds) {
    const record = await db.blobs.get(id);
    if (!record) continue; // A missing blob is not worth failing the whole export over.

    const path = `blobs/${id}${extensionFor(record.mime)}`;
    files[path] = new Uint8Array(await record.data.arrayBuffer());
    blobEntries.push({
      id: record.id,
      kind: record.kind,
      mime: record.mime,
      createdAt: record.createdAt,
      caption: record.caption,
      path,
    });
  }

  const manifest: PackageManifest = {
    format: 'sitecheck-qc-package',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: nowIso(),
    exportedFrom,
    project,
    planSheets,
    inspections,
    blobs: blobEntries,
  };

  files['manifest.json'] = new TextEncoder().encode(JSON.stringify(manifest, null, 2));

  // Level 0 for the blobs (JPEG and PDF are already compressed), default for JSON.
  const zipped = zipSync(files, { level: 6 });
  return new Blob([zipped], { type: 'application/zip' });
}

export function packageFileName(project: Project): string {
  const safe = project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  const stamp = new Date().toISOString().slice(0, 10);
  return `${safe || 'project'}-${stamp}${PACKAGE_EXTENSION}`;
}

/* ------------------------------------------------------------------ *
 * Import
 * ------------------------------------------------------------------ */

export async function importPackage(file: Blob): Promise<ImportSummary> {
  const bytes = new Uint8Array(await file.arrayBuffer());

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('That file is not a readable QC package.');
  }

  const manifestBytes = entries['manifest.json'];
  if (!manifestBytes) throw new Error('The package is missing its manifest.');

  const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as PackageManifest;

  if (manifest.format !== 'sitecheck-qc-package') {
    throw new Error('That file is not a QC package.');
  }

  const warnings: string[] = [];
  if (manifest.schemaVersion > SCHEMA_VERSION) {
    // Forward-compatible rather than fatal: the field device may be on a newer
    // build than the office machine, and refusing outright would strand the data.
    warnings.push(
      `The package was written by a newer version of the app (format ${manifest.schemaVersion}, this build reads ${SCHEMA_VERSION}). Anything it added that this version does not understand has been left out.`,
    );
  }

  const existing = await db.projects.get(manifest.project.id);

  await db.transaction('rw', db.projects, db.planSheets, db.inspections, db.blobs, async () => {
    for (const entry of manifest.blobs) {
      const data = entries[entry.path];
      if (!data) {
        warnings.push(`A referenced file was missing from the package: ${entry.path}`);
        continue;
      }
      const record: StoredBlob = {
        id: entry.id,
        kind: entry.kind,
        mime: entry.mime,
        createdAt: entry.createdAt,
        caption: entry.caption,
        // Copy into a fresh buffer — the unzip output shares one backing store.
        data: new Blob([data.slice()], { type: entry.mime }),
      };
      await db.blobs.put(record);
    }

    await db.projects.put(manifest.project);
    await db.planSheets.bulkPut(manifest.planSheets);
    await db.inspections.bulkPut(manifest.inspections);
  });

  return {
    projectId: manifest.project.id,
    projectName: manifest.project.name,
    planSheets: manifest.planSheets.length,
    inspections: manifest.inspections.length,
    blobs: manifest.blobs.length,
    replacedExisting: existing !== undefined,
    warnings,
  };
}

function extensionFor(mime: string): string {
  if (mime.includes('pdf')) return '.pdf';
  if (mime.includes('png')) return '.png';
  if (mime.includes('heic')) return '.heic';
  if (mime.includes('jpeg') || mime.includes('jpg')) return '.jpg';
  return '.bin';
}
