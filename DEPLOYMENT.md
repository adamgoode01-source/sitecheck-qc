# Getting LiDAR Site Check onto TestFlight

## Ship the Capacitor app, not the Expo shell

`expo-app/` is a WebView wrapper around a dev server. On TestFlight a tester
would get a connection error, because the LAN address it loads does not exist
on their network. Even hosted, it is a website in a native wrapper with no
device features — App Review rejects those under Guideline 4.2 (Minimum
Functionality).

The app worth shipping is the root Capacitor project, with the ARKit plugin
compiled in. That is what the rest of this file covers.

## Do the calibration study first

Not process advice — sequencing that saves money.

TestFlight puts the app in other people's hands. If ARKit's real-world
accuracy does not hold up, you will have a crew making call-outs on numbers
that are wrong, and the fix might be "widen every tolerance" or "this product
does not work". Find that out with a tape and one device before anyone else
depends on it.

The useful part: **a device build is 90% of the work of a TestFlight build.**
Calibrating first costs you almost nothing in wasted effort.

## The two prerequisites

### 1. Apple Developer Program — $99/year, unavoidable

There is no free path to TestFlight. Free provisioning installs on your own
device for 7 days via Xcode and cannot distribute to anyone.

- **Individual** enrolment: usually approved in 24–48 hours.
- **Organization** enrolment: needs a D-U-N-S number, typically 1–2 weeks.
  Choose this only if the app must be published under the company name.

### 2. A way to build iOS

Apple does not permit iOS builds from Windows. Two routes:

| Route | Mac needed | Notes |
|---|---|---|
| **Xcode on a Mac** | yes | Borrowed, bought, or rented (MacinCloud, MacStadium, AWS EC2 Mac). Most direct, and the only route that also gives free 7-day provisioning for the calibration study *before* you pay the $99. |
| **Cloud CI** | no | [`codemagic.yaml`](codemagic.yaml) is written and validated — it generates the iOS project, raises the deployment target, patches the plist, bumps the build number, archives and uploads to TestFlight. Account setup in [CODEMAGIC_SETUP.md](CODEMAGIC_SETUP.md). Ionic Appflow and Bitrise also work; GitHub Actions with a `macos-latest` runner works too but you manage certificates yourself. |

**If you have no Mac at all, you must pay the $99 before you can calibrate**,
because CI builds can only reach a device through ad-hoc or TestFlight
distribution, both of which need the paid account.

## Steps

### 1. Generate the iOS project

On the Mac, or as a CI step:

```bash
npm run build && npx cap add ios && npx cap sync ios
```

The ARKit plugin is a proper Capacitor package
([`packages/capacitor-sitecheck-ar/`](packages/capacitor-sitecheck-ar/README.md)),
so `cap sync` installs it through CocoaPods — there is nothing to drag into
Xcode. **It has still never been compiled**, so budget real time for the first
build, not five minutes.

Two things Capacitor does not generate and Apple will not tolerate without:
`NSCameraUsageDescription`, and a deployment target of 14.0 or later. On a Mac,
set them in Xcode. In CI, `codemagic.yaml` injects them with PlistBuddy.

### 2. Register the bundle identifier

`capacitor.config.ts` declares `com.sitecheck.qc`. Bundle IDs are globally
unique across the App Store; if it is taken, change it there and re-run
`npx cap sync ios`. Register it under Certificates, Identifiers & Profiles, or
let Xcode create it on first archive.

### 3. Fill in what Apple will reject you for

These are the usual first-upload failures:

- **App icons.** Capacitor generates placeholders. Apple requires a complete
  set including 1024×1024. Use `@capacitor/assets` to generate from one source
  image.
- **Launch screen.** Must not be a blank white screen.
- **`ITSAppUsesNonExemptEncryption`.** Add `false` to `Info.plist`. The app is
  fully offline and uses no encryption beyond the OS, so this is accurate and
  it skips the export-compliance prompt on every single upload.
- **Privacy manifest** (`PrivacyInfo.xcprivacy`). Required since 2024 for apps
  touching "required reason" APIs. Capacitor and its plugins should ship their
  own; you may still need one for the app target.
- **Version and build numbers.** Every upload needs a unique build number for
  its version. Bump `CFBundleVersion` each time or the upload is rejected.

### 4. Do NOT require ARKit as a device capability

It is tempting to add `arkit` to `UIRequiredDeviceCapabilities`. Don't. The app
already detects LiDAR and plane-only tracking at runtime and downgrades its own
accuracy claim honestly. Requiring the capability stops non-AR devices
installing at all, including the office iPad someone wants to review reports
on — and reviewing is a legitimate use of this app with no measurement
involved.

### 5. Archive and upload

From Xcode: Product → Archive → Distribute App → App Store Connect → Upload.
From CI: the platform handles signing and upload given an App Store Connect API
key.

Processing takes roughly 15–60 minutes before the build appears in TestFlight.

### 6. Choose internal or external testing

This is the step most people get wrong, and internal is almost certainly what
you want:

| | Internal | External |
|---|---|---|
| Testers | up to 100 | up to 10,000 |
| Who | must be users on your App Store Connect team | anyone with an email or a public link |
| **Beta App Review** | **not required** | required, ~24–48h for the first build |
| Available | as soon as processing finishes | after review passes |

For a field crew, add them as App Store Connect users with the Developer or
Marketing role and distribute internally. **No review, same day.**

Builds expire 90 days after upload either way.

### 7. App Privacy declaration

App Store Connect asks what data you collect. This app collects nothing, sends
nothing, and has no account or server — answer **Data Not Collected**. That is
both true and a genuine selling point when a client asks where their drawings
go.

## Rough timeline from a standing start

| | |
|---|---|
| Developer Program enrolment | 1–2 days (individual) |
| Getting the Swift plugin to compile | half a day to two days, realistically |
| Icons, launch screen, plist, privacy manifest | half a day |
| First archive and upload | an hour, plus 15–60 min processing |
| Internal TestFlight | immediate |
| External TestFlight | add 1–2 days for Beta App Review |
