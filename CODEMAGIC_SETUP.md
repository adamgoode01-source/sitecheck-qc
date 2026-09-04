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

## 4. Add the credentials to Codemagic as a variable group

Not as a "Developer Portal integration". That route needs a name to match
exactly *and* the integration to be enabled on the specific app, and when
either is wrong the build fails with `App Store Connect integration "..."
does not exist` — which does not tell you which of the two it is. Environment
variables have one place to get right instead of two.

In Codemagic, open your app → **Environment variables** (on the app's settings
page, alongside the build configuration).

Create **four** variables, all in a group named exactly `appstore`, all marked
**Secure**.

The right-hand column below says *where to copy each value from*. It is not
the value — do not paste this text into Codemagic.

| Variable name | Copy its value from |
|---|---|
| `APP_STORE_CONNECT_ISSUER_ID` | the `Issuer ID:` line above the key table, App Store Connect → Users and Access → Integrations → App Store Connect API |
| `APP_STORE_CONNECT_KEY_IDENTIFIER` | the **Key ID** column of your key's row in that same table |
| `APP_STORE_CONNECT_PRIVATE_KEY` | the whole `AuthKey_*.p8` file, opened in a text editor |
| `CERTIFICATE_PRIVATE_KEY` | the whole `signing_key_base64.txt` file |

Each value should look like this when pasted:

| Variable | Looks like |
|---|---|
| `APP_STORE_CONNECT_ISSUER_ID` | `69a6de70-1a2b-3c4d-5e6f-7890abcdef12` |
| `APP_STORE_CONNECT_KEY_IDENTIFIER` | `2X9R4HXF34` |
| `APP_STORE_CONNECT_PRIVATE_KEY` | `-----BEGIN PRIVATE KEY-----` … several lines … `-----END PRIVATE KEY-----` |
| `CERTIFICATE_PRIVATE_KEY` | one long line of base64, ~2,200 characters, no spaces |

None of them contains a space or a bracket. The build rejects any that do,
because that means descriptive text was pasted instead of a credential.

### The first two are easy to confuse

They come from the same page but are different things, and Apple answers a
mix-up with an opaque 401 rather than saying which is wrong.

**Key ID** — exactly 10 characters, on the key's own row. The file downloads
as `AuthKey_XXXXXXXXXX.p8`, and the Key ID is *only* the part between the
underscore and the extension. `AuthKey_XXXXXXXXXX` is 18 characters and is
wrong.

**Issuer ID** — a 36-character UUID like
`1a2b3c4d-5e6f-7890-abcd-ef1234567890`. It identifies the whole team, is shown
**once at the top of the page** above the list of keys, and has nothing to do
with any individual key or its filename.

The build checks both lengths before it calls Apple, and prints their shape
with letters and digits replaced by `X`, so a stray prefix or quote is visible
without exposing the value.

### The fourth one catches people out

The first three authenticate you *to* Apple. The fourth is different: a
distribution certificate is a public key that Apple signs, and the matching
**private** key is generated by you and never leaves your side. Apple cannot
supply it, so without it `fetch-signing-files --create` has nothing to bind a
certificate to. It reports

```
Cannot save Signing Certificates without certificate private key
```

creates no provisioning profile, and still exits successfully — so the failure
only appears much later as `"App" requires a provisioning profile`.

Generate one once. Both flags matter:

```bash
openssl genrsa -traditional -out signing_key.pem 2048
```

`-traditional` because OpenSSL 3 otherwise emits PKCS#8
(`-----BEGIN PRIVATE KEY-----`) and the CLI requires PKCS#1
(`-----BEGIN RSA PRIVATE KEY-----`).

Then strip carriage returns and encode it, because OpenSSL on Windows writes
CRLF and PEM parsers reject it:

```bash
tr -d '\r' < signing_key.pem > k && mv k signing_key.pem
```

```bash
base64 -w 0 signing_key.pem > signing_key_base64.txt
```

**Paste the base64, not the PEM.** It is a single line with no whitespace and
no line endings, so nothing a web form or a text editor does can corrupt it in
transit. The raw PEM failed twice on exactly that, and the only diagnostic
offered was `Not a valid certificate private key` with the value masked in the
log — nothing to inspect.

The build decodes it, checks the first line reads `BEGIN RSA PRIVATE KEY`, and
stops with a specific message if not.

**Reuse the same key for every build.** Generating a fresh one each time
creates a new distribution certificate each time, and Apple allows three per
account — three builds and you are locked out until you revoke some. Keep a
copy in a password manager; `*.pem` is gitignored so it will never be
committed.

For the private key, open the `.p8` in a text editor and paste everything,
including the `-----BEGIN PRIVATE KEY-----` and `-----END PRIVATE KEY-----`
lines. Multi-line values are fine. Tick **Secure** on all three so they are
masked in logs.

The variable names and the group name are both matched literally by
`codemagic.yaml`. The workflow checks all three are present before it touches
any signing tool, so a missing one fails in seconds with a message naming it,
rather than deep inside a signing error.

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
