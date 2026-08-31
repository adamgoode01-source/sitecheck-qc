/**
 * Sunlight mode.
 *
 * The normal palette follows the system, which means a phone in dark mode is
 * a dark screen — close to worst case outdoors, because the glass reflects
 * ambient light and the display cannot out-shine direct sun. Even in light
 * mode, secondary text sat around 5.8:1 contrast, which is fine at a desk and
 * unreadable on a roof.
 *
 * Sunlight mode overrides both: forced white ground, near-black text
 * throughout, solid rather than tinted status colours, heavier weights and
 * thicker rules. It is a display preference of the device, not of the
 * project, so it lives in localStorage rather than the database — a borrowed
 * phone on a bright day should not inherit whatever the office machine chose.
 */

export type DisplayMode = 'auto' | 'sun';

const STORAGE_KEY = 'sitecheck.display';
const ATTRIBUTE = 'data-display';

export function getDisplayMode(): DisplayMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === 'sun' ? 'sun' : 'auto';
  } catch {
    // Private browsing can throw on access. Not worth failing over.
    return 'auto';
  }
}

export function applyDisplayMode(mode: DisplayMode): void {
  if (mode === 'sun') {
    document.documentElement.setAttribute(ATTRIBUTE, 'sun');
  } else {
    document.documentElement.removeAttribute(ATTRIBUTE);
  }
}

export function setDisplayMode(mode: DisplayMode): void {
  applyDisplayMode(mode);
  try {
    localStorage.setItem(STORAGE_KEY, mode);
  } catch {
    // Mode still applies for this session even if it cannot be remembered.
  }
}

export function toggleDisplayMode(): DisplayMode {
  const next: DisplayMode = getDisplayMode() === 'sun' ? 'auto' : 'sun';
  setDisplayMode(next);
  return next;
}
