/** Shared presentational pieces. No data access, no domain logic. */

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { CheckResult, Finding, MetricLine } from '../domain/checks/types';
import type { SpacingAnalysis } from '../domain/spacing';
import { formatDeviation, formatInches } from '../domain/units';
import { type DisplayMode, getDisplayMode, toggleDisplayMode } from './display';
import { type Route, hrefFor } from './router';

export function TopBar({
  title,
  back,
  actions,
}: {
  title: string;
  back?: Route;
  actions?: ReactNode;
}) {
  return (
    <header className="topbar">
      {back && (
        <a className="btn" href={hrefFor(back)} aria-label="Back">
          &larr;
        </a>
      )}
      <h1>{title}</h1>
      {actions}
      <SunToggle />
    </header>
  );
}

/**
 * Sunlight mode switch, on every screen rather than buried in settings.
 *
 * Someone stepping from a dark mechanical room onto a sunlit deck needs this
 * in one tap, without navigating away from a half-finished capture.
 */
export function SunToggle() {
  const [mode, setMode] = useState<DisplayMode>(() => getDisplayMode());
  const active = mode === 'sun';

  return (
    <button
      className="sun-toggle"
      onClick={() => setMode(toggleDisplayMode())}
      aria-pressed={active}
      title={active ? 'Sunlight mode on — tap for normal display' : 'Hard to see? Tap for sunlight mode'}
      aria-label={active ? 'Turn off sunlight mode' : 'Turn on sunlight mode'}
    >
      {active ? '☀' : '☼'}
    </button>
  );
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
      {hint && <div className="hint">{hint}</div>}
    </label>
  );
}

export function Banner({ tone, children }: { tone: 'warn' | 'bad' | 'info'; children: ReactNode }) {
  return <div className={`banner ${tone}`}>{children}</div>;
}

export function StatusPill({ status }: { status: CheckResult['status'] | 'draft' | 'complete' }) {
  const label =
    status === 'pass'
      ? 'Pass'
      : status === 'fail'
        ? 'Deficiency'
        : status === 'invalid'
          ? 'Could not measure'
          : status === 'draft'
            ? 'Draft'
            : 'Complete';

  const cls = status === 'complete' ? 'pass' : status;
  return <span className={`pill ${cls}`}>{label}</span>;
}

export function MetricTable({ metrics }: { metrics: readonly MetricLine[] }) {
  if (metrics.length === 0) return null;
  return (
    <table className="metrics">
      <tbody>
        {metrics.map((m) => (
          <tr key={m.label}>
            <th>{m.label}</th>
            <td className={m.emphasis ?? ''}>{m.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function FindingList({ findings }: { findings: readonly Finding[] }) {
  return (
    <ul className="findings">
      {findings.map((f, i) => (
        <li key={`${f.code}-${i}`} className={`finding ${f.severity}`}>
          <strong>{f.title}</strong>
          <p>{f.detail}</p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Most bays that can carry a printed dimension before the labels collide on a
 * phone-width strip. Four labels across ~343px leaves ~85px each, which fits
 * `16 1/2"`; more than that and they overlap.
 */
const MAX_DENSE_LABELS = 4;

/**
 * A to-scale strip of the measured run. Worth the space: a superintendent
 * reads "the third bay is wide" off this instantly, where the same fact
 * buried in a table of numbers gets skimmed past.
 */
export function RunDiagram({ analysis }: { analysis: SpacingAnalysis }) {
  const total = analysis.summary.overallRunIn;
  if (!(total > 0)) return null;

  const pct = (inches: number) => `${(inches / total) * 92 + 4}%`;

  /*
   * Which bays get a dimension printed on them.
   *
   * Labels are absolutely positioned and cannot wrap, so on a phone a long
   * run turns every one of them into an overlapping smear — a 12-bay wall
   * gives each label about 28px of room and they need ~90px. Failing bays are
   * the ones worth naming anyway; the passing range is already in the metrics
   * table right below. Past a handful of failures even those are dropped and
   * the red markers carry it, with the findings list giving the detail.
   */
  const failing = analysis.spacings.filter((b) => b.status === 'fail');
  const labelled =
    failing.length === 0
      ? analysis.spacings.length <= MAX_DENSE_LABELS
        ? analysis.spacings
        : []
      : failing.length <= MAX_DENSE_LABELS
        ? failing
        : [];

  return (
    <div className="run" aria-label="Measured run">
      {analysis.positionsIn.map((p, i) => {
        const bayBefore = analysis.spacings[i - 1];
        const bayAfter = analysis.spacings[i];
        const bad = bayBefore?.status === 'fail' || bayAfter?.status === 'fail';
        return (
          <div
            key={i}
            className={`member ${bad ? 'bad' : ''}`}
            style={{ left: pct(p) }}
            title={`Member ${i + 1} at ${formatInches(p)}`}
          />
        );
      })}
      {labelled.map((bay) => {
        const from = analysis.positionsIn[bay.fromIndex] ?? 0;
        const to = analysis.positionsIn[bay.toIndex] ?? 0;
        return (
          <div
            key={`${bay.fromIndex}-${bay.toIndex}`}
            className={`bay-label ${bay.status === 'fail' ? 'bad' : ''}`}
            style={{ left: pct((from + to) / 2) }}
          >
            {formatInches(bay.actualIn)}
            {bay.status === 'fail' ? ` (${formatDeviation(bay.deviationIn)})` : ''}
          </div>
        );
      })}
    </div>
  );
}

export function CheckCard({ check, children }: { check: CheckResult; children?: ReactNode }) {
  return (
    <div className="card">
      <div className="row between">
        <h3>{check.checkName}</h3>
        <StatusPill status={check.status} />
      </div>
      {children}
      <MetricTable metrics={check.metrics} />
      <div style={{ height: 10 }} />
      <FindingList findings={check.findings} />
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

/**
 * Minimal async-data hook. Returns a `reload` so screens can refresh after a
 * write without a state-management library.
 */
export function useAsync<T>(
  loader: () => Promise<T>,
  deps: readonly unknown[],
): { data: T | null; error: string | null; loading: boolean; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    loader()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  return { data, error, loading, reload };
}
