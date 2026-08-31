# Codemagic setup — the parts I could not do for you

`codemagic.yaml` is written, validated, and committed. Everything below needs
your accounts, so it has to be you.

Roughly 30–40 minutes, most of it waiting on Apple.

## 1. Push the repo somewhere Codemagic can see it

The repo is initialised with one commit on `main`. It needs a remote —
GitHub, GitLab, or Bitbucket, all supported.

```bash
git remote add origin https://github.com/<you>/sitecheck-qc.git
```

```bash
git push -u origin main
```

Private is fine. Codemagic connects through OAuth, so you never paste
credentials into the config.

## 2a. Register the bundle id

<https://developer.apple.com/account> → **Certificates, Identifiers &
Profiles** → **Identifiers** → **+**

1. **Register a new identifier** → **App IDs** → Continue
2. Type: **App** (not App Clip) → Continue
3. **Description**: `LiDAR Site Check` — internal label only. No punctuation or
   emoji; Apple rejects them here.
4. **Bundle ID**: choose **Explicit**, not Wildcard. Wildcard IDs cannot be
   used for App Store or TestFlight distribution. Enter exactly:

   ```
   com.sitecheck.qc
   ```

5. **Capabilities: leave everything unchecked.** This surprises people, but
   neither ARKit nor the camera is an entitlement — they are gated by
   `Info.plist` usage strings and device support, not by a capability. The app
   has no push, no iCloud, no App Groups, no sign-in. Ticking things you do
   not use invites review questions and can break signing.
6. Continue → **Register**

Bundle IDs are unique across all of Apple, so `com.sitecheck.qc` may be taken.
If it is, pick something you control — reverse-DNS of your own domain is the
convention — and change it in **three** places, which must agree or signing
fails late, after the archive has already run:

| File | Field |
|---|---|
| `capacitor.config.ts` | `appId` |
| `codemagic.yaml` | `BUNDLE_ID` |
| `codemagic.yaml` | `ios_signing.bundle_identifier` |

(`package.json` → `build.appId` is electron-builder's Windows identifier and
is unrelated to Apple. `expo-app/app.json` is the throwaway test shell.)

## 2b. Create the App Store Connect record

<https://appstoreconnect.apple.com> → **My Apps** → **+** → **New App**

- **Platform**: iOS
- **Name**: this is the public App Store name and it is **globally unique**,
  even for an app that never leaves TestFlight. "LiDAR Site Check" may well be
  taken; if so, add a company or client word. It can be changed later, right
  up until first public release.
- **Primary Language**, then **Bundle ID**: pick the one you just registered
  from the dropdown. If it is missing, the registration in 2a did not go
  through.
- **SKU**: any private string you like — `sitecheck-qc-001`. Never shown to
  anyone.
- **User Access**: Full Access

TestFlight has nowhere to put a build until this record exists. The upload
will succeed and then publishing will fail, which is a confusing way to find
out.

## 3. Create an App Store Connect API key

**App Store Connect → Users and Access → Integrations → App Store Connect
API → +**

- Role: **App Manager**
- Download the `.p8` file. **Apple shows it once.** Losing it means starting
  this step again.
- Note the **Issuer ID** and the **Key ID** from the same page.

## 4. Add the key to Codemagic

**Codemagic → Teams → Integrations → Developer Portal → Add key**

Upload the `.p8`, paste the Issuer ID and Key ID, and name it exactly:

```
sitecheck_asc
```

That name is referenced in `codemagic.yaml` under `integrations`. If you name
it something else, change it there too.

## 5. Add the app in Codemagic and trigger a build

Add the repository, and Codemagic will detect `codemagic.yaml` on its own.

The workflow triggers on tags, so nothing builds until you push one:

```bash
git tag ios-v0.1.0 && git push origin ios-v0.1.0
```

Tag-triggered rather than push-triggered on purpose: every build consumes
macOS minutes and produces a TestFlight build, and you do not want that on
every commit.

## 6. Add yourself as an internal tester

**App Store Connect → your app → TestFlight → Internal Testing**

Internal testing needs **no Beta App Review** — the build is installable as
soon as processing finishes, usually 15–60 minutes after upload. Install
TestFlight on the iPhone and accept the invite.

## What will probably go wrong on the first run

The Swift has never been compiled, so budget for two or three failed builds.
The logs are the artifact you want; `/tmp/xcodebuild_logs/*.log` is published
on every run, pass or fail.

Most likely, in order:

**Swift compile errors in the plugin.** `CAPBridgedPlugin` with a
`pluginMethods` array is Capacitor 6 style; the `raycastQuery` signature and
`bridge.viewController` optionality both vary across SDK versions. Paste the
errors and I will work through them.

**CocoaPods deployment target mismatch.** There is a step that raises the
target to 14.0 because the ARKit plugin requires it and Capacitor generates
13.0. If `pod install` still complains, the `sed` did not match the generated
format — check the step's output, which prints the Podfile line it produced.

**Signing.** `distribution_type: app_store` with automatic signing needs the
bundle id registered *before* the build. Step 2 is not optional.

**Missing app record.** Upload succeeds, then publishing fails because there
is nothing in App Store Connect to receive it.

## Things deliberately left for later

**App icons.** The build ships the Capacitor placeholder. Drop a 1024×1024
PNG at `resources/icon.png` and the workflow generates the full set
automatically — the step is already wired and skips itself until the file
exists. Internal TestFlight does not care; external review will.

**External testers.** `submit_to_testflight: true` distributes to internal
testers only. Do not open it to external groups until the calibration study
says what the tool can honestly claim — see `CALIBRATION.md`.
