import { useState } from 'react';
import { runCheck } from '../../domain/checks';
import {
  effectiveProfile,
  getInspection,
  getProject,
  listPlanSheets,
  putBlob,
  replaceChecks,
  updateInspection,
} from '../../storage/db';
import { Banner, CheckCard, Empty, Field, StatusPill, TopBar, useAsync } from '../components';
import { hrefFor, navigate } from '../router';
import type { CaptureKind } from './CaptureScreen';

const CHECK_TYPES: ReadonlyArray<{ kind: CaptureKind; label: string }> = [
  { kind: 'framing', label: 'Framing spacing' },
  { kind: 'rebar', label: 'Rebar' },
  { kind: 'rough-in', label: 'Rough-in' },
  { kind: 'opening', label: 'Opening' },
];

export function InspectionScreen({
  projectId,
  inspectionId,
}: {
  projectId: string;
  inspectionId: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);

  const { data, reload, loading } = useAsync(
    async () => ({
      project: await getProject(projectId),
      inspection: await getInspection(inspectionId),
      sheets: await listPlanSheets(projectId),
    }),
    [projectId, inspectionId],
  );

  if (loading) return <Empty>Loading&hellip;</Empty>;
  if (!data?.inspection || !data.project) return <Empty>That inspection no longer exists.</Empty>;

  const { project, inspection, sheets } = data;
  const profile = effectiveProfile(project);
  const ready = inspection.checks.length > 0 && inspection.inspector.trim() !== '';

  /**
   * Re-evaluates every stored check against the project's current tolerance
   * profile. Cheap, and it means a corrected tolerance propagates to old work
   * instead of leaving a file full of results computed against numbers nobody
   * can reconstruct.
   */
  async function onRecheck() {
    const updated = inspection.checks.map((check) => ({
      ...check,
      result: runCheck(check.spec, check.geometry, profile),
    }));
    await replaceChecks(inspectionId, updated);
    setNotice(`Re-evaluated ${updated.length} checks against "${profile.name}".`);
    reload();
  }

  async function onAddPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const blobId = await putBlob(file, 'photo', file.type);
    await updateInspection(inspectionId, { photoIds: [...inspection.photoIds, blobId] });
    reload();
  }

  return (
    <>
      <TopBar
        title={inspection.title}
        back={{ name: 'project', projectId }}
        actions={<StatusPill status={inspection.status} />}
      />
      <main className="main">
        {notice && <Banner tone="info">{notice}</Banner>}

        <div className="card">
          <Field label="Title">
            <input
              defaultValue={inspection.title}
              onBlur={(e) => updateInspection(inspectionId, { title: e.target.value })}
            />
          </Field>
          <Field label="Area" hint="Where on the job this covers, e.g. Level 2, grid C/4 to C/7.">
            <input
              defaultValue={inspection.area ?? ''}
              onBlur={(e) => updateInspection(inspectionId, { area: e.target.value })}
            />
          </Field>
          <Field label="Inspector">
            <input
              defaultValue={inspection.inspector}
              placeholder="Required before a report can be issued"
              onBlur={(e) => updateInspection(inspectionId, { inspector: e.target.value })}
            />
          </Field>
          <Field label="Plan sheet checked against">
            <select
              defaultValue={inspection.planSheetId ?? ''}
              onChange={(e) =>
                updateInspection(inspectionId, { planSheetId: e.target.value || undefined })
              }
            >
              <option value="">Not recorded</option>
              {sheets.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Plan reference" hint="e.g. S-201, wall type W3 schedule.">
            <input
              defaultValue={inspection.planReference ?? ''}
              onBlur={(e) => updateInspection(inspectionId, { planReference: e.target.value })}
            />
          </Field>
        </div>

        <h2>Checks</h2>
        {inspection.checks.length === 0 && (
          <Empty>Nothing measured yet. Start a check below.</Empty>
        )}
        {inspection.checks.map((check) => (
          <CheckCard key={check.id} check={check.result}>
            {check.geometry.warnings.length > 0 && (
              <Banner tone="warn">{check.geometry.warnings.join(' ')}</Banner>
            )}
            <div className="muted" style={{ marginBottom: 8 }}>
              {check.geometry.method} &middot;{' '}
              {new Date(check.geometry.capturedAt).toLocaleString()}
            </div>
          </CheckCard>
        ))}

        <div className="grid-actions">
          {CHECK_TYPES.map((type) => (
            <a
              key={type.kind}
              className="btn primary"
              href={hrefFor({ name: 'capture', projectId, inspectionId, kind: type.kind })}
            >
              {type.label}
            </a>
          ))}
        </div>

        {inspection.checks.length > 0 && (
          <button className="btn-block" style={{ marginTop: 10 }} onClick={onRecheck}>
            Re-evaluate against &ldquo;{profile.name}&rdquo;
          </button>
        )}

        <h2>Photographs</h2>
        <p className="muted">
          {inspection.photoIds.length} attached. Capture photos are added automatically; add
          context shots here.
        </p>
        <label className="btn btn-block">
          Add photograph
          <input
            type="file"
            accept="image/*"
            capture="environment"
            onChange={onAddPhoto}
            style={{ display: 'none' }}
          />
        </label>

        <h2>Field notes</h2>
        <div className="card">
          <textarea
            defaultValue={inspection.notes ?? ''}
            placeholder="Anything the measurements do not capture — access, conditions, who was told."
            onBlur={(e) => updateInspection(inspectionId, { notes: e.target.value })}
          />
        </div>

        <h2>Report</h2>
        {!ready && (
          <Banner tone="warn">
            {inspection.checks.length === 0
              ? 'Record at least one check before issuing a report.'
              : 'Enter the inspector name before issuing a report — a QC record without one is not much use later.'}
          </Banner>
        )}
        <button
          className="primary btn-block"
          disabled={!ready}
          onClick={() => navigate({ name: 'report', projectId, inspectionId })}
        >
          Build report
        </button>
      </main>
    </>
  );
}
