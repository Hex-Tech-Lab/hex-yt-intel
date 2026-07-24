/**
 * CommentIngestionPort — Domain Port (Hexagonal-Lite)
 *
 * Contract for paginated comment fetching. Corrects a planning-stage
 * assumption (docs/specs/COMMENTS_SAMPLING_ENGINE_PLAN_2026-07-24.md
 * originally proposed extending web/lib/ports/MetadataIngestionPort) --
 * comments are fetched worker-side by MetadataScraper.fetchComments, not by
 * the web ingestion adapter, so the paginated contract belongs here.
 *
 * Today's MetadataScraper.fetchComments is single-page only (maxResults cap,
 * no nextPageToken loop) -- this is why a video with more comments than the
 * page size silently returns a flat, non-representative slice with no
 * sampling concept at all (the bug that motivated the sampling engine).
 * MetadataScraper implementing this port (Phase 3) is what closes that gap.
 */

export interface VideoComment {
  author: string;
  text: string;
  publishedAt: string;
  likeCount: number;
}

export interface CommentPage {
  comments: VideoComment[];
  nextPageToken?: string;
  /** True when YouTube's pagination is exhausted (no nextPageToken returned). */
  exhausted: boolean;
}

export interface CommentIngestionPort {
  /**
   * Fetches one page of comments. Callers loop this (accumulating until
   * `targetCount` from a SamplePlan is reached or `exhausted` is true) rather
   * than this port doing the looping itself, so a Tier 0/1/2 caller can stop
   * early without paying for pages it won't sample from.
   */
  fetchCommentsPage(
    videoId: string,
    params: { pageToken?: string; maxResultsPerPage: number }
  ): Promise<CommentPage>;
}
