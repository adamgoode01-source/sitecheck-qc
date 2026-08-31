import { useState } from 'react';
import { TOLERANCE_PROFILES } from '../../domain/tolerance';
import { loadPlan } from '../../plans/pdf';
import {
  addPlanSheet,
  createInspection,
  effectiveProfile,
  getProject,
  listInspections,
  listPlanSheets,
  markProjectExported,
  unexportedWork,
  updateProject,
} from '../../storage/db';
import { currentPlatform } from '../../measurement';
import { describeSaveOutcome, saveFile } from '../../platform/files';
import { exportProject, packageFileName } from '../../storage/transfer';
import { Banner, Empty, Field, StatusPill, TopBar, useAsync } from '../components';
import { hrefFor, navigate } from '../router';

export function ProjectScreen({ projectId }: { projectId: string }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data, reload, loading } = useAsync(
    async () => ({
      project: await getProject(projectId),
      sheets: await listPlanSheets(projectId),
      inspections: await listInspections(projectId),
      atRisk: await unexportedWork(projectId),
    }),
    [projectId],
  );

  if (loading) return <Empty>Loading&hellip;</Empty>;
  if (!data?.project) return <Empty>That project no longer exists.</Empty>;

  const { project, sheets, inspections, atRisk } = data;
  const profile = effectiveProfile(project);

  async function onAddPlan(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setBusy('Reading plan sheet…');
    setError(null);
    try {
      // Open it before storing so a corrupt or password-protected PDF fails
      // here, with a clear message, rather than later inside the plan viewer.
      const { pageCount } = await loadPlan(file);
      await addPlanSheet(projectId, file, pageCount);
      reload();
    } catch (e) {
      setError(
        `Could not open that PDF: ${e instanceof Error ? e.message : String(e)}. Password-protected drawings must be unlocked first.`,
      );
    } finally {
      setBusy(null);
    }
  }

  async function onNewInspection() {
    const inspection = await createInspection(projectId, {
      title: `Inspection ${new Date().toLocaleDateString()}`,
      inspector: project.defaultInspector ?? '',
    });
    navigate({ name: 'inspection', projectId, inspectionId: inspection.id });
  }

  async function onExport() {
    setBusy('Building package…');
    setError(null);
    setNotice(null);
    try {
      const blob = await exportProject(projectId, currentPlatform());
      const outcome = await saveFile(blob, packageFileName(project), {
        title: `${project.name} — QC package`,
        dialogTitle: 'Send project package',
      });

      // Only record the export if the file actually went somewhere. Marking
      // it on a dismissed share sheet would clear the "unexported work"
      // warning while the work is still only on this device.
      if (outcome.status !== 'cancelled') {
        await markProjectExported(projectId);
        setNotice(describeSaveOutcome(outcome));
        reload();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <>
      <TopBar title={project.name} back={{ name: 'projects' }} />
      <main className="main">
        {error && <Banner tone="bad">{error}</Banner>}
        {busy && <Banner tone="info">{busy}</Banner>}
        {notice && <Banner tone="info">{notice}</Banner>}

        {atRisk.count > 0 && (
          <Banner tone="warn">
            {atRisk.count === 1
              ? '1 inspection exists only on this device.'
              : `${atRisk.count} inspections exist only on this device.`}{' '}
            {atRisk.lastExportedAt
              ? `Last export was ${new Date(atRisk.lastExportedAt).toLocaleString()}.`
              : 'Nothing from this project has been exported yet.'}{' '}
            Export the project package so a lost or wiped device does not take the work with it.
          </Banner>
        )}

        <div className="card">
          <div className="muted">{project.location}</div>
          <Field
            label="Tolerance profile"
            hint={profile.sourceNote}
          >
            <select
              value={project.toleranceProfileId}
              onChange={async (e) => {
                await updateProject(projectId, { toleranceProfileId: e.target.value });
                reload();
              }}
            >
              {TOLERANCE_PROFILES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Default inspector">
            <input
              defaultValue={project.defaultInspector ?? ''}
              placeholder="Name printed on reports"
              onBlur={(e) => updateProject(projectId, { defaultInspector: e.target.value })}
            />
          </Field>
        </div>

        <h2>Plan sheets</h2>
        {sheets.length === 0 && (
          <Empty>
            No drawings yet. Add the sheet you are checking against, then calibrate its scale so
            expected dimensions can be measured off it.
          </Empty>
        )}
        {sheets.map((sheet) => (
          <a
            key={sheet.id}
            className="card tappable"
            href={hrefFor({ name: 'plan', projectId, sheetId: sheet.id })}
          >
            <div className="row between">
              <h3>{sheet.name}</h3>
              <span className={`pill ${sheet.scales.length > 0 ? 'pass' : 'invalid'}`}>
                {sheet.scales.length > 0
                  ? `${sheet.scales.length} of ${sheet.pageCount} pages calibrated`
                  : 'Not calibrated'}
              </span>
            </div>
            <div className="muted">
              {sheet.fileName} &middot; {sheet.pageCount} page{sheet.pageCount === 1 ? '' : 's'}
            </div>
          </a>
        ))}
        <label className="btn btn-block">
          Add plan sheet (PDF)
          <input type="file" accept="application/pdf" onChange={onAddPlan} style={{ display: 'none' }} />
        </label>

        <h2>Inspections</h2>
        {inspections.length === 0 && <Empty>No inspections recorded for this project yet.</Empty>}
        {inspections.map((inspection) => (
          <a
            key={inspection.id}
            className="card tappable"
            href={hrefFor({ name: 'inspection', projectId, inspectionId: inspection.id })}
          >
            <div className="row between">
              <h3>{inspection.title}</h3>
              <StatusPill status={inspection.status} />
            </div>
            <div className="muted">
              {inspection.area ? `${inspection.area} · ` : ''}
              {inspection.checks.length} check{inspection.checks.length === 1 ? '' : 's'} &middot;{' '}
              {new Date(inspection.createdAt).toLocaleDateString()}
            </div>
          </a>
        ))}
        <button className="primary btn-block" onClick={onNewInspection}>
          New inspection
        </button>

        <h2>Transfer</h2>
        <div className="card">
          <p className="muted">
            Everything stays on this device. Export a package to move this project — drawings,
            photographs, measurements and all — to another machine by AirDrop, email, or cable.
          </p>
          <button className="btn-block" onClick={onExport}>
            Export project package
          </button>
        </div>
      </main>
    </>
  );
}
