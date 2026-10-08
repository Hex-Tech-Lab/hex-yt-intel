/**
 * Phase C shadow run (2026-10-08). Executes the Epistemic pipeline for one
 * analysis in the background, alongside the legacy dimension stream, when
 * Vercel granted it via a signed `analysis.pipeline.epistemic` decision (see
 * web/lib/config/epistemic-shadow.ts). Never touches the live SSE response.
 *
 * Wiring:
 *  - JevTextParser scores the transcript; its intensities feed the
 *    dispatcher's routeFusion input (zero intensities on Jev failure, which
 *    the router already treats as the neutral default).
 *  - persistGhostRow is injected so Part A's grounded claims are flushed as
 *    soon as they exist; the final result (claims, unknowns, degraded sensors)
 *    is written again when the run completes. Both writes go to Vercel over a
 *    bound S2S signature (the worker has no DB access, ADR 005).
 */
import * as Sentry from "@sentry/cloudflare";
import { canonicalJson } from "../../../web/lib/utils/canonical-json";
import { signEpistemicClaims } from "../../../web/lib/config/epistemic-shadow";
import { EpistemicPipelineDispatcher } from "./EpistemicPipelineDispatcher";
import { JevTextParser } from "./sensor-fusion/heuristics/jev-text-parser";
import type { GroundedExtractionPayload } from "../types/grounded-extraction";
import type { LLMCascadePort } from "../ports/LLMCascadePort";
import type { PromptBuilderPort } from "../ports/PromptBuilderPort";

/** How long a grounded-claims persist signature stays valid. */
const CLAIMS_SIG_TTL_MS = 5 * 60 * 1000;

export interface EpistemicShadowParams {
  analysisId: string;
  videoId: string;
  title?: string;
  transcript: string;
  durationSeconds: number;
  appUrl: string;
  signingSecret: string;
  openRouterApiKey: string;
  promptBuilder: PromptBuilderPort;
  cascade: LLMCascadePort;
  fetchImpl?: typeof fetch;
}

/** Body sent to Vercel's /api/analyses/[id]/grounded-claims route. */
export interface GroundedClaimsPersistBody {
  analysisId: string;
  groundedClaims: GroundedExtractionPayload;
  degradedSensors: boolean;
  exp: number;
  contentSig: string;
}

/** Canonical signed content for a grounded-claims persist (must match the Vercel verifier). */
export function groundedClaimsCanonical(analysisId: string, groundedClaims: GroundedExtractionPayload, degradedSensors: boolean): string {
  return canonicalJson({ analysisId, groundedClaims, degradedSensors });
}

/** Signs and POSTs one grounded-claims write to Vercel; resolves false on rejection. */
async function persistGroundedClaims(
  params: EpistemicShadowParams,
  groundedClaims: GroundedExtractionPayload,
  degradedSensors: boolean,
): Promise<boolean> {
  const exp = Date.now() + CLAIMS_SIG_TTL_MS;
  const canonical = groundedClaimsCanonical(params.analysisId, groundedClaims, degradedSensors);
  const contentSig = await signEpistemicClaims(params.signingSecret, params.analysisId, exp, canonical);
  const body: GroundedClaimsPersistBody = { analysisId: params.analysisId, groundedClaims, degradedSensors, exp, contentSig };
  const res = await (params.fetchImpl ?? fetch)(
    `${params.appUrl.replace(/\/+$/, "")}/api/analyses/${encodeURIComponent(params.analysisId)}/grounded-claims`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) },
  );
  if (!res.ok) {
    await res.body?.cancel();
    console.error("[EpistemicShadow] grounded-claims persist rejected", { analysisId: params.analysisId, status: res.status });
    return false;
  }
  await res.body?.cancel();
  return true;
}

/** Runs the shadow pipeline end to end. Never throws: failures are logged and reported to Sentry. */
export async function runEpistemicShadow(params: EpistemicShadowParams): Promise<void> {
  try {
    let intensities = { direct: 0, procedural: 0, fluff: 0 };
    try {
      const heuristics = await new JevTextParser(params.openRouterApiKey).analyze(params.transcript);
      intensities = {
        direct: heuristics.direct_address_intensity,
        procedural: heuristics.procedural_instruction_intensity,
        fluff: heuristics.tangential_fluff_intensity,
      };
    } catch (error) {
      console.error("[EpistemicShadow] JEV text heuristics failed; routing with neutral intensities", error);
    }

    // The partial write is tracked so the final write is always sent after it:
    // otherwise a slow partial could land last and reset degradedSensors.
    let partialWrite: Promise<boolean> = Promise.resolve(true);
    const dispatcher = new EpistemicPipelineDispatcher({ promptBuilder: params.promptBuilder, cascade: params.cascade });
    const result = await dispatcher.dispatchAnalysis({
      analysisId: params.analysisId,
      videoId: params.videoId,
      title: params.title,
      transcript: params.transcript,
      durationSeconds: params.durationSeconds,
      directAddressIntensity: intensities.direct,
      proceduralInstructionIntensity: intensities.procedural,
      tangentialFluffIntensity: intensities.fluff,
      // Part A flush: persist grounded claims as soon as extraction succeeds.
      persistGhostRow: (payload) => {
        partialWrite = persistGroundedClaims(params, payload, false);
        return partialWrite;
      },
    });
    await partialWrite.catch(() => false);

    // Final write carries the sensor-degradation verdict from the completed run.
    await persistGroundedClaims(params, result.groundedExtraction, result.classification.degradedSensors === true);
    console.log("[EpistemicShadow] completed", {
      analysisId: params.analysisId,
      route: result.classification.route,
      claims: result.groundedExtraction.claims.length,
      projections: result.projectiveSynthesis ? "yes" : "no",
      latencyMs: result.latencyMs,
    });
  } catch (error) {
    console.error("[EpistemicShadow] run failed", { analysisId: params.analysisId, error });
    Sentry.captureException(error, { tags: { operation: "epistemic-shadow" }, extra: { analysisId: params.analysisId } });
  }
}
