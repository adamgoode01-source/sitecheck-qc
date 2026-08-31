# LiDAR Site Check

Field quality control for framing and reinforcing steel. Measure the work in 3D
on an iPhone, compare it against dimensions taken off the contract drawings,
and issue a report — entirely offline.

---

## Status

| | |
|---|---|
| TypeScript (`npm run typecheck`) | ✅ clean |
| Tests (`npm test`) | ✅ 84 passing |
| Production build (`npm run build`) | ✅ builds, pdf.js worker emits correctly |
| Runs in a browser | ✅ verified — projects, inspections, capture setup, reports |
| Windows Electron shell | ⚠️ written, never launched |
| iOS / ARKit | ❌ never compiled — needs a Mac |
| Measured against a real tape | ❌ **not done, and this is the one that matters** |

The domain core is verified. The platform shells are not, and no measurement
this app produces has ever been compared against a tape. See
[What to verify first](#what-to-verify-first).

---

## What it does

**On iOS** — the field tool. Open a check, tap the centre of each stud or each
bar, and ARKit returns real 3D positions. The app fits a straight run through
them, measures every bay, and compares against the specified spacing. For
rebar it also takes three taps on the form face and computes clear cover.

**On Windows** — the plan and review station. Import the drawing PDFs,
calibrate each sheet's scale, pull expected dimensions straight off the plan,
review what the field captured, and print the report.

**Between them** — a `.qcpkg` export file. No cloud, no account, no server.

### What it checks

| Check | What it measures | Why it matters |
|---|---|---|
| Framing spacing | Bay-to-bay o.c. spacing for studs, joists, trusses, furring | Wrong spacing fails inspection and breaks sheet-goods layout |
| Rebar spacing + clear cover | Bar-to-bar spacing, and cover from the form face | Under-cover is invisible once concrete is placed and corrodes the structure years later |
| Rough-in locations | Height above finished floor and offset from a datum, for boxes, stub-outs and penetrations | Wrong height is usually wrong for a whole floor at once, and only found after the wall closes |
| Door / window openings | Width, height, squareness, jamb plumb, sill level, position | A racked opening will not take a prehung unit however correct the width is |

The first two also check **cumulative layout drift** — every bay individually
within tolerance while the run as a whole walks off. Eight bays each 1/8" over
is an inch of error by the end, and sheathing no longer breaks on a stud. A
tape-and-eyeball check almost never catches this; summing the run does.

Three details in the newer checks are worth knowing about, because each is a
real way jobs go wrong:

**Floor build-up.** At rough-in the surface you tap is bare slab, but the
drawing dimension is to *finished* floor. With 1 1/2" of topping still to
come, a box set 18" off the slab lands at 16 1/2" AFF. The check takes the
build-up as an explicit input and the report always states what was allowed
for — a zero there is a claim, not a blank.

**Self-alignment.** Two switches beside a door at 47 3/4" and 48 1/4" both
pass a ±1/2" spec and look obviously wrong on the wall. The spread across a
set is checked separately from each fixture's compliance.

**Diagonals.** An opening can have both widths and both heights correct and
still be racked. Only the diagonals catch it, and no amount of shimming fixes
it once the framing is nailed off.

### Four corners, four taps

The openings check derives everything from one four-corner capture. Corners
can be tapped in any order — they are sorted using gravity, which is why
`CaptureResult` carries an `upDirection`: ARKit world space is gravity-aligned
(+Y), while a photograph's Y axis runs *down* the image. Assuming a convention
there would silently mirror sill and head on every photo-based capture.

---

## The honest limitations

Read these before showing the app to a client.

**ARKit is iOS-only.** This was your explicit choice and the architecture
respects it, but Windows has no depth sensor and no equivalent API. The
Windows build cannot take a real measurement. It can scale a photograph
against a reference of known length, which is enough to triage
("that bay looks a long way over") and nothing more. That path is labelled as
indicative everywhere it appears, and it cannot measure cover at all, because
cover needs a 3D plane.

**A photo alone proves nothing.** Any product claiming to measure dimensions
from an uncalibrated photograph is guessing. Perspective and lens distortion
make pixel distances meaningless without a scale reference or a depth sensor.
That is why the whole design routes through ARKit.

**Accuracy is good, not survey grade.** On a LiDAR iPhone over a few feet,
expect a fraction of an inch. It degrades with distance, in direct sun, and on
dark, wet, or reflective surfaces. Without LiDAR, ARKit places points on
estimated planes and error can reach half an inch — the app detects this and
says so on the capture and on the report.

**The tolerance defaults are not from any standard.** `src/domain/tolerance.ts`
ships reasonable starting numbers, clearly marked as such. The governing
tolerance is whatever the project specification and the engineer of record
say. Someone must read the spec once at project setup and enter the real
values. Every report prints where its tolerances came from.

**"Could not measure" is never reported as a pass.** If the tapped points do
not form a straight run, or the form face is not flat, the check returns
`invalid` and the report says the item is unverified. This distinction is
deliberate and load-bearing — the worst thing this app could do is say work is
fine when it simply failed to measure.

---

## Getting it running

### Prerequisites

Nothing is installed on this machine yet. You need:

- **Node.js 20 LTS** — <https://nodejs.org> (required for everything)
- **Xcode 15+ on a Mac** — required for the iOS build; there is no way around
  this, Apple does not permit iOS builds from Windows
- **An iPhone/iPad with LiDAR** (Pro models, 12 Pro onward) for best accuracy

### First run — Windows desktop

```bash
npm install
```

```bash
npm run dev
```

That serves the app at <http://localhost:5173> in a browser, which is the
fastest way to see it. For the real desktop shell, leave that running and in a
second terminal:

```bash
npm run electron:dev
```

To produce an installer:

```bash
npm run electron:package
```

### Tests

```bash
npm test
```

84 tests covering the measurement maths — unit parsing, line and plane
fitting, spacing, drift, missing-member detection, cover conversion, rough-in
and opening geometry, report rendering, and the calibration statistics. All
passing.

### Shipping

See [DEPLOYMENT.md](DEPLOYMENT.md) for the TestFlight route — including why the
Expo shell must not be the thing you ship, and why the tape calibration study
comes first.

### iOS

On a Mac, after `npm install`:

```bash
npx cap add ios
```

The ARKit plugin installs itself through CocoaPods — it is a proper Capacitor
package, so there is nothing to drag into Xcode. Set
`NSCameraUsageDescription` and a 14.0 deployment target, which Capacitor does
not generate; see
[`packages/capacitor-sitecheck-ar/README.md`](packages/capacitor-sitecheck-ar/README.md).

```bash
npm run ios:sync
```

```bash
npm run ios:open
```

---

## How it is put together

One TypeScript codebase. The platform difference is confined to a single
interface.

```
src/
  domain/            Pure logic. No I/O, no React, no platform APIs.
    units.ts         Feet-inch-fraction parsing and formatting
    geometry.ts      Vectors, line and plane fitting (Jacobi eigensolver)
    spacing.ts       On-centre analysis, drift, missing members
    rebar.ts         Bar sizes, clear-cover conversion
    tolerance.ts     Editable tolerance profiles
    checks/          Framing and rebar checks -> findings
    report.ts        Self-contained HTML report

  measurement/       The platform seam
    provider.ts      MeasurementProvider interface
    arkit.ts         iOS, via the native plugin (metres -> inches here)
    referenceLine.ts Windows fallback, photo + known reference

  plans/             PDF rendering and sheet scale calibration
  storage/           IndexedDB (Dexie), models, .qcpkg export/import
  ui/                React screens

electron/            Windows shell (thin: one preload flag, no native code)
packages/
  capacitor-sitecheck-ar/   ARKit capture plugin, Swift
tests/               Vitest, domain only
```

Two decisions worth knowing about:

**Everything is inches.** Sensors report metres; conversion happens once, at
the provider boundary. No module below that has to think about units.

**Checks store their inputs, not just their verdicts.** An inspection keeps the
measured points and the spec alongside the result. If a tolerance turns out to
be wrong, "Re-evaluate" recomputes every past check against the corrected
numbers instead of sending a crew back to the floor.

---

## What to verify first

1. **Accuracy against a tape.** Nothing else on this list matters if the tool
   cannot measure. Full protocol in [CALIBRATION.md](CALIBRATION.md) — build a
   marked reference target, 20 baseline repeats plus a factor sweep, and judge
   the result against the tolerance band it has to police. Treat it as
   go/no-go.
2. **The Swift plugin.** Written against the Capacitor 6 and ARKit APIs but
   never compiled. Method registration and the raycast calls are the likely
   friction points.
3. **pdf.js worker loading.** Verified under Vite dev and in the production
   bundle. Still unverified under Electron `file://` and under Capacitor,
   where it fails silently — the page renders blank rather than erroring.
4. **The Electron shell.** Written, never launched.
5. **`parseLength` against real input.** Its job is to reject anything
   ambiguous rather than guess. The tests cover the forms I thought of; a
   wrong expected dimension that looks plausible is the most damaging bug
   this app can have, so throw real site input at it.

## Losing work

Two ways a day's inspections could have vanished. Both are now handled, but
the reasoning matters if you touch this code.

**Getting files off the phone.** Saving by clicking a synthetic
`<a download>` works in Electron and desktop browsers and does nothing at all
in an iOS WKWebView — no error, no file, no console message. Since the phone
is the device that *produces* packages, export was silently a no-op exactly
where it mattered. All saving now goes through `src/platform/files.ts`, which
writes to the cache directory and opens the system share sheet on native, and
falls back to the anchor on desktop. Never bypass it.

**The database being evicted.** IndexedDB is reclaimable storage: under
pressure the OS can drop the whole origin, with no warning and no undo.
`src/platform/persistence.ts` requests persistent storage at start-up and
again from the settings screen, because iOS is likelier to grant it once the
user has engaged with the app.

That request is best-effort and is routinely refused — Chrome denies it
outright without user engagement. So the actual safety net is the second half:
every project tracks `lastExportedAt`, and any inspection modified since then
is counted as existing nowhere but the device. That count drives a warning on
the project screen and a badge in the project list, and it deliberately
over-reports. Editing an already-exported inspection puts it back at risk,
because the package sitting on the office machine no longer matches the
handset.

`markProjectExported` is only called when a file actually goes somewhere. A
dismissed share sheet leaves the warning up.

## Repeated findings

A mat where every bar is short of cover used to emit one near-identical
paragraph per bar. Forty paragraphs saying the same thing is not a more
thorough report — the reader skims, and the one line that mattered goes past
with the rest.

Findings now consolidate above three occurrences (`CONSOLIDATE_THRESHOLD` in
`src/domain/checks/grouping.ts`). Below that they stay individual, because
two findings are perfectly readable and more specific.

Three things consolidation must never lose, and which the tests pin down:

- **Which items failed.** Indices are preserved and printed as compact ranges
  — "bays 1-4 and 7" is something you can walk to. When nothing was spared it
  says "every bar", because a systemic failure is a different conversation
  from a handful of bad spots.
- **How many failed.** Findings carry `occurrences`, and every tally sums that
  rather than counting findings. A worst-case mat still reports 51
  deficiencies on the front page even though it prints 5 findings. Any new
  code that counts findings must use `occurrencesOf`.
- **The worst case.** Each grouped finding leads with the single worst reading,
  since that is what decides whether this is a snag or a stop-work.

`src/domain/checks/spacingFindings.ts` is shared by framing and rebar — both
were carrying near-duplicate copies of this logic.

## Sunlight mode

Field feedback: unreadable outdoors. Two causes, both fixed by the ☀ toggle in
the header — one tap, on every screen, remembered per device.

**Dark mode is the wrong answer outside.** The normal palette follows the
system, so a phone set to dark gives a dark screen, and the glass reflects
ambient light faster than the display can out-shine the sun. Sunlight mode
overrides the system setting rather than respecting it. It is declared with an
attribute selector after the `prefers-color-scheme` block specifically so it
wins in both directions.

**AA contrast is a desk standard.** Body text was already 16.6:1, but
secondary text sat at 5.85:1 and status pills at 5.3–6.2:1 — fine indoors,
gone in glare. Worse, the hints were 13px *and* low contrast, the worst
pairing available. Sunlight mode measures:

| | normal | sunlight |
|---|---|---|
| Secondary text | 5.85:1 | **17.04:1** |
| Primary button | 6.18:1 | **11.54:1** |
| Pass pill | 5.80:1 | **10.04:1** |
| Body text | 16px | 17px, weight 500 |
| Tap target floor | 44px | 52px |

Status pills also go solid instead of tinted, rules thicken, and hint text
goes up to 15px semibold. It gives up refinement deliberately — this is the
palette for squinting.

The native AR overlay is separate from all of this, since it is Swift rather
than CSS. Its labels and buttons now sit on 85%-opaque black with white
outlines rather than a 55% tint, because the camera feed behind them is bright
concrete and the AR view is the one screen a worker cannot navigate away from
to read.

## Three points never prove a plane

Worth stating plainly, because it was a live bug and the same trap is easy to
walk back into.

Three points fit a plane *exactly*. The residual is always zero. So a
flatness check on three taps can never fail — including when one of them
landed on a toe-board, a coiled cable, or a form tie. Every height and every
cover reading is measured from that plane, so a bad reference silently
poisons the whole check while reporting a perfect fit.

`PlaneFit.verifiable` is false below four points, the floor and form-face
captures now ask for four, and both checks report "could not be checked for
flatness" rather than implying it passed. Do not read a zero RMS as evidence
of anything without checking `verifiable` first.

## Not built

Deliberately out of scope for this version, and straightforward to add later:

- Perspective-correcting homography for the Windows photo path, which would
  make it meaningfully better than a plain similarity scale
- Editing tolerance profiles in the UI (the model supports `customProfile`
  per project; there is no screen for it yet)
- Multi-user, sync, or any server component
