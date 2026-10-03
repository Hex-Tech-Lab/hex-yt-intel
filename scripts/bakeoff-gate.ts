/**
 * ADR 038 §4b frozen-pool gate — pure enablement-bar evaluator.
 *
 * Preregistered 2026-10-03, before any R6 run (ADR 038 §4b). Evaluated per
 * candidate arm independently: GLM-only, GLM→OSS, and the full Jev-gated path
 * each pass or fail on their own; no arm passes on another arm's results.
 *
 * All scores are 0–100 per video (median over that video's dimensions).
 * "Regression vs Haiku" = haiku − arm, per video, per metric.
 */

export interface VideoArmScores {
  videoId: string;
  /** Factual-parity median over the video's dimensions (0–100). */
  factual: number;
  /** Style-parity median over the video's dimensions (0–100). */
  style: number;
}

export interface GateInput {
  /** Per-video scores for this candidate arm (exactly 14 for the frozen pool). */
  arm: VideoArmScores[];
  /** Per-video scores for the haiku reference arm, same video set. */
  haiku: VideoArmScores[];
}

export interface GateResult {
  pass: boolean;
  /** Videos jointly meeting factual >= 90 AND style >= 85. */
  jointPassCount: number;
  totalVideos: number;
  /** Medians over all per-video values. */
  medianFactual: number;
  medianStyle: number;
  /** Worst per-video scores. */
  worstFactual: number;
  worstStyle: number;
  /** Worst paired regression vs haiku (haiku − arm; > 10 fails). */
  worstFactualRegression: number;
  worstStyleRegression: number;
  /** Human-readable failing clause(s); empty when pass. */
  failures: string[];
}

export const GATE_JOINT_MIN = 12; // of 14 videos
export const GATE_TOTAL = 14;
export const GATE_FACTURAL_MIN = 90;
export const GATE_STYLE_MIN = 85;
export const GATE_WORST_FACTUAL_MIN = 80;
export const GATE_WORST_STYLE_MIN = 75;
export const GATE_MAX_REGRESSION = 10;

export function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[mid - 1]! + s[mid]!) / 2 : s[mid]!;
}

function byId(rows: VideoArmScores[]): Map<string, VideoArmScores> {
  return new Map(rows.map(r => [r.videoId, r]));
}

export function evaluateGate(input: GateInput): GateResult {
  const armById = byId(input.arm);
  const haikuById = byId(input.haiku);
  const videoIds = [...new Set([...armById.keys(), ...haikuById.keys()])];

  const factuals: number[] = [];
  const styles: number[] = [];
  const regressions: { videoId: string; factual: number; style: number }[] = [];
  const missing: string[] = [];
  let jointPassCount = 0;

  for (const id of videoIds) {
    const arm = armById.get(id);
    const haiku = haikuById.get(id);
    if (!arm || !haiku) {
      missing.push(id);
      regressions.push({ videoId: id, factual: 0, style: 0 });
      continue; // unverifiable video — the gate cannot pass on missing data
    }
    factuals.push(arm.factual);
    styles.push(arm.style);
    if (arm.factual >= GATE_FACTURAL_MIN && arm.style >= GATE_STYLE_MIN) jointPassCount++;
    regressions.push({
      videoId: id,
      factual: haiku.factual - arm.factual,
      style: haiku.style - arm.style,
    });
  }

  const medianFactual = median(factuals);
  const medianStyle = median(styles);
  const worstFactual = factuals.length ? Math.min(...factuals) : 0;
  const worstStyle = styles.length ? Math.min(...styles) : 0;
  const worstFactualRegression = Math.max(...regressions.map(r => r.factual), 0);
  const worstStyleRegression = Math.max(...regressions.map(r => r.style), 0);

  const failures: string[] = [];
  if (missing.length > 0) failures.push(`missing per-video scores for: ${missing.join(', ')}`);
  if (jointPassCount < GATE_JOINT_MIN) {
    failures.push(`joint pass ${jointPassCount}/${videoIds.length} < ${GATE_JOINT_MIN}/${GATE_TOTAL} (need factual>=${GATE_FACTURAL_MIN} AND style>=${GATE_STYLE_MIN})`);
  }
  if (medianFactual < GATE_FACTURAL_MIN) failures.push(`median factual ${medianFactual} < ${GATE_FACTURAL_MIN}`);
  if (medianStyle < GATE_STYLE_MIN) failures.push(`median style ${medianStyle} < ${GATE_STYLE_MIN}`);
  if (worstFactual < GATE_WORST_FACTUAL_MIN) failures.push(`worst-case factual ${worstFactual} < ${GATE_WORST_FACTUAL_MIN}`);
  if (worstStyle < GATE_WORST_STYLE_MIN) failures.push(`worst-case style ${worstStyle} < ${GATE_WORST_STYLE_MIN}`);
  if (worstFactualRegression > GATE_MAX_REGRESSION) {
    failures.push(`factual regression vs haiku ${worstFactualRegression} > ${GATE_MAX_REGRESSION}`);
  }
  if (worstStyleRegression > GATE_MAX_REGRESSION) {
    failures.push(`style regression vs haiku ${worstStyleRegression} > ${GATE_MAX_REGRESSION}`);
  }

  return {
    pass: failures.length === 0,
    jointPassCount,
    totalVideos: videoIds.length,
    medianFactual,
    medianStyle,
    worstFactual,
    worstStyle,
    worstFactualRegression,
    worstStyleRegression,
    failures,
  };
}
