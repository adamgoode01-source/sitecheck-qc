# LiDAR Site Check — Expo Go test shell

A thin WebView wrapper around the real app, so it can be launched from Expo Go
on an iPhone without a Mac and without a build.

## What this is for

Testing the **field interface**: sunlight legibility, tap targets with gloves,
safe areas around the notch, one-handed use, how the capture flow reads on a
real screen.

## What it cannot do

**It cannot measure anything.**

Expo Go is a fixed, prebuilt binary from the App Store containing only the
modules Expo shipped inside it. It cannot load custom native code, so the
ARKit plugin is unavailable — and Expo removed its own AR support years ago.
No amount of restructuring changes this.

The tape calibration study still needs a real iOS build from a Mac. See the
root README.

Because it is a WebView, this shell is functionally Safari-in-a-wrapper. What
it adds over Safari is a standalone launcher, no browser chrome, and a
remembered server address.

## Why a WebView and not a React Native port

A port would mean a second UI codebase — eight screens reimplemented in React
Native — that still could not measure, and that would drift out of sync with
the real app within a week. The domain core (`src/domain/`) is pure TypeScript
with no platform imports and *would* port unchanged if you ever genuinely
wanted React Native, but the UI is not worth duplicating for a test harness.

## SDK version is pinned to 54 on purpose

Expo Go supports exactly **one** SDK at a time, and the App Store hands you the
newest Expo Go your *iOS version* allows — which is often not the newest one
that exists. So "I have the latest Expo Go" and "my Expo Go runs the latest
SDK" are different statements, and the gap between them produces
`project is incompatible with this version of Expo Go`.

This project was scaffolded on SDK 57 and pinned back to **54** to match the
test device. If you move to a phone with a newer Expo Go, you must move the
project too — Expo Go 57 will not run an SDK 54 project any more than the
reverse.

To re-target:

```bash
npm install expo@~<sdk>.0.0 && npx expo install --fix
```

Then confirm the dev server agrees before scanning anything:

```bash
curl -H "expo-platform: ios" -H "Accept: application/expo+json" http://localhost:8081/
```

The `runtimeVersion` in the response reads `exposdk:<sdk>.0.0`. That is the
number Expo Go checks.

## Running it

**1. Start the web app on the Windows machine**, bound to the network:

```bash
npm run dev:lan
```

Note the `Network:` address it prints, e.g. `http://192.168.1.101:5174`.
Windows Firewall will prompt on first connection — allow it on **private**
networks.

**2. Start Expo**, from this folder:

```bash
npx expo start
```

**3. On the iPhone**, install **Expo Go** from the App Store, then scan the QR
code from the terminal with the Camera app. Both devices must be on the same
Wi-Fi.

**4. Nothing to type.** The shell derives the web app's address from wherever
Metro is served from — `Constants.expoConfig.hostUri` is the dev machine, by
definition — and goes straight in. The ⚙ at bottom-left overrides it if you
need a different host.

### When the dev machine changes IP

It will, sooner or later: DHCP hands out a new lease and every hard-coded
address dies at once — the QR, and the address saved on the phone. That is why
the default is detected rather than stored.

If a stale saved address is in play, the error sheet offers **Use
&lt;detected host&gt;** as its first button, which resets to the current one in a
tap. The QR itself still has to be regenerated: `npx expo start` prints a fresh
one.

## If it does not load

The error sheet names the cause, but in practice it is almost always one of:

- **The dev server is not running**, or was started with `npm run dev` rather
  than `npm run dev:lan` — the plain one binds to localhost only and is
  invisible to the phone.
- **Windows Firewall** is blocking the port on the private network.
- **Different networks** — phone on cellular, or the laptop on a guest VLAN.
  Many corporate and guest Wi-Fi networks block device-to-device traffic
  entirely, in which case use a phone hotspot for both.
- **Plain HTTP.** Expo Go permits it, but a future standalone build would not
  without the ATS exception already declared in `app.json` — note that
  `infoPlist` entries have no effect under Expo Go itself, which uses its own.

## Storage

The app is entirely IndexedDB-backed. WKWebView provides IndexedDB for
`http(s)` origins, which is why this loads over the network rather than from a
bundled file — a `file://` origin gets no persistent storage, so bundling the
built app offline is not viable here.

That means inspections recorded in this shell live in the WebView's store,
separate from anything in Safari. Do not treat it as a place to keep real work.
