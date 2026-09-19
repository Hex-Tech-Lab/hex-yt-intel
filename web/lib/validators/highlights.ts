import { z } from "zod";

export const HighlightSegmentSchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const raw = val as Record<string, unknown>;
    const start = raw.start ?? raw.start_time ?? raw.startTime ?? raw.timestamp;
    const end = raw.end ?? raw.end_time ?? raw.endTime;
    const title = raw.title ?? raw.label ?? raw.headline ?? raw.key_point;
    const summary = raw.summary ?? raw.description ?? raw.text ?? "";

    const numStart = typeof start === "number" ? start : typeof start === "string" ? Number(start.trim()) : 0;
    let numEnd = typeof end === "number" ? end : typeof end === "string" ? Number(end.trim()) : numStart + 15;

    const cleanStart = Number.isFinite(numStart) && numStart >= 0 ? numStart : 0;
    if (!Number.isFinite(numEnd) || numEnd <= cleanStart) {
      numEnd = cleanStart + 15;
    }

    return {
      ...raw,
      start: cleanStart,
      end: numEnd,
      title: typeof title === "string" && title.trim() !== "" ? title.trim() : "Key Insight",
      summary: typeof summary === "string" ? summary.trim() : "",
    };
  },
  z.object({
    id: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    title: z.string().min(1),
    summary: z.string().optional(),
    // Required-but-nullable (not passthrough-only, not optional) so the
    // response's camelCase wire contract with HighlightsScrubber is pinned
    // AND enforced where the boundary is validated. RCA 2026-09-13: these
    // two keys silently dropped to snake_case in PR #281's route rewrite --
    // exactly the drift an implicit passthrough-only field cannot catch.
    // P2b (PR #312 post-merge review): `.optional()` was still not enough —
    // a future regression back to snake_case-only objects (snake_case keys
    // survive `.passthrough()`) would pass validation silently again. The
    // keys are now REQUIRED: presence is enforced, `null` (legitimately no
    // excerpt stored for this keypoint) stays valid. The route is the only
    // runtime producer and always emits both keys.
    verbatimExcerpt: z.string().nullable(),
    takeawayIdx: z.number().int().nullable(),
  }).passthrough().refine((data) => data.end > data.start, {
    message: 'end timestamp must be greater than start timestamp',
  })
);

export const HighlightsResponseSchema = z.object({
  analysisId: z.string(),
  highlights: z.array(HighlightSegmentSchema),
});
