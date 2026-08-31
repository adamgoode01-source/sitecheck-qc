/**
 * Provider selection.
 *
 * ARKit is preferred wherever it exists. The photo fallback exists so the
 * Windows build is not a dead end, not because it is equivalent — see the
 * header of `referenceLine.ts`.
 */

import { Capacitor } from '@capacitor/core';
import { ArkitMeasurementProvider } from './arkit';
import type { MeasurementProvider } from './provider';
import { ReferenceLineProvider } from './referenceLine';

export * from './provider';
export * from './arkit';
export * from './referenceLine';

export type Platform = 'ios' | 'windows' | 'web';

export function currentPlatform(): Platform {
  const capacitorPlatform = Capacitor.getPlatform();
  if (capacitorPlatform === 'ios') return 'ios';
  if (typeof window !== 'undefined' && '__SITECHECK_DESKTOP__' in window) return 'windows';
  return 'web';
}

const arkit = new ArkitMeasurementProvider();
const referenceLine = new ReferenceLineProvider();

export function allProviders(): MeasurementProvider[] {
  return [arkit, referenceLine];
}

/**
 * Returns the best available provider, or null when nothing can measure.
 * Callers must handle null by telling the user which device to use, rather
 * than falling back to something that fabricates numbers.
 */
export async function resolveProvider(): Promise<MeasurementProvider | null> {
  for (const provider of allProviders()) {
    const availability = await provider.isAvailable();
    if (availability.available) return provider;
  }
  return null;
}

/** Explains, per provider, why it is or is not usable here. For the settings screen. */
export async function providerStatuses(): Promise<
  Array<{ provider: MeasurementProvider; available: boolean; reason?: string }>
> {
  return Promise.all(
    allProviders().map(async (provider) => {
      const availability = await provider.isAvailable();
      return { provider, available: availability.available, reason: availability.reason };
    }),
  );
}
