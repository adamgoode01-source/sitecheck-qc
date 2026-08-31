/**
 * pdf.js wrapper for rendering plan sheets.
 *
 * The worker is bundled by Vite rather than pulled from a CDN — this app has
 * to open a set of drawings in a basement with no signal, so nothing may load
 * over the network at runtime.
 */

import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';
// eslint-disable-next-line import/no-unresolved -- Vite resolves ?url at build time
import workerSrc from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjs.GlobalWorkerOptions.workerSrc = workerSrc;

export interface LoadedPlan {
  document: PDFDocumentProxy;
  pageCount: number;
}

export async function loadPlan(source: Blob | ArrayBuffer): Promise<LoadedPlan> {
  const data =
    source instanceof Blob ? new Uint8Array(await source.arrayBuffer()) : new Uint8Array(source);

  const document = await pdfjs.getDocument({ data }).promise;
  return { document, pageCount: document.numPages };
}

export interface RenderedPage {
  canvas: HTMLCanvasElement;
  /** The viewport scale used, needed to convert clicks back to PDF units. */
  renderScale: number;
  widthPx: number;
  heightPx: number;
}

/**
 * Render a page to fit `targetWidthPx`, capped so a large ARCH E sheet at
 * high zoom cannot blow past the browser's maximum canvas size — which fails
 * as a blank page rather than an error, and would look like a corrupt PDF.
 */
export async function renderPage(
  document: PDFDocumentProxy,
  pageNumber: number,
  targetWidthPx: number,
  maxDimensionPx = 8192,
): Promise<RenderedPage> {
  const page: PDFPageProxy = await document.getPage(pageNumber);
  const baseViewport = page.getViewport({ scale: 1 });

  let renderScale = targetWidthPx / baseViewport.width;
  const longest = Math.max(baseViewport.width, baseViewport.height) * renderScale;
  if (longest > maxDimensionPx) {
    renderScale *= maxDimensionPx / longest;
  }

  const viewport = page.getViewport({ scale: renderScale });
  const canvas = window.document.createElement('canvas');
  canvas.width = Math.floor(viewport.width);
  canvas.height = Math.floor(viewport.height);

  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not get a 2D canvas context to render the plan');

  await page.render({ canvasContext: context, viewport }).promise;

  return {
    canvas,
    renderScale,
    widthPx: canvas.width,
    heightPx: canvas.height,
  };
}

/** Page size in PDF units, used to report sheet size and guess ARCH format. */
export async function pageSize(
  document: PDFDocumentProxy,
  pageNumber: number,
): Promise<{ widthIn: number; heightIn: number }> {
  const page = await document.getPage(pageNumber);
  const viewport = page.getViewport({ scale: 1 });
  return { widthIn: viewport.width / 72, heightIn: viewport.height / 72 };
}

/**
 * Best-guess sheet name, e.g. "ARCH D (24 x 36)". Shown when calibrating so a
 * user can spot immediately that a D-size drawing arrived as letter — the most
 * common reason a named scale silently lies.
 */
export function describeSheetSize(widthIn: number, heightIn: number): string {
  const w = Math.round(Math.min(widthIn, heightIn));
  const h = Math.round(Math.max(widthIn, heightIn));

  const known: Array<[number, number, string]> = [
    [8.5, 11, 'Letter'],
    [11, 17, 'ANSI B / Tabloid'],
    [12, 18, 'ARCH B'],
    [17, 22, 'ANSI C'],
    [18, 24, 'ARCH C'],
    [22, 34, 'ANSI D'],
    [24, 36, 'ARCH D'],
    [30, 42, 'ARCH E1'],
    [34, 44, 'ANSI E'],
    [36, 48, 'ARCH E'],
  ];

  for (const [kw, kh, name] of known) {
    if (Math.abs(w - kw) <= 1 && Math.abs(h - kh) <= 1) return `${name} (${kw} x ${kh})`;
  }
  return `${w} x ${h} in`;
}
