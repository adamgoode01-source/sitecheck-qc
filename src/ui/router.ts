/**
 * A hash router in forty lines.
 *
 * Hash routing rather than history routing because the same bundle is served
 * from `file://` inside Electron and `capacitor://` on iOS, and neither
 * supports a server that can rewrite deep paths to index.html.
 */

import { useEffect, useState } from 'react';
import type { CaptureKind } from './screens/CaptureScreen';

export type Route =
  | { name: 'projects' }
  | { name: 'project'; projectId: string }
  | { name: 'plan'; projectId: string; sheetId: string }
  | { name: 'inspection'; projectId: string; inspectionId: string }
  | { name: 'capture'; projectId: string; inspectionId: string; kind: CaptureKind }
  | { name: 'report'; projectId: string; inspectionId: string }
  | { name: 'settings' }
  // Calibration is device-level, not project-level: it measures the tool.
  | { name: 'calibration' }
  | { name: 'calibration-session'; sessionId: string };

const CAPTURE_KINDS: readonly CaptureKind[] = ['framing', 'rebar', 'rough-in', 'opening'];

/** Narrows an arbitrary URL segment, so a hand-typed hash cannot reach a screen with a bad kind. */
function isCaptureKind(value: string | undefined): value is CaptureKind {
  return value !== undefined && (CAPTURE_KINDS as readonly string[]).includes(value);
}

export function parseHash(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);

  if (parts[0] === 'settings') return { name: 'settings' };

  if (parts[0] === 'calibration') {
    return parts[1]
      ? { name: 'calibration-session', sessionId: parts[1] }
      : { name: 'calibration' };
  }

  if (parts[0] === 'p' && parts[1]) {
    const projectId = parts[1];
    if (parts[2] === 'plan' && parts[3]) {
      return { name: 'plan', projectId, sheetId: parts[3] };
    }
    if (parts[2] === 'i' && parts[3]) {
      const inspectionId = parts[3];
      if (parts[4] === 'capture' && isCaptureKind(parts[5])) {
        return { name: 'capture', projectId, inspectionId, kind: parts[5] };
      }
      if (parts[4] === 'report') return { name: 'report', projectId, inspectionId };
      return { name: 'inspection', projectId, inspectionId };
    }
    return { name: 'project', projectId };
  }

  return { name: 'projects' };
}

export function hrefFor(route: Route): string {
  switch (route.name) {
    case 'projects':
      return '#/';
    case 'settings':
      return '#/settings';
    case 'calibration':
      return '#/calibration';
    case 'calibration-session':
      return `#/calibration/${route.sessionId}`;
    case 'project':
      return `#/p/${route.projectId}`;
    case 'plan':
      return `#/p/${route.projectId}/plan/${route.sheetId}`;
    case 'inspection':
      return `#/p/${route.projectId}/i/${route.inspectionId}`;
    case 'capture':
      return `#/p/${route.projectId}/i/${route.inspectionId}/capture/${route.kind}`;
    case 'report':
      return `#/p/${route.projectId}/i/${route.inspectionId}/report`;
  }
}

export const navigate = (route: Route): void => {
  window.location.hash = hrefFor(route);
};

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseHash(window.location.hash));

  useEffect(() => {
    const onChange = () => setRoute(parseHash(window.location.hash));
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);

  return route;
}
