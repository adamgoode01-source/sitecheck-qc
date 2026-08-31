/**
 * Calibration mode — running the tape study on the device.
 *
 * The protocol in CALIBRATION.md is otherwise a paper exercise carried out
 * one-handed while holding a phone and a tape. This does the arithmetic as
 * you go, so the go/no-go answer is visible after the twentieth trial rather
 * than after an evening in a spreadsheet.
 *
 * Deliberately not scoped to a project: this measures the tool, not a job.
 */

import { useState } from 'react';
import {
  assessAgainstTolerance,
  assessConfidenceSignal,
  MIN_TRUSTWORTHY_SAMPLE,
  summariseTrials,
} from '../../domain/calibration';
import { calibrationCsvFileName, calibrationToCsv } from '../../domain/calibrationCsv';
import { distance } from '../../domain/geometry';
import { formatDeviation, formatInches, parseLength } from '../../domain/units';
import { resolveProvider } from '../../measurement';
import { PHASE, type CaptureRequest } from '../../measurement/provider';
import { describeSaveOutcome, saveFile } from '../../platform/files';
import {
  addTrial,
  createCalibration,
  deleteCalibration,
  deleteTrial,
  getCalibration,
  listCalibrations,
} from '../../storage/db';
import {
  DEFAULT_TRIAL_CONDITIONS,
  type TrialConditions,
  newId,
  nowIso,
} from '../../storage/models';
import { Banner, Empty, Field, TopBar, useAsync } from '../components';
import { hrefFor, navigate } from '../router';

const CAPTURE_REQUEST: CaptureRequest = {
  title: 'Calibration trial',
  phases: [
    {
      id: PHASE.PRIMARY,
      title: 'Mark both ends',
      instruction: 'Tap the two marks whose true distance you measured with the tape.',
      minPoints: 2,
      maxPoints: 2,
    },
  ],
};

/* ------------------------------------------------------------------ *
 * Session list
 * ------------------------------------------------------------------ */

