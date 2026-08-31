/**
 * Getting a file off the device.
 *
 * This exists because the obvious approach is silently broken on the one
 * platform that matters most. Clicking a synthetic `<a download>` works in
 * Electron and in desktop browsers, and does nothing at all in an iOS
 * WKWebView — no error, no file, no console message. The phone is the device
 * that *produces* inspection packages, so "export" quietly doing nothing there
 * meant a crew's work could not leave the handset at all.
 *
 * On iOS the file is written to the cache directory and handed to the system
 * share sheet, which is the only route a user can actually get a file into
 * Files, Mail, or AirDrop.
 */

import { Capacitor } from '@capacitor/core';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';

export type SaveOutcome =
  | { status: 'saved'; detail: string }
  | { status: 'shared'; detail: string }
  | { status: 'cancelled' };

export interface SaveOptions {
  /** Title offered to the share sheet. */
  title?: string;
  /** Prompt shown above the iOS share sheet. */
  dialogTitle?: string;
}

/**
 * Write a blob out to wherever the platform puts user files.
 *
 * Throws on genuine failure. A user dismissing the share sheet is not a
 * failure and comes back as `cancelled`, so callers can stay quiet rather
 * than showing an error for a deliberate action.
 */
export async function saveFile(
  blob: Blob,
  filename: string,
  options: SaveOptions = {},
): Promise<SaveOutcome> {
  if (Capacitor.isNativePlatform()) {
    return saveNative(blob, filename, options);
  }
  return saveViaAnchor(blob, filename);
}

async function saveNative(
  blob: Blob,
  filename: string,
  options: SaveOptions,
): Promise<SaveOutcome> {
  // Cache rather than Documents: these are hand-offs, not a second copy of
  // the database, and the OS may reclaim them once shared.
  const data = await blobToBase64(blob);

  await Filesystem.writeFile({
    path: filename,
    data,
    directory: Directory.Cache,
    recursive: true,
  });

  const { uri } = await Filesystem.getUri({ path: filename, directory: Directory.Cache });

  try {
    await Share.share({
      title: options.title ?? filename,
      url: uri,
      dialogTitle: options.dialogTitle ?? 'Send file',
    });
    return { status: 'shared', detail: filename };
  } catch (error) {
    // The Share plugin rejects when the sheet is dismissed. That is a normal
    // user action, not something to surface as a failure — but the file is
    // written either way, so say where it is.
    if (isShareDismissal(error)) return { status: 'cancelled' };
    throw error;
  }
}

function saveViaAnchor(blob: Blob, filename: string): SaveOutcome {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;

  // Firefox will not act on an anchor that is not in the document.
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking synchronously can cancel the download before the browser has
  // read the blob. One tick is enough and costs nothing.
  setTimeout(() => URL.revokeObjectURL(url), 10_000);

  return { status: 'saved', detail: filename };
}

function isShareDismissal(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /cancel|abort|dismiss/i.test(message);
}

/** Filesystem.writeFile takes base64 without the data-url prefix. */
function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Could not read the file'));
    reader.readAsDataURL(blob);
  });
}

/** Human-readable confirmation for the UI. */
export function describeSaveOutcome(outcome: SaveOutcome): string | null {
  switch (outcome.status) {
    case 'saved':
      return `Saved ${outcome.detail}.`;
    case 'shared':
      return `Sent ${outcome.detail}.`;
    case 'cancelled':
      return null;
  }
}
