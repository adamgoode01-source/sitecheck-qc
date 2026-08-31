/**
 * Report generation — entirely offline, no network, no template engine.
 *
 * Produces a single self-contained HTML document. On Windows it is printed to
 * PDF through Electron; on iOS through the share sheet. Because the output is
 * one file with inlined styles and base64 photos, it survives being emailed
 * to a subcontractor who will open it on something unknown.
 *
 * A QC record is a document someone may have to defend months later, so the
 * report states what was measured, what it was compared against, what
 * tolerance was applied, and where those tolerance numbers came from. A bare
 * pass/fail with no provenance is not worth issuing.
 */

import { type CheckResult, type Finding, type Severity, occurrencesOf } from './checks/types';
import type { ToleranceProfile } from './tolerance';
import { formatInches } from './units';

export interface ReportPhoto {
  /** `data:image/jpeg;base64,...` — inlined so the file stands alone. */
  dataUrl: string;
  caption?: string;
}

export interface ReportInput {
  projectName: string;
  projectNumber?: string;
  location: string;
  /** e.g. "Level 2 — Grid C/4 to C/7". Free text from the field. */
  area?: string;
  planSheet?: string;
  planReference?: string;
  inspector: string;
  capturedAt: Date;
  measurementMethod: string;
  toleranceProfile: ToleranceProfile;
  checks: readonly CheckResult[];
  photos?: readonly ReportPhoto[];
  notes?: string;
}

export interface ReportSummary {
  deficiencies: number;
  observations: number;
  invalid: number;
  passed: number;
  overall: 'pass' | 'fail' | 'invalid';
}

export function summariseReport(checks: readonly CheckResult[]): ReportSummary {
  const all = checks.flatMap((c) => c.findings);

  // Counts underlying failures, not findings. Consolidating five short-cover
  // bars into one readable line must not make the front page say
  // "1 deficiency" — that would be a formatting change rewriting the result.
  const count = (s: Severity) =>
    all.filter((f) => f.severity === s).reduce((sum, f) => sum + occurrencesOf(f), 0);

  const invalid = count('invalid');
  const deficiencies = count('deficiency');

  return {
    deficiencies,
    observations: count('observation'),
    invalid,
    passed: count('pass'),
    overall: invalid > 0 ? 'invalid' : deficiencies > 0 ? 'fail' : 'pass',
  };
}

export function renderReportHtml(input: ReportInput): string {
  const summary = summariseReport(input.checks);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(input.projectName)} — QC report ${esc(formatDate(input.capturedAt))}</title>
<style>${STYLES}</style>
</head>
<body>
<header class="head">
  <div>
    <h1>Field quality control report</h1>
    <p class="sub">${esc(input.projectName)}${input.projectNumber ? ` &middot; ${esc(input.projectNumber)}` : ''}</p>
  </div>
  <div class="verdict ${summary.overall}">${verdictLabel(summary.overall)}</div>
</header>

<section class="meta">
  ${metaRow('Location', input.location)}
  ${input.area ? metaRow('Area', input.area) : ''}
  ${input.planSheet ? metaRow('Plan sheet', input.planSheet) : ''}
  ${input.planReference ? metaRow('Plan reference', input.planReference) : ''}
  ${metaRow('Inspector', input.inspector)}
  ${metaRow('Captured', formatDateTime(input.capturedAt))}
  ${metaRow('Measurement method', input.measurementMethod)}
  ${metaRow('Tolerance profile', input.toleranceProfile.name)}
</section>

<section class="tally">
  ${tally('Deficiencies', summary.deficiencies, summary.deficiencies > 0 ? 'bad' : 'good')}
  ${tally('Observations', summary.observations, summary.observations > 0 ? 'warn' : 'good')}
  ${tally('Could not measure', summary.invalid, summary.invalid > 0 ? 'warn' : 'good')}
  ${tally('Checks run', input.checks.length, 'neutral')}
</section>

${input.checks.map(renderCheck).join('\n')}

