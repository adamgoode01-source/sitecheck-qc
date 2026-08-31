import { useState } from 'react';
import { runCheck } from '../../domain/checks';
import type { CheckResult } from '../../domain/checks/types';
import { type SpacingAnalysis, analyseSpacing } from '../../domain/spacing';
import { BAR_SIZES } from '../../domain/rebar';
import { DOOR_RO_ALLOWANCE_IN } from '../../domain/opening';
import {
  COMMON_FRAMING_OC_IN,
  COMMON_REBAR_OC_IN,
  COMMON_ROUGH_IN_HEIGHTS_IN,
} from '../../domain/tolerance';
import { formatInches, parseLength } from '../../domain/units';
import { resolveProvider } from '../../measurement';
import {
  type CaptureRequest,
  type CaptureResult,
  PHASE,
} from '../../measurement/provider';
import {
  addCheck,
  effectiveProfile,
  getInspection,
  getProject,
  putBlob,
  updateInspection,
} from '../../storage/db';
import {
  type CapturedGeometry,
  type CheckSpec,
  type FramingCheckSpec,
  type OpeningCheckSpec,
  type PhaseGeometry,
  type RebarCheckSpec,
  type RoughInCheckSpec,
  newId,
  nowIso,
} from '../../storage/models';
import { Banner, CheckCard, Empty, Field, RunDiagram, TopBar, useAsync } from '../components';
import { navigate } from '../router';

export type CaptureKind = 'framing' | 'rebar' | 'rough-in' | 'opening';

const TITLES: Record<CaptureKind, string> = {
  framing: 'Framing spacing',
  rebar: 'Rebar spacing and cover',
  'rough-in': 'Rough-in locations',
  opening: 'Door / window opening',
};

interface Draft {
  geometry: CapturedGeometry;
  result: CheckResult;
  analysis: SpacingAnalysis | null;
  photo?: Blob;
}

