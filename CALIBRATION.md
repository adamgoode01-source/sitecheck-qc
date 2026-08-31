# Calibration study: is this tool accurate enough to use?

The go/no-go. Everything else in this project is worthless if the answer is no,
and you cannot tell from a handful of readings that "looked about right".

## What you are actually measuring

Two different things, and they have different consequences:

**Bias** — does it read consistently long or short? A steady +1/8" is the
*good* outcome: it is a constant, and constants can be subtracted in software.

**Precision** — how much does the same measurement wander when you repeat it?
This is the one that decides whether the tool is usable, and it cannot be
corrected away.

You need both, which means **repeats**. Three readings tell you nothing about
spread. Twenty start to.

## The decision rule, before you start

Borrowed from gauge R&R, which is how manufacturing decides whether an
instrument is fit to inspect a tolerance:

> A measurement system should consume only a small fraction of the tolerance
> band it is policing. Under 10% is excellent, under 30% is usable, past that
> you get false fails and false passes in roughly equal measure.

For framing at ±1/4", the tolerance band is 0.5". At the 30% line, the tool's
95% error spread must be under **0.15"** — which means a standard deviation
under about **1/26"**.

Be prepared for that to be hard. A LiDAR iPhone is typically good to a few
millimetres at close range, and a few millimetres is already 1/8". Plausible
outcomes:

| Measured σ | 95% error | What it means |
|---|---|---|
| ~1/32" | ±1/16" | Usable for ±1/4" work. Ship it. |
| ~1/16" | ±1/8" | Borderline. Usable, but every borderline call needs a tape. |
| ~1/8" | ±1/4" | The tool's error equals the tolerance. **Screening only** — good for finding candidates and catching gross errors like missing members, not for issuing deficiencies. |
| worse | — | Not viable for spacing. Might still earn its place on missing-member and gross-layout checks. |

The middle two are not failures. They are a product decision: the app becomes
"find the suspects, confirm with a tape" rather than "issue the deficiency".
Deciding that *before* a crew relies on it is the entire point of this
exercise.

## Build a reference target

Do not calibrate against real studs. You need to know the truth to a precision
better than what you are testing, and site framing is not that.

Take a straight board or a factory edge of MDF, and mark at 0, 16, 32, 48, 64,
80, 96 inches.

- **Pull every mark from the same zero.** Never measure end to end and stack
  them — that accumulates the tape's error into the layout you are trying to
  trust.
- **Burn an inch.** Measure from the 1" graduation and subtract, rather than
  from the hook. The sliding hook is loose by its own thickness by design —
  around 1/16", which is a quarter of the tolerance you are testing.
- Mark with a knife or a sharp 0.5mm pencil, not a carpenter's pencil. Use a
  square to carry the mark onto the face you will be tapping.
- Check three of the marks with a second tape or a folding rule. If they
  disagree by more than 1/32", redo the layout before going further.

A decent steel tape is good to well under 1/32" over these spans. Your marking
technique, not the tape, is the limit.

## Protocol

### Block A — baseline, 20 trials

One condition, repeated: **4 ft away, square-on, good indoor light, matte
timber.** Measure the 0→16" span.

This single block gives you bias and precision, which are the two numbers that
decide everything.

**Restart the AR session between every trial.** Back out of the capture and
re-enter. ARKit accumulates drift within a session, so twenty taps in one
session measures one session's error twenty times — not twenty independent
errors. Restarting is also what actually happens in the field.

### Block B — one factor at a time, 8 trials each

Change one thing from baseline, leave everything else alone:

| Factor | Levels to test |
|---|---|
| Distance | 2 ft, 8 ft, 12 ft |
| Angle | ~30° off square |
| Light | dim interior, direct sun |
| Surface | dark or black, glossy or wet |
| Span | 0→96" instead of 0→16" |

That is roughly 84 trials all told, about two hours. Skip a factor only if you
are certain it never occurs on your jobs.

### Block C — the two checks with their own error sources

**Cover.** Set bars a known clear distance off a flat face and measure. This
has a failure mode the spacing checks do not: the far-crown hit convention. If
the convention is wrong the whole set is biased by a full bar diameter — 5/8"
on a #5, larger than the entire tolerance. A consistent offset of about one bar
diameter in your results means the convention setting is wrong, not the sensor.

**Cumulative drift.** Lay out all seven marks at 16" and run one capture across
the whole board. The app should report near-zero drift. If it reports drift on
a layout you know is straight, the headline feature produces false positives.

## Use the built-in calibration mode

**Settings → Calibration study.** It does the arithmetic as you go, so the
go/no-go answer is visible on the twentieth trial rather than after an evening
in a spreadsheet.

Create a session with the true distance and the tolerance you are judging
against, set the conditions for the block you are running, and hit **Capture
trial** repeatedly. It shows bias, standard deviation, the 95% interval, and
the share of the tolerance band the tool is consuming — with the verdict from
the table above attached.

One session per block: "Baseline 4ft", "Sun 8ft", and so on. Comparing whole
sessions is how the factor sweep gets read.

It also tracks whether the app's own confidence flag predicted the bad
captures, and says so plainly when it did not.

Export CSV when done. The summary answers the decision; the raw trials are the
evidence behind whatever accuracy the app ends up claiming.

## Record per trial

The app already captures most of this — note it alongside your tape reading:

- Measured value, true value, deviation
- Distance, angle, light, surface
- **Whether the app flagged low confidence or limited tracking**

That last one is worth analysing separately, because it answers a question
about the app itself: **does its confidence flag actually predict error?** If
low-confidence captures really are the bad ones, that warning is a feature
worth leaning on harder. If error is the same either way, the confidence
reporting is decoration and should be fixed or removed.

## Analysis

For Block A:

- **Mean deviation** = bias. Consistent? Then it is correctable — tell me the
  number and I will add the offset.
- **Standard deviation** = precision. Compare against the table above.
- **95% interval** ≈ mean ± 2σ. This is the honest accuracy claim, and it is
  what belongs on the report in place of the current wording.

For Block B, compare each cell's mean and σ against baseline. Any factor that
materially widens σ becomes a documented limitation — "do not measure past
8 ft", "do not measure into direct sun" — and ideally a runtime warning.

## What to do with the result

Whatever the numbers say, they replace the accuracy note in
`src/measurement/arkit.ts`, which is currently an educated guess. That string
is printed on every report, so it needs to be a measurement, not a hope.

If the tool lands in the "screening only" band, the honest response is to
change what the app claims: findings become "check this with a tape" rather
than deficiencies, and the report says so. That is still a useful product. It
is only a failure if you ship it claiming more than it can do.
