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

## 2. Register the bundle id and create the app record

In your Apple Developer account, under **Certificates, Identifiers &
Profiles → Identifiers**, register:

```
com.sitecheck.qc
```

If that identifier is taken, change `appId` in `capacitor.config.ts` and both
`BUNDLE_ID` and `bundle_identifier` in `codemagic.yaml` to match — they must
agree or signing fails late, after the archive has already run.

Then in **App Store Connect → My Apps → +**, create the app record against
that bundle id. TestFlight has nothing to upload into until this exists.

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