export function CaptureScreen({
  projectId,
  inspectionId,
  kind,
}: {
  projectId: string;
  inspectionId: string;
  kind: CaptureKind;
}) {
  // Shared
  const [reference, setReference] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [offsetText, setOffsetText] = useState('');

  // Framing
  const [memberType, setMemberType] = useState<FramingCheckSpec['memberType']>('stud');
  const [spacingText, setSpacingText] = useState(kind === 'framing' ? '16' : '12');

  // Rebar
  const [barSize, setBarSize] = useState('#4');
  const [hitConvention, setHitConvention] = useState<RebarCheckSpec['hitConvention']>('far-crown');
  const [coverText, setCoverText] = useState('1 1/2');

  // Rough-in
  const [fixtureType, setFixtureType] = useState<RoughInCheckSpec['fixtureType']>('receptacle');
  const [heightText, setHeightText] = useState('18');
  const [buildUpText, setBuildUpText] = useState('0');
  const [measuredTo, setMeasuredTo] = useState('centre of box');

  // Openings
  const [openingKind, setOpeningKind] = useState<OpeningCheckSpec['openingKind']>('door');
  const [widthText, setWidthText] = useState('38');
  const [openingHeightText, setOpeningHeightText] = useState('84 1/2');

  const { data } = useAsync(
    async () => ({
      project: await getProject(projectId),
      provider: await resolveProvider(),
      inspection: await getInspection(inspectionId),
    }),
    [projectId, inspectionId],
  );

  if (!data) return <Empty>Loading&hellip;</Empty>;
  if (!data.project) return <Empty>That project no longer exists.</Empty>;

  const profile = effectiveProfile(data.project);
  const provider = data.provider;
  const offsetIn = offsetText.trim() === '' ? undefined : (parseLength(offsetText) ?? undefined);

  function buildSpec(): CheckSpec | null {
    const source = {
      kind: reference ? ('plan-note' as const) : ('typed' as const),
      reference: reference || undefined,
    };

    if (kind === 'framing' || kind === 'rebar') {
      const spacingIn = parseLength(spacingText);
      if (spacingIn === null || spacingIn <= 0) return null;

      if (kind === 'framing') {
        return { kind: 'framing', memberType, nominalOCIn: spacingIn, expectedSource: source };
      }
      return {
        kind: 'rebar',
        barSize,
        nominalOCIn: spacingIn,
        specifiedCoverIn: parseLength(coverText) ?? undefined,
        hitConvention,
        expectedSource: source,
      };
    }

    if (kind === 'rough-in') {
      const heightIn = parseLength(heightText);
      if (heightIn === null || heightIn <= 0) return null;
      return {
        kind: 'rough-in',
        fixtureType,
        specifiedHeightIn: heightIn,
        floorBuildUpIn: parseLength(buildUpText) ?? 0,
        specifiedOffsetIn: offsetIn,
        measuredTo: measuredTo || undefined,
        expectedSource: source,
      };
    }

    const widthIn = parseLength(widthText);
    const openingHeightIn = parseLength(openingHeightText);
    if (widthIn === null || openingHeightIn === null) return null;

    return {
      kind: 'opening',
      openingKind,
      reference: reference || undefined,
      specifiedWidthIn: widthIn,
      specifiedHeightIn: openingHeightIn,
      specifiedOffsetIn: offsetIn,
      expectedSource: source,
    };
  }

  async function onCapture() {
    const spec = buildSpec();
    setError(null);

    if (!spec) {
      setError('One of the specified dimensions could not be read. Try 16, 3\'-2", or 84 1/2".');
      return;
    }
    if (!provider) {
      setError('No measurement method is available on this device.');
      return;
    }

    setCapturing(true);
    try {
      const capture = await provider.capture(requestFor(spec));
      if (!capture) return; // Cancelled.

      const geometry = toGeometry(capture);
      const result = runCheck(spec, geometry, profile);

      setDraft({
        geometry,
        result,
        analysis: runDiagramFor(spec, geometry, profile),
        photo: capture.photo,
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setCapturing(false);
    }
  }

  async function onSave() {
    const spec = buildSpec();
    if (!draft || !spec) return;

    if (draft.photo) {
      const blobId = await putBlob(draft.photo, 'photo', draft.photo.type || 'image/jpeg');
      const inspection = data?.inspection;
      if (inspection) {
        await updateInspection(inspectionId, { photoIds: [...inspection.photoIds, blobId] });
      }
    }

    await addCheck(inspectionId, {
      id: newId(),
      spec,
      geometry: draft.geometry,
      result: draft.result,
    });

    navigate({ name: 'inspection', projectId, inspectionId });
  }

  return (
    <>
      <TopBar title={TITLES[kind]} back={{ name: 'inspection', projectId, inspectionId }} />
      <main className="main">
        {error && <Banner tone="bad">{error}</Banner>}

        {!provider && (
          <Banner tone="bad">
            Nothing on this device can measure. ARKit capture needs the iOS app on a device with a
            depth sensor. On Windows, open a photograph and scale it against a known reference —
            results are indicative only.
          </Banner>
        )}

        {provider && (
          <Banner tone="info">
            {provider.displayName}. {provider.accuracyNote}
          </Banner>
        )}

        {!draft && (
          <div className="card">
            <h3>What does the drawing call for?</h3>

            {kind === 'framing' && (
              <Field label="Member">
                <select
                  value={memberType}
                  onChange={(e) => setMemberType(e.target.value as FramingCheckSpec['memberType'])}
                >
                  <option value="stud">Studs</option>
                  <option value="joist">Joists</option>
                  <option value="truss">Trusses</option>
                  <option value="furring">Furring channels</option>
                </select>
              </Field>
            )}

            {kind === 'rebar' && (
              <>
                <Field label="Bar size">
                  <select value={barSize} onChange={(e) => setBarSize(e.target.value)}>
                    {BAR_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field
                  label="Specified clear cover"
                  hint="Leave blank to check spacing only. Cover also needs three taps on the form face during capture."
                >
                  <input value={coverText} onChange={(e) => setCoverText(e.target.value)} placeholder={`1 1/2"`} />
                </Field>
                <Field
                  label="Where you will tap the bar"
                  hint="Changes the result by up to one bar diameter, so it has to match what you actually do."
                >
                  <select
                    value={hitConvention}
                    onChange={(e) => setHitConvention(e.target.value as RebarCheckSpec['hitConvention'])}
                  >
                    <option value="far-crown">The face nearest me (normal)</option>
                    <option value="centreline">The centre of the bar</option>
                    <option value="near-face">The face against the form</option>
                  </select>
                </Field>
              </>
            )}

            {(kind === 'framing' || kind === 'rebar') && (
              <>
                <Field label="Specified spacing" hint="On centre. Type it, or pick a common value.">
                  <input value={spacingText} onChange={(e) => setSpacingText(e.target.value)} />
                </Field>
                <div className="grid-chips">
                  {(kind === 'framing' ? COMMON_FRAMING_OC_IN : COMMON_REBAR_OC_IN).map((oc) => (
                    <button key={oc} onClick={() => setSpacingText(String(oc))}>
                      {formatInches(oc)}
                    </button>
                  ))}
                </div>
              </>
            )}

            {kind === 'rough-in' && (
              <>
                <Field label="Fixture">
                  <select
                    value={fixtureType}
                    onChange={(e) => setFixtureType(e.target.value as RoughInCheckSpec['fixtureType'])}
                  >
                    <option value="receptacle">Receptacles</option>
                    <option value="switch">Switches</option>
                    <option value="data">Data / comms outlets</option>
                    <option value="plumbing">Plumbing stub-outs</option>
                    <option value="hvac">HVAC penetrations</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <Field label="Specified height above finished floor">
                  <input value={heightText} onChange={(e) => setHeightText(e.target.value)} />
                </Field>
                <div className="grid-chips">
                  {COMMON_ROUGH_IN_HEIGHTS_IN.map((preset) => (
                    <button key={preset.label} onClick={() => setHeightText(String(preset.heightIn))}>
                      {preset.label} {formatInches(preset.heightIn)}
                    </button>
                  ))}
                </div>
                <Field
                  label="Floor build-up still to come"
                  hint="Topping, screed and finish that will go over the surface you tap. Leave at 0 only if you are measuring off the finished floor — otherwise every height here will read high by this amount."
                >
                  <input value={buildUpText} onChange={(e) => setBuildUpText(e.target.value)} placeholder={`1 1/2"`} />
                </Field>
                <Field label="Dimension taken to" hint="Printed on the report so the reader knows what you tapped.">
                  <input value={measuredTo} onChange={(e) => setMeasuredTo(e.target.value)} />
                </Field>
              </>
            )}

            {kind === 'opening' && (
              <>
                <Field label="Opening">
                  <select
                    value={openingKind}
                    onChange={(e) => setOpeningKind(e.target.value as OpeningCheckSpec['openingKind'])}
                  >
                    <option value="door">Door</option>
                    <option value="window">Window</option>
                    <option value="other">Other opening</option>
                  </select>
                </Field>
                <Field label="Specified rough opening width">
                  <input value={widthText} onChange={(e) => setWidthText(e.target.value)} />
                </Field>
                <Field label="Specified rough opening height">
                  <input
                    value={openingHeightText}
                    onChange={(e) => setOpeningHeightText(e.target.value)}
                  />
                </Field>
                {openingKind === 'door' && (
                  <p className="hint" style={{ marginTop: -6, marginBottom: 12 }}>
                    A rough opening is usually the leaf size plus about{' '}
                    {formatInches(DOOR_RO_ALLOWANCE_IN.width)} wide and{' '}
                    {formatInches(DOOR_RO_ALLOWANCE_IN.height)} high — check the door schedule
                    rather than assuming.
                  </p>
                )}
              </>
            )}

            {(kind === 'rough-in' || kind === 'opening') && (
              <Field
                label="Distance from a datum (optional)"
                hint="The dimension on the plan from a corner, jamb or grid line. Leave blank to check height and size only — the report will say position was not verified."
              >
                <input
                  value={offsetText}
                  onChange={(e) => setOffsetText(e.target.value)}
                  placeholder={`3'-6"`}
                />
              </Field>
            )}

            <Field
              label={kind === 'opening' ? 'Opening reference' : 'Plan reference'}
              hint="Printed on the report so the reader can check your source."
            >
              <input
                value={reference}
                onChange={(e) => setReference(e.target.value)}
                placeholder={kind === 'opening' ? 'Door 204' : 'E-201, device schedule'}
              />
            </Field>

            <button className="primary btn-block" disabled={!provider || capturing} onClick={onCapture}>
              {capturing ? 'Capturing…' : 'Start capture'}
            </button>
          </div>
        )}

        {draft && (
          <>
            {draft.geometry.warnings.length > 0 && (
              <Banner tone="warn">{draft.geometry.warnings.join(' ')}</Banner>
            )}
            <CheckCard check={draft.result}>
              {draft.analysis && <RunDiagram analysis={draft.analysis} />}
            </CheckCard>
            <div className="row">
              <button className="grow" onClick={() => setDraft(null)}>
                Discard and re-measure
              </button>
              <button className="primary grow" onClick={onSave}>
                Save to inspection
              </button>
            </div>
          </>
        )}
      </main>
    </>
  );
}

/** Describes the capture steps each check needs. */
function requestFor(spec: CheckSpec): CaptureRequest {
  switch (spec.kind) {
    case 'framing':
      return {
        title: 'Framing spacing',
        phases: [
          {
            id: PHASE.PRIMARY,
            title: 'Mark each member',
            instruction: `Tap the centre of each ${spec.memberType} across the run.`,
            minPoints: 2,
          },
        ],
      };

    case 'rebar':
      return {
        title: 'Rebar',
        phases: [
          {
            id: PHASE.PRIMARY,
            title: 'Mark each bar',
            instruction: 'Tap each bar across the mat, keeping to one bar direction.',
            minPoints: 2,
          },
          ...(spec.specifiedCoverIn !== undefined
            ? [
                {
                  id: PHASE.FORM_FACE,
                  title: 'Mark the form face',
                  instruction: 'Tap four or more points on the form face, away from the steel.',
                  minPoints: 4,
                },
              ]
            : []),
        ],
      };

    case 'rough-in':
      return {
        title: 'Rough-in locations',
        phases: [
          {
            id: PHASE.FLOOR,
            title: 'Mark the floor',
            instruction: 'Tap four or more points on the floor below the work.',
            minPoints: 4,
          },
          ...(spec.specifiedOffsetIn !== undefined
            ? [
                {
                  id: PHASE.DATUM,
                  title: 'Mark the datum',
                  instruction: 'Tap the corner, jamb or grid line the plan dimensions from.',
                  minPoints: 1,
                  maxPoints: 1,
                  optional: true,
                },
              ]
            : []),
          {
            id: PHASE.PRIMARY,
            title: 'Mark each fixture',
            instruction: 'Tap each box or stub-out, at the point the dimension is taken to.',
            minPoints: 1,
          },
        ],
      };

    case 'opening':
      return {
        title: 'Rough opening',
        phases: [
          {
            id: PHASE.PRIMARY,
            title: 'Mark the four corners',
            instruction: 'Tap each corner of the rough opening. Any order.',
            minPoints: 4,
            maxPoints: 4,
          },
          ...(spec.specifiedOffsetIn !== undefined
            ? [
                {
                  id: PHASE.DATUM,
                  title: 'Mark the datum',
                  instruction: 'Tap the corner or grid line the plan dimensions the opening from.',
                  minPoints: 1,
                  maxPoints: 1,
                  optional: true,
                },
              ]
            : []),
        ],
      };
  }
}

/** The run strip only makes sense for the two repeating-member checks. */
function runDiagramFor(
  spec: CheckSpec,
  geometry: CapturedGeometry,
  profile: ReturnType<typeof effectiveProfile>,
): SpacingAnalysis | null {
  if (spec.kind !== 'framing' && spec.kind !== 'rebar') return null;

  const points = geometry.phases[PHASE.PRIMARY]?.points ?? [];
  if (points.length < 2) return null;

  try {
    return analyseSpacing(points, {
      nominalOC: spec.nominalOCIn,
      spacingTolerance:
        spec.kind === 'framing'
          ? profile.framing.spacingToleranceIn
          : profile.rebar.spacingToleranceIn,
    });
  } catch {
    return null;
  }
}

function toGeometry(capture: CaptureResult): CapturedGeometry {
  const phases: Record<string, PhaseGeometry> = {};

  for (const [id, phase] of Object.entries(capture.phases)) {
    phases[id] = {
      points: phase.points.map((p) => p.position),
      confidences: phase.points.map((p) => p.confidence),
    };
  }

  return {
    phases,
    cameraPosition: capture.cameraPosition,
    upDirection: capture.upDirection,
    providerId: capture.providerId,
    method: capture.method,
    warnings: capture.warnings,
    capturedAt: nowIso(),
  };
}