export function CalibrationListScreen() {
  const { data, loading } = useAsync(() => listCalibrations(), []);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [trueText, setTrueText] = useState('16');
  const [tolText, setTolText] = useState('1/4');
  const [error, setError] = useState<string | null>(null);

  async function onCreate(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    const trueValueIn = parseLength(trueText);
    const toleranceIn = parseLength(tolText);

    if (trueValueIn === null || trueValueIn <= 0) {
      setError(`Could not read "${trueText}" as a length. Try 16, 16 1/16", or 4'-0".`);
      return;
    }
    if (toleranceIn === null || toleranceIn <= 0) {
      setError(`Could not read "${tolText}" as a tolerance. Try 1/4.`);
      return;
    }

    const session = await createCalibration({
      name: name.trim() || 'Baseline',
      trueValueIn,
      toleranceIn,
    });
    navigate({ name: 'calibration-session', sessionId: session.id });
  }

  return (
    <>
      <TopBar title="Calibration" back={{ name: 'settings' }} />
      <main className="main">
        <Banner tone="info">
          Measures the tool, not a job. Lay out two marks a known distance apart, then repeat the
          same capture many times — bias and spread only mean something with roughly{' '}
          {MIN_TRUSTWORTHY_SAMPLE} trials behind them.
        </Banner>

        {error && <Banner tone="bad">{error}</Banner>}

        {adding ? (
          <form className="card" onSubmit={onCreate}>
            <Field label="Session name" hint="e.g. Baseline 4ft, or Sun 8ft.">
              <input value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Baseline" />
            </Field>
            <Field label="True distance between the marks" hint="What the tape says. Burn an inch and subtract.">
              <input value={trueText} onChange={(e) => setTrueText(e.target.value)} />
            </Field>
            <Field
              label="Tolerance being judged against"
              hint="Plus-or-minus. The tool is scored on how much of that band its own error eats."
            >
              <input value={tolText} onChange={(e) => setTolText(e.target.value)} />
            </Field>
            <div className="row">
              <button type="submit" className="primary grow">
                Start session
              </button>
              <button type="button" onClick={() => setAdding(false)}>
                Cancel
              </button>
            </div>
          </form>
        ) : (
          <button className="primary btn-block" onClick={() => setAdding(true)}>
            New calibration session
          </button>
        )}

        <h2>Sessions</h2>
        {loading && <Empty>Loading&hellip;</Empty>}
        {!loading && data?.length === 0 && (
          <Empty>No sessions yet. Start with a baseline block at a fixed distance.</Empty>
        )}

        {data?.map((session) => {
          const stats = summariseTrials(session.trials.map((t) => t.deviationIn));
          return (
            <a
              key={session.id}
              className="card tappable"
              href={hrefFor({ name: 'calibration-session', sessionId: session.id })}
            >
              <div className="row between">
                <h3>{session.name}</h3>
                <span className={`pill ${stats?.sufficientSample ? 'pass' : 'invalid'}`}>
                  {session.trials.length} trials
                </span>
              </div>
              <div className="muted">
                {formatInches(session.trueValueIn)} true, &plusmn;{formatInches(session.toleranceIn, 32)}{' '}
                tolerance
                {stats ? ` · bias ${formatDeviation(stats.meanIn, 32)}` : ''}
              </div>
            </a>
          );
        })}
      </main>
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Session detail
 * ------------------------------------------------------------------ */

export function CalibrationSessionScreen({ sessionId }: { sessionId: string }) {
  const [conditions, setConditions] = useState<TrialConditions>(DEFAULT_TRIAL_CONDITIONS);
  const [capturing, setCapturing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: session, reload, loading } = useAsync(() => getCalibration(sessionId), [sessionId]);

  if (loading) return <Empty>Loading&hellip;</Empty>;
  if (!session) return <Empty>That session no longer exists.</Empty>;

  const deviations = session.trials.map((t) => t.deviationIn);
  const stats = summariseTrials(deviations);
  const assessment = stats ? assessAgainstTolerance(stats, session.toleranceIn) : null;
  const confidence = assessConfidenceSignal(session.trials);

  async function onCapture() {
    setError(null);
    setNotice(null);
    setCapturing(true);

    try {
      const provider = await resolveProvider();
      if (!provider) {
        setError('No measurement method is available on this device.');
        return;
      }

      const capture = await provider.capture(CAPTURE_REQUEST);
      if (!capture) return;

      const points = capture.phases[PHASE.PRIMARY]?.points ?? [];
      if (points.length !== 2) {
        setError('That capture did not return two points. Mark both ends of the span.');
        return;
      }

      const measuredIn = distance(points[0]!.position, points[1]!.position);

      await addTrial(sessionId, {
        id: newId(),
        measuredIn,
        deviationIn: measuredIn - session!.trueValueIn,
        conditions,
        // Anything the capture was unhappy about counts as low confidence —
        // the whole point is testing whether that flag predicts error.
        lowConfidence:
          points.some((p) => p.confidence === 'low') || capture.warnings.length > 0,
        warnings: capture.warnings,
        method: capture.method,
        capturedAt: nowIso(),
      });

      reload();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  async function onExport() {
    try {
      const csv = calibrationToCsv(session!);
      const outcome = await saveFile(
        new Blob([csv], { type: 'text/csv' }),
        calibrationCsvFileName(session!),
        { title: 'Calibration data', dialogTitle: 'Send calibration data' },
      );
      setNotice(describeSaveOutcome(outcome));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function onDeleteSession() {
    await deleteCalibration(sessionId);
    navigate({ name: 'calibration' });
  }

  return (
    <>
      <TopBar title={session.name} back={{ name: 'calibration' }} />
      <main className="main">
        {error && <Banner tone="bad">{error}</Banner>}
        {notice && <Banner tone="info">{notice}</Banner>}

        <div className="card">
          <div className="row between">
            <h3>
              {stats ? formatDeviation(stats.meanIn, 32) : '—'} bias
            </h3>
            <span className={`pill ${stats?.sufficientSample ? 'pass' : 'invalid'}`}>
              {session.trials.length} of {MIN_TRUSTWORTHY_SAMPLE}
            </span>
          </div>

          {!stats && <p className="muted">No trials yet.</p>}

          {stats && (
            <>
              <table className="metrics">
                <tbody>
                  <tr>
                    <th>True distance</th>
                    <td>{formatInches(session.trueValueIn)}</td>
                  </tr>
                  <tr>
                    <th>Mean deviation (bias)</th>
                    <td>{formatDeviation(stats.meanIn, 32)}</td>
                  </tr>
                  <tr>
                    <th>Standard deviation</th>
                    <td>{formatInches(stats.sdIn, 32)}</td>
                  </tr>
                  <tr>
                    <th>95% of readings fall within</th>
                    <td>
                      {formatDeviation(stats.ci95LowIn, 32)} to {formatDeviation(stats.ci95HighIn, 32)}
                    </td>
                  </tr>
                  <tr>
                    <th>Worst single trial</th>
                    <td>{formatDeviation(stats.worstIn, 32)}</td>
                  </tr>
                  <tr>
                    <th>Share of the &plusmn;{formatInches(session.toleranceIn, 32)} band</th>
                    <td className={assessment && assessment.ratio < 0.3 ? 'good' : 'bad'}>
                      {assessment ? `${Math.round(assessment.percentOfBand)}%` : '—'}
                    </td>
                  </tr>
                </tbody>
              </table>

              {!stats.sufficientSample && (
                <Banner tone="warn">
                  Only {stats.n} trials. The spread is not stable enough to conclude anything below
                  about {MIN_TRUSTWORTHY_SAMPLE} — keep going before reading the verdict.
                </Banner>
              )}

              {assessment && (
                <Banner
                  tone={
                    assessment.verdict === 'excellent' || assessment.verdict === 'usable'
                      ? 'info'
                      : assessment.verdict === 'marginal'
                        ? 'warn'
                        : 'bad'
                  }
                >
                  <strong>{assessment.headline}</strong>
                  <br />
                  {assessment.detail}
                </Banner>
              )}

              <p className="muted">{confidence.summary}</p>
            </>
          )}
        </div>

        <h2>Conditions for the next trial</h2>
        <div className="card">
          <Field label="Distance">
            <select
              value={conditions.distance}
              onChange={(e) =>
                setConditions({ ...conditions, distance: e.target.value as TrialConditions['distance'] })
              }
            >
              <option value="2ft">2 ft</option>
              <option value="4ft">4 ft</option>
              <option value="8ft">8 ft</option>
              <option value="12ft">12 ft</option>
            </select>
          </Field>
          <Field label="Angle">
            <select
              value={conditions.angle}
              onChange={(e) =>
                setConditions({ ...conditions, angle: e.target.value as TrialConditions['angle'] })
              }
            >
              <option value="square">Square on</option>
              <option value="oblique">Oblique (~30°)</option>
            </select>
          </Field>
          <Field label="Light">
            <select
              value={conditions.light}
              onChange={(e) =>
                setConditions({ ...conditions, light: e.target.value as TrialConditions['light'] })
              }
            >
              <option value="good">Good</option>
              <option value="dim">Dim</option>
              <option value="sun">Direct sun</option>
            </select>
          </Field>
          <Field label="Surface">
            <select
              value={conditions.surface}
              onChange={(e) =>
                setConditions({ ...conditions, surface: e.target.value as TrialConditions['surface'] })
              }
            >
              <option value="matte">Matte timber</option>
              <option value="dark">Dark</option>
              <option value="glossy">Glossy or wet</option>
            </select>
          </Field>
          <Field label="Note" hint="Optional.">
            <input
              value={conditions.note ?? ''}
              onChange={(e) => setConditions({ ...conditions, note: e.target.value })}
            />
          </Field>
        </div>

        <button className="primary btn-block" disabled={capturing} onClick={onCapture}>
          {capturing ? 'Capturing…' : 'Capture trial'}
        </button>
        <p className="hint">
          Back out and re-enter the capture between trials. Twenty taps inside one AR session
          measures one session&rsquo;s drift twenty times, not twenty independent readings.
        </p>

        <h2>Trials</h2>
        {session.trials.length === 0 && <Empty>Nothing recorded yet.</Empty>}
        {[...session.trials].reverse().map((trial, i) => {
          const number = session.trials.length - i;
          return (
            <div key={trial.id} className="card">
              <div className="row between">
                <h3>
                  #{number} &nbsp;{formatDeviation(trial.deviationIn, 32)}
                </h3>
                {trial.lowConfidence && <span className="pill invalid">low confidence</span>}
              </div>
              <div className="muted">
                {formatInches(trial.measuredIn, 32)} measured &middot; {trial.conditions.distance},{' '}
                {trial.conditions.angle}, {trial.conditions.light}, {trial.conditions.surface}
                {trial.conditions.note ? ` · ${trial.conditions.note}` : ''}
              </div>
              <button
                className="danger"
                style={{ marginTop: 8 }}
                onClick={async () => {
                  await deleteTrial(sessionId, trial.id);
                  reload();
                }}
              >
                Discard trial
              </button>
            </div>
          );
        })}

        <h2>Export</h2>
        <div className="card">
          <p className="muted">
            Raw trials as CSV, for plotting and for keeping as the evidence behind whatever
            accuracy this app ends up claiming.
          </p>
          <button className="btn-block" disabled={session.trials.length === 0} onClick={onExport}>
            Export CSV
          </button>
          <button className="danger btn-block" style={{ marginTop: 10 }} onClick={onDeleteSession}>
            Delete this session
          </button>
        </div>
      </main>
    </>
  );
}
