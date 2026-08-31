/**
 * Keeping the local database from being thrown away.
 *
 * Everything this app records lives in IndexedDB on the device, because there
 * is no server by design. The catch is that browsers and WKWebView treat web
 * storage as reclaimable: under storage pressure the OS can evict the whole
 * origin, and a crew's day of inspections goes with it. There is no warning
 * and no undo.
 *
 * `navigator.storage.persist()` asks the platform not to do that. It is a
 * request, not a guarantee, and it is not supported everywhere — so it is a
 * mitigation, not a solution. The actual safety net is getting work exported
 * off the device, which is why `unexportedWork()` exists and why the UI nags.
 */

export type PersistenceState = 'persisted' | 'not-persisted' | 'unsupported';

export interface PersistenceStatus {
  state: PersistenceState;
  /** Bytes currently used by this origin, when the platform will say. */
  usageBytes?: number;
  quotaBytes?: number;
}

/**
 * Ask for persistent storage. Safe to call on every start-up: once granted it
 * stays granted, and the call is cheap.
 *
 * Deliberately never throws. Failing to secure persistence must not stop the
 * app from starting — a user in a basement with a full phone still needs to
 * record their inspection.
 */
export async function ensurePersistentStorage(): Promise<PersistenceStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persist) {
    return { state: 'unsupported' };
  }

  try {
    const already = await navigator.storage.persisted();
    const granted = already || (await navigator.storage.persist());
    const estimate = await safeEstimate();

    return {
      state: granted ? 'persisted' : 'not-persisted',
      ...estimate,
    };
  } catch {
    return { state: 'unsupported' };
  }
}

export async function persistenceStatus(): Promise<PersistenceStatus> {
  if (typeof navigator === 'undefined' || !navigator.storage?.persisted) {
    return { state: 'unsupported' };
  }

  try {
    const persisted = await navigator.storage.persisted();
    return {
      state: persisted ? 'persisted' : 'not-persisted',
      ...(await safeEstimate()),
    };
  } catch {
    return { state: 'unsupported' };
  }
}

async function safeEstimate(): Promise<{ usageBytes?: number; quotaBytes?: number }> {
  if (!navigator.storage?.estimate) return {};
  try {
    const { usage, quota } = await navigator.storage.estimate();
    return { usageBytes: usage, quotaBytes: quota };
  } catch {
    return {};
  }
}

export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined) return 'unknown';
  if (bytes < 1024) return `${bytes} B`;

  const units = ['KB', 'MB', 'GB'];
  let value = bytes / 1024;
  let unit = 0;

  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[unit]}`;
}

/** Plain-language explanation of what the state means for the user's data. */
export function describePersistence(status: PersistenceStatus): string {
  switch (status.state) {
    case 'persisted':
      return 'This device has agreed not to discard your inspections to reclaim space. Export anyway — a lost or broken phone is not covered by this.';
    case 'not-persisted':
      return 'This device has NOT guaranteed your inspections against being discarded when storage runs low. Export your work at the end of every day.';
    case 'unsupported':
      return 'This platform will not say whether your inspections are safe from being discarded when storage runs low. Export your work at the end of every day.';
  }
}
