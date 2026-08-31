import { useMemo, useState } from 'react';
import { type ReportInput, renderReportHtml, summariseReport } from '../../domain/report';
import { describeSaveOutcome, saveFile } from '../../platform/files';
import {
  effectiveProfile,
  getBlobDataUrl,
  getInspection,
  getPlanSheet,
  getProject,
  updateInspection,
} from '../../storage/db';
import { Banner, Empty, TopBar, useAsync } from '../components';
import { navigate } from '../router';

export function ReportScreen({
  projectId,
  inspectionId,
}: {
  projectId: string;
  inspectionId: string;
}) {
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { data, loading } = useAsync(async () => {
    const project = await getProject(projectId);
    const inspection = await getInspection(inspectionId);
    if (!project || !inspection) return null;

    const sheet = inspection.planSheetId ? await getPlanSheet(inspection.planSheetId) : undefined;

    // Photos are inlined as base64 so the saved file is genuinely standalone.
    const photos = (
      await Promise.all(inspection.photoIds.map((id) => getBlobDataUrl(id)))
    ).filter((url): url is string => url !== null);

    const methods = Array.from(new Set(inspection.checks.map((c) => c.geometry.method)));

    const input: ReportInput = {
      projectName: project.name,
      projectNumber: project.number,
      location: project.location,
      area: inspection.area,
      planSheet: sheet?.name,
      planReference: inspection.planReference,
      inspector: inspection.inspector,
      capturedAt: new Date(inspection.createdAt),
      measurementMethod: methods.join('; ') || 'not recorded',
      toleranceProfile: effectiveProfile(project),
      checks: inspection.checks.map((c) => c.result),
      photos: photos.map((dataUrl) => ({ dataUrl })),
      notes: inspection.notes,
    };

    return { input, html: renderReportHtml(input), inspection };
  }, [projectId, inspectionId]);

  const summary = useMemo(
    () => (data ? summariseReport(data.input.checks) : null),
    [data],
  );

  if (loading) return <Empty>Building report&hellip;</Empty>;
  if (!data) return <Empty>That inspection no longer exists.</Empty>;

  function onPrint() {
    // A detached iframe rather than window.open: popup blockers and the
    // Electron/Capacitor shells all treat window.open inconsistently.
    const frame = document.createElement('iframe');
    frame.style.position = 'fixed';
    frame.style.right = '100%';
    frame.style.width = '1px';
    frame.style.height = '1px';
    document.body.appendChild(frame);

    const doc = frame.contentDocument;
    if (!doc) return;

    doc.open();
    doc.write(data!.html);
    doc.close();

    frame.onload = () => {
      frame.contentWindow?.focus();
      frame.contentWindow?.print();
      setTimeout(() => frame.remove(), 1000);
    };
  }

  async function onSaveHtml() {
    setError(null);
    try {
      const blob = new Blob([data!.html], { type: 'text/html' });
      const outcome = await saveFile(
        blob,
        `qc-report-${new Date().toISOString().slice(0, 10)}.html`,
        { title: 'QC report', dialogTitle: 'Send report' },
      );
      setNotice(describeSaveOutcome(outcome));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onMarkComplete() {
    await updateInspection(inspectionId, { status: 'complete' });
    navigate({ name: 'inspection', projectId, inspectionId });
  }

  return (
    <>
      <TopBar title="Report" back={{ name: 'inspection', projectId, inspectionId }} />
      <main className="main">
        {error && <Banner tone="bad">{error}</Banner>}
        {notice && <Banner tone="info">{notice}</Banner>}

        {summary?.invalid ? (
          <Banner tone="warn">
            {summary.invalid} {summary.invalid === 1 ? 'check' : 'checks'} could not be measured
            reliably. Those items are reported as unverified rather than as passing — re-capture
            them before this goes out if they matter.
          </Banner>
        ) : null}

        <div className="row" style={{ marginBottom: 12 }}>
          <button className="primary grow" onClick={onPrint}>
            Print / Save as PDF
          </button>
          <button className="grow" onClick={onSaveHtml}>
            Save HTML
          </button>
        </div>

        <iframe
          title="Report preview"
          srcDoc={data.html}
          style={{
            width: '100%',
            height: '70vh',
            border: '1px solid var(--line)',
            borderRadius: 'var(--radius)',
            background: '#fff',
          }}
        />

        <button className="btn-block" style={{ marginTop: 12 }} onClick={onMarkComplete}>
          Mark inspection complete
        </button>
      </main>
    </>
  );
}
