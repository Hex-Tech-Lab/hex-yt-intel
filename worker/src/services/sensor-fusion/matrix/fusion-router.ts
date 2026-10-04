/**
 * S1-S6 sensor-fusion router (ADR 039 §1.1).
 *
 * Deterministic: hard overrides, then pre-rules, then a weighted score over
 * the remaining signals. Class meanings follow docs/architecture/S1_S6_TAXONOMY.md.
 * The weight table is PROPOSED and uncalibrated: it must move to
 * `analysis.layer0.*` registry keys and be fit against the pool before routing
 * production traffic. It is injectable for that reason.
 */

export type FusionRoute = 'S1' | 'S2' | 'S3' | 'S4' | 'S5' | 'S6';

export interface FusionInput {
  turnMarkerCount: number;
  diarizationSpeakerCount: number;
  uiFramesDetected: boolean;
  debateProsodyDetected: boolean;
  /** JEV intensity scores, integers 0-3. */
  directAddressIntensity: number;
  proceduralInstructionIntensity: number;
  tangentialFluffIntensity: number;
}

export interface FusionResult {
  route: FusionRoute;
  confidence: number;
}

type Feature = 'bias' | 'direct' | 'procedural' | 'fluff' | 'multiSpeaker' | 'turns' | 'debate';
export type FusionWeights = Record<FusionRoute, Record<Feature, number>>;

export const ROUTES: readonly FusionRoute[] = ['S1', 'S2', 'S3', 'S4', 'S5', 'S6'];

/** Single-speaker rule: at most this many turn markers routes S1, unless vlog speech is saturated. */
export const MONOLOGUE_MAX_TURN_MARKERS = 5;
/** Direct address AND fluff must both reach this intensity to block S1 (calibrated 2026-10-04). */
export const VLOG_SATURATION_INTENSITY = 3;
/** Turn markers at which the turn-density feature saturates. */
export const TURN_DENSITY_SATURATION = 20;
/** Interview pre-rule: two speakers with at least this many turn markers and no debate. */
export const INTERVIEW_MIN_TURN_MARKERS = 5;
export const PANEL_MIN_SPEAKERS = 3;

export const DEFAULT_FUSION_WEIGHTS: FusionWeights = {
  S1: { bias: 0.6, direct: -1.0, procedural: -0.5, fluff: -1.0, multiSpeaker: -1.5, turns: -1.0, debate: -1.0 },
  S2: { bias: 0.0, direct: -0.5, procedural: -0.5, fluff: -0.5, multiSpeaker: 1.5, turns: 1.5, debate: -1.0 },
  S3: { bias: -0.3, direct: 0.0, procedural: -0.5, fluff: 0.5, multiSpeaker: 1.5, turns: 1.0, debate: 2.0 },
  S4: { bias: -0.3, direct: -0.3, procedural: 2.0, fluff: -0.5, multiSpeaker: 0.0, turns: 0.0, debate: -0.5 },
  S5: { bias: 0.0, direct: -1.0, procedural: -0.5, fluff: -0.5, multiSpeaker: 0.8, turns: -0.8, debate: -0.5 },
  S6: { bias: -0.4, direct: 2.0, procedural: -0.5, fluff: 2.0, multiSpeaker: -0.3, turns: -0.3, debate: -0.5 },
};

/** Confidence reported for rule-based (non-weighted) routes. */
const OVERRIDE_CONFIDENCE = 0.95;
const PRE_RULE_CONFIDENCE = 0.85;

/** Throws unless `value` is an integer JEV intensity in [0, 3]. */
const assertIntensity = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0 || value > 3) {
    throw new RangeError(`${name} must be an integer in [0, 3], got ${value}`);
  }
};

/** Throws unless `value` is a non-negative integer. */
const assertCount = (name: string, value: number): void => {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative integer, got ${value}`);
  }
};

/** Throws RangeError for any out-of-contract count or intensity. */
const validate = (input: FusionInput): void => {
  assertCount('turnMarkerCount', input.turnMarkerCount);
  assertCount('diarizationSpeakerCount', input.diarizationSpeakerCount);
  assertIntensity('directAddressIntensity', input.directAddressIntensity);
  assertIntensity('proceduralInstructionIntensity', input.proceduralInstructionIntensity);
  assertIntensity('tangentialFluffIntensity', input.tangentialFluffIntensity);
};

/** Weighted-sum routing for inputs no hard override or pre-rule claims; confidence is the winner's softmax share. */
const routeByWeights = (input: FusionInput, weights: FusionWeights): FusionResult => {
  const features: Record<Feature, number> = {
    bias: 1,
    direct: input.directAddressIntensity / 3,
    procedural: input.proceduralInstructionIntensity / 3,
    fluff: input.tangentialFluffIntensity / 3,
    multiSpeaker: input.diarizationSpeakerCount >= 2 ? 1 : 0,
    turns: Math.min(input.turnMarkerCount / TURN_DENSITY_SATURATION, 1),
    debate: input.debateProsodyDetected ? 1 : 0,
  };
  const scores = ROUTES.map((route) =>
    (Object.keys(features) as Feature[]).reduce((sum, feature) => sum + weights[route][feature] * features[feature], 0),
  );
  const best = Math.max(...scores);
  // Ties resolve to the lowest class number: indexOf returns the first maximum.
  const route = ROUTES[scores.indexOf(best)] as FusionRoute;
  const total = scores.reduce((sum, score) => sum + Math.exp(score - best), 0);
  return { route, confidence: 1 / total };
};

/** True only when JEV reports saturated vlog-style speech: direct address AND fluff both at the maximum. */
const hasVlogSignals = (input: FusionInput): boolean =>
  input.directAddressIntensity === VLOG_SATURATION_INTENSITY &&
  input.tangentialFluffIntensity === VLOG_SATURATION_INTENSITY;

/** Pre-rule S1: a single speaker with few turns, unless vlog speech is saturated. */
const isMonologue = (input: FusionInput): boolean =>
  input.diarizationSpeakerCount === 1 && input.turnMarkerCount <= MONOLOGUE_MAX_TURN_MARKERS && !hasVlogSignals(input);

/** Pre-rule S3: a panel (3+ speakers) with debate prosody. */
const isPanelDebate = (input: FusionInput): boolean =>
  input.diarizationSpeakerCount >= PANEL_MIN_SPEAKERS && input.debateProsodyDetected;

/** Pre-rule S2: two speakers, dense turn-taking, no debate prosody. */
const isInterview = (input: FusionInput): boolean =>
  input.diarizationSpeakerCount === 2 && input.turnMarkerCount >= INTERVIEW_MIN_TURN_MARKERS && !input.debateProsodyDetected;

/** Deterministic pre-rules (monologue, panel, interview); null when none applies. */
const matchPreRule = (input: FusionInput): FusionRoute | null => {
  if (isMonologue(input)) return 'S1';
  if (isPanelDebate(input)) return 'S3';
  if (isInterview(input)) return 'S2';
  return null;
};

/** Routes one video to S1-S6 from fused sensor signals. Throws RangeError on invalid input. */
export const routeFusion = (input: FusionInput, weights: FusionWeights = DEFAULT_FUSION_WEIGHTS): FusionResult => {
  validate(input);

  // 1. Hard overrides.
  if (input.uiFramesDetected) return { route: 'S4', confidence: OVERRIDE_CONFIDENCE };

  // 2. Deterministic pre-rules.
  const preRule = matchPreRule(input);
  if (preRule) return { route: preRule, confidence: PRE_RULE_CONFIDENCE };

  // 3. Weighted sum for everything else.
  return routeByWeights(input, weights);
};
