/**
 * Calibration statistics.
 *
 * Turns a set of app-versus-tape trials into the two numbers that decide
 * whether this tool is fit to inspect anything:
 *
 *   Bias      — does it read consistently long or short? A steady offset is
 *               the good outcome, because a constant can be subtracted.
 *   Precision — how far readings scatter around that. This cannot be
 *               corrected away, and it is what decides usability.
 *
 * The verdict is adapted from gauge R&R, the standard question in
 * manufacturing: how much of the tolerance band does the measuring instrument
 * itself consume? An instrument whose spread approaches the tolerance it
 * polices produces false passes and false fails in roughly equal numbers,
 * however precise its display looks.
 *
 * All lengths are INCHES.
 */

/** Below this, the standard deviation is too unstable to draw conclusions from. */
export const MIN_TRUSTWORTHY_SAMPLE = 20;

export interface TrialStats {
  n: number;
  /** Mean signed deviation — the bias. */
  meanIn: number;
  /** Sample standard deviation (n-1). Zero when n < 2. */
  sdIn: number;
  minIn: number;
  maxIn: number;
  /** Largest absolute deviation seen. */
  worstIn: number;
  /** mean - 2 SD. */
  ci95LowIn: number;
  /** mean + 2 SD. */
  ci95HighIn: number;
  /** Width of the 95% interval, i.e. 4 SD. The number the verdict uses. */
  spread95In: number;
  /** False until there are enough trials for the spread to mean anything. */
  sufficientSample: boolean;
}

export function summariseTrials(deviations: readonly number[]): TrialStats | null {
  const n = deviations.length;
  if (n === 0) return null;

  const meanIn = deviations.reduce((sum, d) => sum + d, 0) / n;

  // Sample standard deviation: these trials are a sample of the tool's
  // behaviour, not the whole population of readings it will ever produce.
  const sdIn =
    n < 2
      ? 0
      : Math.sqrt(deviations.reduce((sum, d) => sum + (d - meanIn) ** 2, 0) / (n - 1));

  const spread95In = 4 * sdIn;

  return {
    n,
    meanIn,
    sdIn,
    minIn: Math.min(...deviations),
    maxIn: Math.max(...deviations),
    worstIn: deviations.reduce((worst, d) => Math.max(worst, Math.abs(d)), 0),
    ci95LowIn: meanIn - 2 * sdIn,
    ci95HighIn: meanIn + 2 * sdIn,
    spread95In,
    sufficientSample: n >= MIN_TRUSTWORTHY_SAMPLE,
  };
}

export type GaugeVerdict = 'excellent' | 'usable' | 'marginal' | 'screening-only';

export interface GaugeAssessment {
  /** Tool spread as a fraction of the tolerance band it must police. */
  ratio: number;
  percentOfBand: number;
  verdict: GaugeVerdict;
  headline: string;
  detail: string;
}

/**
 * Judge the tool against a tolerance.
 *
 * `toleranceIn` is the plus-or-minus figure, so a +/-1/4" tolerance has a band
 * of 1/2". The comparison is the tool's 95% spread against that whole band.
 */
export function assessAgainstTolerance(
  stats: TrialStats,
  toleranceIn: number,
): GaugeAssessment | null {
  const band = Math.abs(toleranceIn) * 2;
  if (!(band > 0)) return null;

  const ratio = stats.spread95In / band;
  const percentOfBand = ratio * 100;

  if (ratio < 0.1) {
    return {
      ratio,
      percentOfBand,
      verdict: 'excellent',
      headline: 'Comfortably fit for this tolerance',
      detail:
        'The tool consumes under a tenth of the tolerance band. Readings can be treated as the measurement.',
    };
  }

  if (ratio < 0.3) {
    return {
      ratio,
      percentOfBand,
      verdict: 'usable',
      headline: 'Fit for this tolerance',
      detail:
        'The tool consumes less than a third of the tolerance band, which is the usual threshold for an instrument being fit to inspect against it.',
    };
  }

  if (ratio < 1) {
    return {
      ratio,
      percentOfBand,
      verdict: 'marginal',
      headline: 'Usable, but confirm every close call',
      detail:
        'The tool eats a substantial part of the tolerance band. Clear failures are real, but anything within its own error of the limit has to be confirmed with a tape before it is called.',
    };
  }

  return {
    ratio,
    percentOfBand,
    verdict: 'screening-only',
    headline: 'Screening only — do not issue deficiencies from this',
    detail:
      'The tool’s own error is as large as the tolerance it would be policing, so a pass and a fail are not reliably distinguishable. It can still find gross errors and missing members. Widen the tolerance, shorten the working distance, or change what the app claims.',
  };
}

export interface ConfidenceSplit {
  lowCount: number;
  highCount: number;
  /** Mean absolute deviation of trials the app flagged as low confidence. */
  lowMeanAbsIn: number | null;
  highMeanAbsIn: number | null;
  /** True when flagged trials really are meaningfully worse. */
  predictive: boolean | null;
  summary: string;
}

/**
 * Does the app's own confidence flag predict error?
 *
 * A real question about the product, not just the sensor. If flagged captures
 * are genuinely the bad ones, that warning is worth leaning on harder. If the
 * error is the same either way, the confidence reporting is decoration and
 * should be fixed or removed rather than left to imply a reliability it does
 * not have.
 */
export function assessConfidenceSignal(
  trials: readonly { deviationIn: number; lowConfidence: boolean }[],
): ConfidenceSplit {
  const low = trials.filter((t) => t.lowConfidence).map((t) => Math.abs(t.deviationIn));
  const high = trials.filter((t) => !t.lowConfidence).map((t) => Math.abs(t.deviationIn));

  const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
  const lowMeanAbsIn = mean(low);
  const highMeanAbsIn = mean(high);

  if (low.length < 3 || high.length < 3 || lowMeanAbsIn === null || highMeanAbsIn === null) {
    return {
      lowCount: low.length,
      highCount: high.length,
      lowMeanAbsIn,
      highMeanAbsIn,
      predictive: null,
      summary:
        'Not enough trials in both groups yet to tell whether the confidence flag means anything.',
    };
  }

  // A flag that barely moves the error is not carrying information worth
  // showing a user; 1.5x is a low bar it should clear easily if it works.
  const predictive = lowMeanAbsIn > highMeanAbsIn * 1.5;

  return {
    lowCount: low.length,
    highCount: high.length,
    lowMeanAbsIn,
    highMeanAbsIn,
    predictive,
    summary: predictive
      ? 'Flagged captures really are the worse ones — the confidence warning is carrying real information.'
      : 'Flagged and unflagged captures have similar error. The confidence warning is not predicting anything and should be fixed or removed.',
  };
}
