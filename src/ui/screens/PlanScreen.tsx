import { useEffect, useRef, useState } from 'react';
import { formatFeetInches, parseLength } from '../../domain/units';
import { describeSheetSize, loadPlan, pageSize, renderPage } from '../../plans/pdf';
import {
  CALIBRATION_MATCH_TOLERANCE_PERCENT,
  type CanvasPoint,
  NAMED_SCALES,
  calibrateFromCanvas,
  inchesPerPdfUnitFromNamedScale,
  measureOnCanvas,
  nearestNamedScale,
} from '../../plans/planScale';
import { getBlob, getPlanSheet, savePlanScale, scaleForPage } from '../../storage/db';
import { nowIso } from '../../storage/models';
import { Banner, Empty, Field, TopBar, useAsync } from '../components';

type Mode = 'calibrate' | 'measure';

export function PlanScreen({ projectId, sheetId }: { projectId: string; sheetId: string }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [page, setPage] = useState(1);
  const [renderScale, setRenderScale] = useState(1);
  const [mode, setMode] = useState<Mode>('calibrate');
  const [marks, setMarks] = useState<CanvasPoint[]>([]);
  const [knownLength, setKnownLength] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [measured, setMeasured] = useState<number | null>(null);
  const [sheetLabel, setSheetLabel] = useState('');

  const { data, reload, loading } = useAsync(async () => {
    const sheet = await getPlanSheet(sheetId);
    if (!sheet) return null;
    const blob = await getBlob(sheet.blobId);
    if (!blob) throw new Error('The PDF for this sheet is missing from local storage.');
    return { sheet, plan: await loadPlan(blob.data) };
  }, [sheetId]);

  const sheet = data?.sheet;
  const activeScale = sheet ? scaleForPage(sheet, page) : undefined;

  // Render the page whenever the page number changes or the stage resizes.
  useEffect(() => {
    if (!data) return;
    let cancelled = false;

    (async () => {
      const stage = stageRef.current;
      if (!stage) return;

      const targetWidth = Math.max(stage.clientWidth, 320) * (window.devicePixelRatio || 1);
      const rendered = await renderPage(data.plan.document, page, targetWidth);
      if (cancelled) return;

      // CSS width keeps the canvas laid out at logical size while the bitmap
      // stays at device resolution, so drawings stay legible when zoomed.
      rendered.canvas.style.width = '100%';
      rendered.canvas.style.height = 'auto';

      stage.querySelector('canvas')?.remove();
      stage.prepend(rendered.canvas);
      setRenderScale(rendered.renderScale);

      const size = await pageSize(data.plan.document, page);
      setSheetLabel(describeSheetSize(size.widthIn, size.heightIn));
    })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
    };
  }, [data, page]);

  // Order matters: `data` is null both while loading and when the sheet is
  // genuinely gone, so the loading check has to come first.
  if (loading) return <Empty>Loading plan&hellip;</Empty>;
  if (!sheet) return <Empty>That plan sheet no longer exists.</Empty>;

  /**
   * Clicks arrive in CSS pixels but the canvas bitmap is at device
   * resolution. Scale up, or every measurement is out by the pixel ratio.
   */
  function onStageClick(event: React.MouseEvent<HTMLDivElement>) {
    const canvas = stageRef.current?.querySelector('canvas');
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const point: CanvasPoint = {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };

    const next = marks.length >= 2 ? [point] : [...marks, point];
    setMarks(next);
    setMeasured(null);

    if (next.length === 2 && mode === 'measure' && activeScale) {
      setMeasured(
        measureOnCanvas(next[0] as CanvasPoint, next[1] as CanvasPoint, activeScale.inchesPerPdfUnit, renderScale),
      );
    }
  }

  async function onSaveCalibration() {
    setError(null);
    const inches = parseLength(knownLength);
    if (inches === null || inches <= 0) {
      setError(`Could not read "${knownLength}" as a dimension. Try 12'-6", 16 1/2", or 4200mm.`);
      return;
    }
    if (marks.length !== 2) {
      setError('Click the two ends of a printed dimension on the sheet first.');
      return;
    }

    try {
      const result = calibrateFromCanvas(
        marks[0] as CanvasPoint,
        marks[1] as CanvasPoint,
        inches,
        renderScale,
      );
      await savePlanScale(sheetId, {
        pageNumber: page,
        inchesPerPdfUnit: result.inchesPerPdfUnit,
        knownLengthIn: inches,
        pdfUnitLength: result.pdfUnitLength,
        calibratedAt: nowIso(),
      });
      setMarks([]);
      setKnownLength('');
      setMode('measure');
      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onUseNamedScale(scaleId: string) {
    const named = NAMED_SCALES.find((s) => s.id === scaleId);
    if (!named) return;

    await savePlanScale(sheetId, {
      pageNumber: page,
      inchesPerPdfUnit: inchesPerPdfUnitFromNamedScale(named),
      knownLengthIn: 0,
      pdfUnitLength: 0,
      calibratedAt: nowIso(),
    });
    setMode('measure');
    reload();
  }

  const match = activeScale ? nearestNamedScale(activeScale.inchesPerPdfUnit) : null;

  return (
    <>
      <TopBar title={sheet.name} back={{ name: 'project', projectId }} />
      <main className="main">
        {error && <Banner tone="bad">{error}</Banner>}

        <div className="row between">
          <div className="row">
            <button disabled={page <= 1} onClick={() => { setPage(page - 1); setMarks([]); }}>
              &larr;
            </button>
            <span className="muted">
              Page {page} of {sheet.pageCount}
            </span>
            <button
              disabled={page >= sheet.pageCount}
              onClick={() => { setPage(page + 1); setMarks([]); }}
            >
              &rarr;
            </button>
          </div>
          <span className="muted">{sheetLabel}</span>
        </div>

        <div className="plan-stage" ref={stageRef} onClick={onStageClick}>
          <svg className="plan-overlay" width="100%" height="100%">
            {marks.length === 2 && (
              <line
                x1={`${((marks[0] as CanvasPoint).x / (stageRef.current?.querySelector('canvas')?.width ?? 1)) * 100}%`}
                y1={`${((marks[0] as CanvasPoint).y / (stageRef.current?.querySelector('canvas')?.height ?? 1)) * 100}%`}
                x2={`${((marks[1] as CanvasPoint).x / (stageRef.current?.querySelector('canvas')?.width ?? 1)) * 100}%`}
                y2={`${((marks[1] as CanvasPoint).y / (stageRef.current?.querySelector('canvas')?.height ?? 1)) * 100}%`}
                stroke="#e5262c"
                strokeWidth={2}
              />
            )}
          </svg>
        </div>

        <div className="row" style={{ marginTop: 12 }}>
          <button
            className={mode === 'calibrate' ? 'primary grow' : 'grow'}
            onClick={() => { setMode('calibrate'); setMarks([]); }}
          >
            Set scale
          </button>
          <button
            className={mode === 'measure' ? 'primary grow' : 'grow'}
            disabled={!activeScale}
            onClick={() => { setMode('measure'); setMarks([]); }}
          >
            Measure
          </button>
        </div>

        {mode === 'calibrate' && (
          <div className="card">
            <h3>Calibrate this page</h3>
            <p className="muted">
              Click the two ends of a dimension that is printed on the sheet, then type what it
              says. This is right even if the PDF has been resized or scanned.
            </p>
            <Field label="That dimension reads">
              <input
                value={knownLength}
                onChange={(e) => setKnownLength(e.target.value)}
                placeholder={`12'-6"`}
                inputMode="text"
              />
            </Field>
            <button className="primary btn-block" disabled={marks.length !== 2} onClick={onSaveCalibration}>
              {marks.length === 2 ? 'Save scale' : 'Click both ends of a dimension'}
            </button>
            <hr style={{ margin: '16px 0', border: 0, borderTop: '1px solid var(--line)' }} />
            <Field
              label="Or trust the sheet's printed scale"
              hint="Only correct if this PDF is at true plotted size. A drawing that was fit-to-page on the way to you will be wrong, and will look completely normal."
            >
              <select defaultValue="" onChange={(e) => e.target.value && onUseNamedScale(e.target.value)}>
                <option value="">Choose a scale…</option>
                {NAMED_SCALES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
            </Field>
          </div>
        )}

        {mode === 'measure' && activeScale && (
          <div className="card">
            <h3>Measure on the drawing</h3>
            <p className="muted">
              Click two points to read the dimension between them. Use this to pull the expected
              value for a check straight off the plans.
            </p>
            {measured !== null && (
              <div style={{ fontSize: 30, fontWeight: 700 }} className="mono">
                {formatFeetInches(measured)}
              </div>
            )}
            {match && match.errorPercent > CALIBRATION_MATCH_TOLERANCE_PERCENT && (
              <Banner tone="warn">
                This calibration is {match.errorPercent.toFixed(0)}% away from the nearest standard
                scale ({match.scale.label}), so the sheet has probably been resized somewhere along
                the way. Your calibration is still valid — this is just a heads-up that reading it
                with a scale rule would not be.
              </Banner>
            )}
          </div>
        )}
      </main>
    </>
  );
}
