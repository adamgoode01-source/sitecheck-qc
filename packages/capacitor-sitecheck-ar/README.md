# capacitor-sitecheck-ar

ARKit depth measurement for LiDAR Site Check, as a proper Capacitor plugin package.

## Why it is a package

It used to be two loose Swift files with instructions to drag them into Xcode.
That works exactly once, on a Mac, by hand — and it is impossible in CI, which
is precisely where a Windows-based project needs to build.

As a package, `npx cap sync ios` wires it up through CocoaPods with nothing to
drag and nothing to remember. Capacitor finds it because the root
`package.json` depends on it and this `package.json` declares a `capacitor`
field.

## Three different names, none interchangeable

This trips people up, so it is worth stating once:

| Name | Where it comes from | Must equal |
|---|---|---|
| `capacitor-sitecheck-ar` | npm package name | the `file:` dependency in the root `package.json` |
| `CapacitorSitecheckAr` | **derived by Capacitor** from the package name | the podspec filename and its `s.name` |
| `SiteCheckAR` | `@objc(SiteCheckARPlugin)` in Swift | `registerPlugin('SiteCheckAR')` in TypeScript |

The middle one is the trap. Capacitor pascal-cases the hyphenated package
name and writes `pod 'CapacitorSitecheckAr'` into the generated Podfile, and
CocoaPods requires the file to be `<s.name>.podspec`. Renaming it to anything
more readable fails the build with
`No podspec found for CapacitorSitecheckAr`.

## Installing

Already wired up. The root project depends on it by path:

```json
"capacitor-sitecheck-ar": "file:packages/capacitor-sitecheck-ar"
```

After `npm install`, `npx cap sync ios` adds the pod. Nothing else to do.

## Still required by hand, once

Capacitor does not generate these, and Apple terminates the app without them:

**`NSCameraUsageDescription`** in `ios/App/App/Info.plist`:

```xml
<key>NSCameraUsageDescription</key>
<string>SiteCheck uses the camera and depth sensor to measure framing and reinforcing steel on site.</string>
```

Without it the app is killed by the system the instant the AR session starts,
with no error JavaScript can catch. `codemagic.yaml` injects it with
PlistBuddy for CI builds; on a Mac, set it in Xcode or commit the `ios/`
folder once it exists.

**Deployment target 14.0 or later.** The podspec already sets this for the
plugin; the app target needs it too. Raycasting needs 13.0 and the LiDAR
`sceneReconstruction` path needs 13.4, so 14.0 is a safe floor.

## Do not require ARKit as a device capability

Leave `arkit` out of `UIRequiredDeviceCapabilities`. The plugin reports
LiDAR / plane-tracking / unsupported at runtime and the app downgrades its own
accuracy claim honestly. Requiring the capability blocks installation on
non-AR devices entirely — including an office iPad someone wants to review
reports on, which is a legitimate use with no measurement involved.

## The bridge

| JavaScript | Swift |
|---|---|
| `SiteCheckAR.isSupported()` | World-tracking support, and whether the device has LiDAR |
| `SiteCheckAR.startCapture({title, phases})` | Presents the AR view, walks the phases, returns points keyed by phase id |

Positions cross the bridge in **metres**, in ARKit world space.
`src/measurement/arkit.ts` converts to inches. Do not convert on the Swift
side — the boundary is deliberately in one place.

Each point carries a confidence:

| Confidence | What was hit |
|---|---|
| `high` | Reconstructed LiDAR mesh or detected plane geometry, on a LiDAR device |
| `medium` | Detected plane geometry, no LiDAR |
| `low` | An estimated plane — ARKit guessing from feature points, possibly out by an inch or more |

Whether that flag actually predicts error is a real open question, and the
app's calibration mode measures it. See `CALIBRATION.md`.

## Compiles, but has never run

It builds and archives under Xcode 26 through Codemagic, so the Swift is
syntactically and type-wise sound against the real SDK. That is less than it
sounds:

- **Plugin registration is a runtime lookup.** `registerPlugin('SiteCheckAR')`
  matches `@objc(SiteCheckARPlugin)` by string at launch. A mismatch compiles
  perfectly and fails on the device with "plugin not implemented".
- **The AR session has never started.** Raycasting, confidence classification
  and the phase flow are all unexercised.
- **`NSCameraUsageDescription` has never been tested.** If the plist patch did
  not take, the system kills the app the instant the session starts, with no
  error JavaScript can catch.

First run on a device is the real test. Historical friction, now resolved:

- **Method registration.** `CAPBridgedPlugin` with a `pluginMethods` array is
  the Capacitor 6 style. On Capacitor 5 or earlier, drop the protocol and use
  a `CAP_PLUGIN` macro in an Objective-C `.m` file instead.
- **`sceneView.raycastQuery(from:allowing:alignment:)`** is the `ARSCNView`
  convenience. Check the signature against your SDK.
- **`bridge.viewController`** optionality varies across Capacitor versions.
