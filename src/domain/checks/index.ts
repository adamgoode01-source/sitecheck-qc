/**
 * Check dispatch.
 *
 * A stored check keeps its spec and its measured geometry, so the result is
 * always reproducible. That makes this function the single place a check is
 * ever executed — at capture time, and again whenever the tolerance profile
 * changes and every past inspection needs re-evaluating against the corrected
 * numbers. Without that, fixing a wrong tolerance would mean re-inspecting.
 *
 * This is also the only layer that knows how capture phases map onto check
 * inputs. The checks themselves take plain point arrays and stay testable
 * without any notion of a camera.
 */

import type { ToleranceProfile } from '../tolerance';
import type { CapturedGeometry, CheckSpec } from '../../storage/models';
import { migrateGeometry, phasePoints } from '../../storage/models';
import { PHASE } from '../../measurement/provider';
import { runFramingSpacingCheck } from './framingSpacing';
import { runOpeningCheck } from './openings';
import { runRebarCheck } from './rebarMat';
import { runRoughInCheck } from './roughIn';
import type { CheckResult } from './types';

export * from './types';
export * from './grouping';
export * from './framingSpacing';
export * from './rebarMat';
export * from './roughIn';
export * from './openings';

export function runCheck(
  spec: CheckSpec,
  rawGeometry: CapturedGeometry,
  profile: ToleranceProfile,
): CheckResult {
  const geometry = migrateGeometry(rawGeometry);
  const primary = phasePoints(geometry, PHASE.PRIMARY);
  const datum = phasePoints(geometry, PHASE.DATUM)[0];

  switch (spec.kind) {
    case 'framing':
      return runFramingSpacingCheck({
        points: primary,
        memberType: spec.memberType,
        nominalOCIn: spec.nominalOCIn,
        tolerances: profile.framing,
      });

    case 'rebar':
      return runRebarCheck({
        barPoints: primary,
        formFacePoints: phasePoints(geometry, PHASE.FORM_FACE),
        barSize: spec.barSize,
        nominalOCIn: spec.nominalOCIn,
        specifiedCoverIn: spec.specifiedCoverIn,
        hitConvention: spec.hitConvention,
        tolerances: profile.rebar,
        cameraPosition: geometry.cameraPosition,
      });

    case 'rough-in':
      return runRoughInCheck({
        fixturePoints: primary,
        floorPoints: phasePoints(geometry, PHASE.FLOOR),
        datumPoint: datum,
        fixtureType: spec.fixtureType,
        specifiedHeightIn: spec.specifiedHeightIn,
        floorBuildUpIn: spec.floorBuildUpIn,
        specifiedOffsetIn: spec.specifiedOffsetIn,
        measuredTo: spec.measuredTo,
        tolerances: profile.roughIn,
      });

    case 'opening':
      return runOpeningCheck({
        cornerPoints: primary,
        datumPoint: datum,
        kind: spec.openingKind,
        reference: spec.reference,
        specifiedWidthIn: spec.specifiedWidthIn,
        specifiedHeightIn: spec.specifiedHeightIn,
        specifiedOffsetIn: spec.specifiedOffsetIn,
        tolerances: profile.openings,
        up: geometry.upDirection,
      });
  }
}
