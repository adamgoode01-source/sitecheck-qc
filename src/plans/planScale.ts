/**
 * Turning a plan sheet into numbers you can measure against.
 *
 * Two routes, both offered because both fail in different ways:
 *
 *  1. A named scale (1/4" = 1'-0"). Instant, and correct only if the PDF is
 *     at true plotted size. Anything that has been "fit to page" through a
 *     print driver, scanned, or re-exported at letter size from an ARCH D
 *     sheet is silently wrong — and it looks completely normal on screen.
 *
 *  2. Calibrating against a printed dimension on the sheet. Slower, needs a
 *     dimension string to drag along, and it is right regardless of what has
 *     been done to the file.
 *
 * The app defaults to route 2 and treats route 1 as a convenience, because a
 * wrong scale produces confident, plausible, wrong expected dimensions — the
 * worst failure this app can have.
 */

/** PDF user space is 1/72 inch per unit for essentially all CAD output. */
export const PDF_UNITS_PER_INCH = 72;

export interface NamedScale {
  id: string;
  label: string;
  /** Real-world inches represented by one inch of paper. */
  inchesPerPaperInch: number;
  system: 'architectural' | 'engineering' | 'metric';
}

export const NAMED_SCALES: readonly NamedScale[] = [
  { id: 'arch-1-8', label: '1/8" = 1\'-0"', inchesPerPaperInch: 96, system: 'architectural' },
  { id: 'arch-3-16', label: '3/16" = 1\'-0"', inchesPerPaperInch: 64, system: 'architectural' },
  { id: 'arch-1-4', label: '1/4" = 1\'-0"', inchesPerPaperInch: 48, system: 'architectural' },
  { id: 'arch-3-8', label: '3/8" = 1\'-0"', inchesPerPaperInch: 32, system: 'architectural' },
  { id: 'arch-1-2', label: '1/2" = 1\'-0"', inchesPerPaperInch: 24, system: 'architectural' },
  { id: 'arch-3-4', label: '3/4" = 1\'-0"', inchesPerPaperInch: 16, system: 'architectural' },
  { id: 'arch-1', label: '1" = 1\'-0"', inchesPerPaperInch: 12, system: 'architectural' },
  { id: 'arch-1-1-2', label: '1 1/2" = 1\'-0"', inchesPerPaperInch: 8, system: 'architectural' },
  { id: 'arch-3', label: '3" = 1\'-0"', inchesPerPaperInch: 4, system: 'architectural' },
  { id: 'eng-10', label: '1" = 10\'', inchesPerPaperInch: 120, system: 'engineering' },
  { id: 'eng-20', label: '1" = 20\'', inchesPerPaperInch: 240, system: 'engineering' },
  { id: 'eng-40', label: '1" = 40\'', inchesPerPaperInch: 480, system: 'engineering' },
  { id: 'metric-50', label: '1:50', inchesPerPaperInch: 50, system: 'metric' },
  { id: 'metric-100', label: '1:100', inchesPerPaperInch: 100, system: 'metric' },
];

export interface CanvasPoint {
  x: number;
  y: number;
}

/**
 * Inches of real world per PDF user unit, derived from a named scale.
 * Only valid when the PDF page is at its true plotted size.
 */
export function inchesPerPdfUnitFromNamedScale(scale: NamedScale): number {
  return scale.inchesPerPaperInch / PDF_UNITS_PER_INCH;
}

/**
 * Calibrate from two points clicked on a rendered page.
 *
 * `renderScale` is the pdf.js viewport scale the page was drawn at, so the
 * result is stored against PDF units and stays valid at any zoom level, on
 * any screen, and after the file is reopened on another device.
 */
export function calibrateFromCanvas(
  from: CanvasPoint,
  to: CanvasPoint,
  knownLengthIn: number,
  renderScale: number,
): { inchesPerPdfUnit: number; pdfUnitLength: number } {
  if (!(knownLengthIn > 0)) throw new Error('The known dimension must be greater than zero');
  if (!(renderScale > 0)) throw new Error('Invalid render scale');

  const pixelLength = Math.hypot(to.x - from.x, to.y - from.y);
  if (pixelLength < 4) {
    throw new Error('Drag along the full dimension — that line is too short to calibrate from');
  }

  const pdfUnitLength = pixelLength / renderScale;
  return { inchesPerPdfUnit: knownLengthIn / pdfUnitLength, pdfUnitLength };
}

/** Real-world inches between two points clicked on a rendered page. */
export function measureOnCanvas(
  from: CanvasPoint,
  to: CanvasPoint,
  inchesPerPdfUnit: number,
  renderScale: number,
): number {
  const pixelLength = Math.hypot(to.x - from.x, to.y - from.y);
  return (pixelLength / renderScale) * inchesPerPdfUnit;
}

/**
 * Sanity check a calibration against the named scales.
 *
 * If someone calibrates a sheet and lands within a few percent of 1/4" = 1'-0"
 * they almost certainly have a true-size sheet, which is reassuring. If they
 * land nowhere near any standard scale, the sheet has probably been resized —
 * worth saying so, since it also means every printed dimension on it is
 * still correct while every scaled measurement off it would have been wrong.
 */
export function nearestNamedScale(
  inchesPerPdfUnit: number,
): { scale: NamedScale; errorPercent: number } | null {
  let best: { scale: NamedScale; errorPercent: number } | null = null;

  for (const scale of NAMED_SCALES) {
    const expected = inchesPerPdfUnitFromNamedScale(scale);
    const errorPercent = Math.abs((inchesPerPdfUnit - expected) / expected) * 100;
    if (!best || errorPercent < best.errorPercent) best = { scale, errorPercent };
  }

  return best;
}

export const CALIBRATION_MATCH_TOLERANCE_PERCENT = 3;
