/**
 * The Windows capture screen: measuring off a photograph.
 *
 * Registered once at app start as the host for `ReferenceLineProvider`. It is
 * intentionally full of warnings — this path exists so a photo emailed in from
 * the field is not a dead end, not because it is a substitute for the depth
 * sensor. See the header of `measurement/referenceLine.ts`.
 *
 * Walks the requested capture phases in order: set the scale once, then mark
 * each phase's points. Optional phases can be skipped, and a skipped phase is
 * reported by the check as unverified rather than quietly passing.
 */

import { useEffect, useRef, useState } from 'react';
import { parseLength } from '../domain/units';
import type { CapturePhase, CaptureRequest } from '../measurement/provider';
import {
  type PixelPoint,
  type ReferenceCaptureOutcome,
  calibrate,
  setReferenceCaptureHost,
} from '../measurement/referenceLine';
import { Banner, Field } from './components';

type Step = 'closed' | 'image' | 'calibrate' | 'mark';

interface Pending {
  request: CaptureRequest;
  resolve: (outcome: ReferenceCaptureOutcome | null) => void;
}

export function PhotoMeasureHost() {
  const [pending, setPending] = useState<Pending | null>(null);
  const [step, setStep] = useState<Step>('closed');
  const [image, setImage] = useState<{ blob: Blob; url: string; width: number; height: number } | null>(null);
  const [referencePoints, setReferencePoints] = useState<PixelPoint[]>([]);
  const [knownLength, setKnownLength] = useState('');
  const [phaseIndex, setPhaseIndex] = useState(0);
  const [collected, setCollected] = useState<Record<string, PixelPoint[]>>({});
  const [marks, setMarks] = useState<PixelPoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);

  useEffect(() => {
    setReferenceCaptureHost(
      (request) =>
        new Promise<ReferenceCaptureOutcome | null>((resolve) => {
          setPending({ request, resolve });
          setStep('image');
          setImage(null);
          setReferencePoints([]);
          setMarks([]);
          setCollected({});
          setPhaseIndex(0);
          setKnownLength('');
          setError(null);
        }),
    );
    return () => setReferenceCaptureHost(null);
  }, []);

  if (step === 'closed' || !pending) return null;

  const phases = pending.request.phases;
  const phase = phases[phaseIndex] as CapturePhase | undefined;

  function close(outcome: ReferenceCaptureOutcome | null) {
    if (image) URL.revokeObjectURL(image.url);
    pending?.resolve(outcome);
    setPending(null);
    setStep('closed');
    setImage(null);
  }

  async function onPickImage(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    const url = URL.createObjectURL(file);
    const size = await new Promise<{ width: number; height: number }>((resolve, reject) => {
      const probe = new Image();
      probe.onload = () => resolve({ width: probe.naturalWidth, height: probe.naturalHeight });
      probe.onerror = () => reject(new Error('That file could not be read as an image.'));
      probe.src = url;
    });

    setImage({ blob: file, url, ...size });
    setStep('calibrate');
  }

  /** Convert a click to natural image pixels, independent of display size. */
  function toImagePoint(event: React.MouseEvent<HTMLImageElement>): PixelPoint | null {
    const el = imgRef.current;
    if (!el || !image) return null;
    const rect = el.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * image.width,
      y: ((event.clientY - rect.top) / rect.height) * image.height,
    };
  }

  function onImageClick(event: React.MouseEvent<HTMLImageElement>) {
    const point = toImagePoint(event);
    if (!point) return;

    if (step === 'calibrate') {
      setReferencePoints(referencePoints.length >= 2 ? [point] : [...referencePoints, point]);
      return;
    }

    if (phase?.maxPoints !== undefined && marks.length >= phase.maxPoints) return;
    setMarks([...marks, point]);
  }

  function onConfirmCalibration() {
    setError(null);
    const inches = parseLength(knownLength);

    if (inches === null || inches <= 0) {
      setError(`Could not read "${knownLength}" as a length. Try 48", 4'-0", or 1200mm.`);
      return;
    }
    if (referencePoints.length !== 2) {
      setError('Click both ends of the reference first.');
      return;
    }
    setStep('mark');
  }

  function advance(points: PixelPoint[] | null) {
    if (!phase) return;

    const next = { ...collected };
    if (points) next[phase.id] = points;
    setCollected(next);
    setMarks([]);

    if (phaseIndex + 1 < phases.length) {
      setPhaseIndex(phaseIndex + 1);
      return;
    }
    finish(next);
  }

  function finish(points: Record<string, PixelPoint[]>) {
    setError(null);
    if (!image) return;

    const inches = parseLength(knownLength);
    if (inches === null) return;

    try {
      close({
        image: image.blob,
        imageWidth: image.width,
        imageHeight: image.height,
        calibration: calibrate(
          referencePoints[0] as PixelPoint,
          referencePoints[1] as PixelPoint,
          inches,
        ),
        pixelPoints: points,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const overlayPoints = step === 'calibrate' ? referencePoints : marks;
  const enough = phase ? marks.length >= phase.minPoints : false;
  const atMax = phase?.maxPoints !== undefined && marks.length >= phase.maxPoints;

  return (
    <div style={BACKDROP}>
      <div style={PANEL}>
        <div className="row between">
          <h3>
            {pending.request.title}
            {step === 'mark' && phase ? ` — ${phase.title}` : ' — from a photograph'}
          </h3>
          <button onClick={() => close(null)}>Cancel</button>
        </div>

        <Banner tone="warn">
          Measuring from a photo assumes the camera was square-on to the work and that everything
          you mark lies in the same plane as the reference. Treat the result as indicative and
          confirm anything close to tolerance with a tape.
        </Banner>

        {error && <Banner tone="bad">{error}</Banner>}

        {step === 'image' && (
          <label className="btn btn-block">
            Choose photograph
            <input type="file" accept="image/*" onChange={onPickImage} style={{ display: 'none' }} />
          </label>
        )}

        {image && (
          <div style={{ position: 'relative', maxHeight: '48vh', overflow: 'auto' }}>
            <img
              ref={imgRef}
              src={image.url}
              alt="Field photograph"
              onClick={onImageClick}
              style={{ width: '100%', display: 'block', cursor: 'crosshair' }}
            />
            <svg
              viewBox={`0 0 ${image.width} ${image.height}`}
              style={{ position: 'absolute', inset: 0, width: '100%', pointerEvents: 'none' }}
            >
              {referencePoints.length === 2 && (
                <line
                  x1={referencePoints[0]!.x}
                  y1={referencePoints[0]!.y}
                  x2={referencePoints[1]!.x}
                  y2={referencePoints[1]!.y}
                  stroke="#f5a623"
                  strokeWidth={image.width / 200}
                />
              )}
              {overlayPoints.map((p, i) => (
                <circle
                  key={i}
                  cx={p.x}
                  cy={p.y}
                  r={image.width / 150}
                  fill={step === 'calibrate' ? '#f5a623' : '#e5262c'}
                />
              ))}
            </svg>
          </div>
        )}

        {step === 'calibrate' && image && (
          <>
            <p className="muted">
              Click both ends of something in the photo whose length you know — a tape, a sheet
              edge, a door leaf. Longer is much better.
            </p>
            <Field label="That reference measures">
              <input
                value={knownLength}
                onChange={(e) => setKnownLength(e.target.value)}
                placeholder={`4'-0"`}
              />
            </Field>
            <button
              className="primary btn-block"
              disabled={referencePoints.length !== 2 || knownLength.trim() === ''}
              onClick={onConfirmCalibration}
            >
              Set scale and start marking
            </button>
          </>
        )}

        {step === 'mark' && phase && (
          <>
            <p className="muted">
              Step {phaseIndex + 1} of {phases.length}. {phase.instruction} {marks.length} marked
              {phase.maxPoints ? ` of ${phase.maxPoints}` : ''}.
              {!enough && ` Need at least ${phase.minPoints}.`}
            </p>
            <div className="row">
              <button className="grow" disabled={marks.length === 0} onClick={() => setMarks(marks.slice(0, -1))}>
                Undo last
              </button>
              {phase.optional && (
                <button className="grow" onClick={() => advance(null)}>
                  Skip this step
                </button>
              )}
              <button
                className="primary grow"
                disabled={!enough && !atMax}
                onClick={() => advance(marks)}
              >
                {phaseIndex + 1 < phases.length ? 'Next step' : 'Done'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const BACKDROP: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.55)',
  display: 'grid',
  placeItems: 'center',
  padding: 16,
  zIndex: 100,
};

const PANEL: React.CSSProperties = {
  background: 'var(--surface)',
  borderRadius: 'var(--radius)',
  padding: 16,
  width: 'min(760px, 100%)',
  maxHeight: '92vh',
  overflow: 'auto',
};
