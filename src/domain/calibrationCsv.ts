/**
 * Calibration data as CSV.
 *
 * The on-device summary answers the go/no-go, but the raw trials need to leave
 * the phone: to plot, to re-check the arithmetic, and to keep as the evidence
 * behind whatever accuracy the app ends up claiming on its reports.
 *
 * Deviations are written as decimal inches to four places, not fractions.
 * Everything else in this app speaks fractions because people read it; this
 * is the one output a spreadsheet reads, and rounding to 1/16 would throw
 * away most of the signal being measured.
 */

import type { CalibrationSession } from '../storage/models';

const COLUMNS = [
  'trial',
  'captured_at',
  'true_in',
  'measured_in',
  'deviation_in',
  'abs_deviation_in',
  'distance',
  'angle',
  'light',
  'surface',
  'low_confidence',
  'method',
  'warnings',
  'note',
] as const;

export function calibrationToCsv(session: CalibrationSession): string {
  const rows = session.trials.map((trial, index) =>
    [
      index + 1,
      trial.capturedAt,
      session.trueValueIn.toFixed(4),
      trial.measuredIn.toFixed(4),
      trial.deviationIn.toFixed(4),
      Math.abs(trial.deviationIn).toFixed(4),
      trial.conditions.distance,
      trial.conditions.angle,
      trial.conditions.light,
      trial.conditions.surface,
      trial.lowConfidence ? 'yes' : 'no',
      trial.method,
      trial.warnings.join(' | '),
      trial.conditions.note ?? '',
    ]
      .map(csvCell)
      .join(','),
  );

  return [COLUMNS.join(','), ...rows].join('\r\n');
}

export function calibrationCsvFileName(session: CalibrationSession): string {
  const safe = session.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase();
  return `calibration-${safe || 'session'}-${new Date().toISOString().slice(0, 10)}.csv`;
}

/**
 * Quotes a value for CSV, and defuses formula injection.
 *
 * A leading =, +, - or @ makes Excel and Sheets execute the cell. The note
 * field is free text typed on site, so it is a genuine vector — and a
 * spreadsheet that silently evaluates a cell is a spreadsheet whose numbers
 * cannot be trusted, which defeats the point of exporting evidence.
 */
function csvCell(value: string | number): string {
  const text = String(value);
  const guarded = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}