${input.notes ? `<section class="block"><h2>Field notes</h2><p class="notes">${esc(input.notes)}</p></section>` : ''}

${renderPhotos(input.photos)}

<section class="block provenance">
  <h2>Basis of this report</h2>
  <p>
    Measurements were taken using ${esc(input.measurementMethod)}. Results were
    compared against dimensions entered from the contract drawings
    ${input.planSheet ? `(sheet ${esc(input.planSheet)})` : ''} and assessed against the
    &ldquo;${esc(input.toleranceProfile.name)}&rdquo; tolerance profile:
  </p>
  <ul>
    <li>Framing bay spacing: &plusmn;${tol(input.toleranceProfile.framing.spacingToleranceIn)}</li>
    <li>Framing cumulative layout drift: &plusmn;${tol(input.toleranceProfile.framing.cumulativeToleranceIn)}</li>
    <li>Bar spacing: &plusmn;${tol(input.toleranceProfile.rebar.spacingToleranceIn)}</li>
    <li>Clear cover, allowed reduction: ${tol(input.toleranceProfile.rebar.coverUnderToleranceIn)}</li>
  </ul>
  <p class="warn-note"><strong>Tolerance source:</strong> ${esc(input.toleranceProfile.sourceNote)}</p>
  <p class="warn-note">
    This report records measurements taken in the field with a consumer depth
    sensor. It is a quality control aid, not a survey, and it does not
    constitute engineering certification or an approval to proceed. Anything
    marked <em>could not measure</em> was not assessed and remains unverified.
  </p>
</section>

<footer class="foot">Generated ${esc(formatDateTime(new Date()))} &middot; LiDAR Site Check</footer>
</body>
</html>`;
}

function renderCheck(check: CheckResult): string {
  return `<section class="block check">
  <div class="check-head">
    <h2>${esc(check.checkName)}</h2>
    <span class="pill ${check.status}">${statusLabel(check.status)}</span>
  </div>
  ${check.metrics.length ? `<table class="metrics">${check.metrics
    .map(
      (m) =>
        `<tr><th>${esc(m.label)}</th><td class="${m.emphasis ?? ''}">${esc(m.value)}</td></tr>`,
    )
    .join('')}</table>` : ''}
  <ul class="findings">${check.findings.map(renderFinding).join('')}</ul>
</section>`;
}

function renderFinding(f: Finding): string {
  return `<li class="finding ${f.severity}">
  <div class="finding-head"><span class="code">${esc(f.code)}</span><strong>${esc(f.title)}</strong></div>
  <p>${esc(f.detail)}</p>
