import { z } from "zod";

export const HighlightSegmentSchema = z.preprocess(
  (val) => {
    if (!val || typeof val !== "object") return val;
    const raw = val as Record<string, unknown>;
    const start = raw.start ?? raw.start_time ?? raw.startTime ?? raw.timestamp;
    const end = raw.end ?? raw.end_time ?? raw.endTime;
    const title = raw.title ?? raw.label ?? raw.headline ?? raw.key_point;
    const summary = raw.summary ?? raw.description ?? raw.text ?? "";

    const rawNumStart = typeof start === "number" ? start : typeof start === "string" ? Number(start.trim()) : 0;
    const rawNumEnd = typeof end === "number" ? end : typeof end === "string" ? Number(end.trim()) : rawNumStart + 30;

    const clampedStart = Number.isFinite(rawNumStart) && rawNumStart >= 0 ? rawNumStart : 0;
    const clampedEnd = Number.isFinite(rawNumEnd) && rawNumEnd >= 0 ? rawNumEnd : clampedStart + 30;

    const trimmedTitle = typeof title === "string" ? title.trim() : "";
    const trimmedSummary = typeof summary === "string" ? summary.trim() : "";

    return {
      ...raw,
      start: clampedStart,
      end: clampedEnd,
      title: trimmedTitle !== "" ? trimmedTitle : "Key Insight",
      summary: trimmedSummary,
    };
  },
  z.object({
    id: z.string().optional(),
    start: z.number().min(0),
    end: z.number().min(0),
    title: z.string().min(1),
    summary: z.string().optional(),
  }).passthrough()
);

export const HighlightsResponseSchema = z.object({
  analysisId: z.string(),
  highlights: z.array(HighlightSegmentSchema),
});
