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
    let numEnd = typeof end === "number" ? end : typeof end === "string" ? Number(end.trim()) : numStart + 30;

    const cleanStart = Number.isFinite(numStart) && numStart >= 0 ? numStart : 0;
    if (!Number.isFinite(numEnd) || numEnd <= cleanStart) {
      numEnd = cleanStart + 30;
    }

    const rawParentIdx = raw.parent_takeaway_idx ?? raw.takeaway_idx ?? raw.takeawayIdx ?? raw.parentTakeawayIdx;
    let parent_takeaway_idx: number | undefined = undefined;
    if (typeof rawParentIdx === 'number' && Number.isInteger(rawParentIdx) && rawParentIdx >= 0) {
      parent_takeaway_idx = rawParentIdx;
    } else if (typeof rawParentIdx === 'string' && rawParentIdx.trim() !== '') {
      const parsed = Number(rawParentIdx.trim());
      if (Number.isFinite(parsed) && Number.isInteger(parsed) && parsed >= 0) parent_takeaway_idx = parsed;
    }

    return {
      ...raw,
      start: cleanStart,
      end: numEnd,
      title: typeof title === "string" && title.trim() !== "" ? title.trim() : "Key Insight",
      summary: typeof summary === "string" ? summary.trim() : "",
      parent_takeaway_idx,
    };
  },
  z.object({
    id: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    title: z.string().min(1),
    summary: z.string().optional(),
    parent_takeaway_idx: z.number().int().min(0).optional(),
    takeaway_idx: z.number().int().min(0).optional(),
    takeawayIdx: z.number().int().min(0).optional(),
  }).passthrough().refine((data) => data.end > data.start, {
    message: 'end timestamp must be greater than start timestamp',
  })
);

export const HighlightsResponseSchema = z.object({
  analysisId: z.string(),
  highlights: z.array(HighlightSegmentSchema),
});