</li>`;
}

function renderPhotos(photos: readonly ReportPhoto[] | undefined): string {
  if (!photos || photos.length === 0) return '';
  return `<section class="block"><h2>Photographs</h2><div class="photos">${photos
    .map(
      (p) =>
        `<figure><img src="${esc(p.dataUrl)}" alt="${esc(p.caption ?? 'Field photograph')}">${
          p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ''
        }</figure>`,
    )
    .join('')}</div></section>`;
}

/**
 * Tolerances are stored as decimals but must never be printed that way. A
 * document that says "±0.25 in" reads as machined tolerance and gets queried;
 * every other number in this report is a fraction, and this one has to match.
 * Thirty-seconds, because tight profiles use 1/8 and 3/8 values.
 */
const tol = (inches: number): string => esc(formatInches(inches, 32));

const metaRow = (label: string, value: string): string =>
  `<div class="meta-row"><span>${esc(label)}</span><strong>${esc(value)}</strong></div>`;

const tally = (label: string, value: number, tone: string): string =>
  `<div class="tally-item ${tone}"><span class="n">${value}</span><span class="l">${esc(label)}</span></div>`;

const verdictLabel = (v: ReportSummary['overall']): string =>
  v === 'pass' ? 'No deficiencies' : v === 'fail' ? 'Deficiencies found' : 'Incomplete';

const statusLabel = (s: CheckResult['status']): string =>
  s === 'pass' ? 'Pass' : s === 'fail' ? 'Deficiency' : 'Could not measure';

export function esc(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const pad = (n: number): string => String(n).padStart(2, '0');

export const formatDate = (d: Date): string =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export const formatDateTime = (d: Date): string =>
  `${formatDate(d)} ${pad(d.getHours())}:${pad(d.getMinutes())}`;

const STYLES = `
:root{--ink:#14181d;--muted:#5b6672;--line:#d8dee5;--bad:#b3261e;--warn:#8a5a00;--good:#0f6b3f;--bg:#fff}
*{box-sizing:border-box}
body{margin:0;padding:32px;font:14px/1.55 -apple-system,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--ink);background:var(--bg);max-width:900px;margin-inline:auto}
h1{font-size:22px;margin:0 0 4px}
h2{font-size:16px;margin:0}
.sub{margin:0;color:var(--muted)}
.head{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;border-bottom:2px solid var(--ink);padding-bottom:14px}
.verdict{padding:8px 14px;border-radius:6px;font-weight:700;white-space:nowrap}
.verdict.pass{background:#e6f4ec;color:var(--good)}
.verdict.fail{background:#fbe9e7;color:var(--bad)}
.verdict.invalid{background:#fdf1dc;color:var(--warn)}
.meta{display:grid;grid-template-columns:repeat(auto-fit,minmax(230px,1fr));gap:6px 24px;margin:18px 0}
.meta-row{display:flex;justify-content:space-between;gap:12px;border-bottom:1px dotted var(--line);padding:5px 0}
.meta-row span{color:var(--muted)}
.tally{display:flex;gap:10px;flex-wrap:wrap;margin:18px 0}
.tally-item{flex:1 1 130px;border:1px solid var(--line);border-radius:8px;padding:12px}
.tally-item .n{display:block;font-size:26px;font-weight:700;line-height:1}
.tally-item .l{color:var(--muted);font-size:12px}
.tally-item.bad .n{color:var(--bad)}
.tally-item.warn .n{color:var(--warn)}
.tally-item.good .n{color:var(--good)}
.block{border:1px solid var(--line);border-radius:8px;padding:16px;margin:14px 0;break-inside:avoid}
.check-head{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:10px}
.pill{font-size:12px;font-weight:700;padding:3px 10px;border-radius:99px}
.pill.pass{background:#e6f4ec;color:var(--good)}
.pill.fail{background:#fbe9e7;color:var(--bad)}
.pill.invalid{background:#fdf1dc;color:var(--warn)}
.metrics{width:100%;border-collapse:collapse;margin-bottom:12px}
.metrics th{text-align:left;font-weight:400;color:var(--muted);padding:4px 0;width:55%}
.metrics td{text-align:right;font-variant-numeric:tabular-nums;padding:4px 0}
.metrics td.bad{color:var(--bad);font-weight:700}
.metrics td.good{color:var(--good)}
.findings{list-style:none;margin:0;padding:0;display:grid;gap:8px}
.finding{border-left:4px solid var(--line);padding:8px 12px;background:#fafbfc;border-radius:0 6px 6px 0}
.finding.deficiency{border-left-color:var(--bad)}
.finding.observation{border-left-color:var(--warn)}
.finding.invalid{border-left-color:var(--warn);background:#fdf7ea}
.finding.pass{border-left-color:var(--good)}
.finding p{margin:4px 0 0;color:#2c3540}
.finding-head{display:flex;gap:8px;align-items:baseline}
.code{font:11px ui-monospace,Menlo,Consolas,monospace;color:var(--muted)}
.photos{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:12px}
.photos img{width:100%;border-radius:6px;border:1px solid var(--line)}
figure{margin:0}
figcaption{font-size:12px;color:var(--muted);margin-top:4px}
.notes{white-space:pre-wrap;margin:0}
.provenance{background:#fafbfc}
.warn-note{color:#3a444f;font-size:13px}
.foot{color:var(--muted);font-size:12px;text-align:center;margin-top:24px}
@media print{body{padding:0}.block{break-inside:avoid}}
`;
