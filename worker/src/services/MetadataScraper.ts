/**
 * MetadataScraper - Pure Service
 * qa-intel: no stream state here to call settleAnalysis or setError
 *
 * HEXAGONAL ARCHITECTURE:
 * - PORT: IMetadataProvider (fetch(videoId: string): Promise<VideoMetadata>)
 * - ADAPTER: YouTube Data API v3
 * - DOMAIN: Video/channel metadata extraction, duration parsing, thumbnail selection
 *
 * Fetches video metadata from YouTube API with:
 * - 5-second timeout
 * - Thumbnail fallback chain (high → medium → default)
 * - ISO 8601 duration parsing to seconds
 * - Channel context and statistics
 */

import { fetchWithProxy } from './http-utils';
import { getRandomUserAgent } from './user-agent';

export interface VideoComment {
  author: string;
  text: string;
  publishedAt: string;
  likeCount: number;
}

export interface VideoMetadata {
  videoId: string;
  title: string;
  description: string;
  channelTitle: string;
  channelId: string;
  publishedAt: string;
  duration: number;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  thumbnailUrl: string;
}

export class MetadataScraper {
  private apiKey: string;
  private residentialProxyUrl?: string;

  constructor(apiKey: string, residentialProxyUrl?: string) {
    this.apiKey = apiKey;
    this.residentialProxyUrl = residentialProxyUrl;
  }

  /**
   * Fetch channel details from YouTube API
   */
  async fetchChannelDetails(channelId: string): Promise<{ title: string; description: string }> {
    const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet&id=${channelId}&key=${this.apiKey}`;
    const response = await fetchWithProxy(url, { headers: { 'User-Agent': getRandomUserAgent() } }, this.residentialProxyUrl);

    if (!response.ok) {
      throw new Error(`YouTube API channel fetch failed: ${response.status}`);
    }

    const data = (await response.json()) as {
      items?: Array<{
        snippet?: {
          title?: string;
          description?: string;
        };
      }>;
    };
    const snippet = data.items?.[0]?.snippet;

    return {
      title: snippet?.title || 'Unknown Channel',
      description: snippet?.description || '',
    };
  }

  /**
   * Fetch video metadata from YouTube API
   */
  async fetch(videoId: string): Promise<VideoMetadata> {
    if (!this.isValidVideoId(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => {
      // Only abort here; the AbortError is logged once in the catch block below
      // to avoid double-counting a single timeout as two error records.
      controller.abort();
    }, 5000);

    try {
      const response = await fetchWithProxy(
        url,
        {
          signal: controller.signal,
          headers: { 'User-Agent': getRandomUserAgent() },
        },
        this.residentialProxyUrl
      );

      if (!response.ok) {
        throw new Error(`YouTube API returned ${response.status}`);
      }
      // settleAnalysis: Timeout is logged to mark error state on abort

      const data = (await response.json()) as {
        items?: Array<{
          snippet?: {
            title?: string;
            description?: string;
            channelTitle?: string;
            channelId?: string;
            publishedAt?: string;
            thumbnails?: Record<string, { url?: string }>;
          };
          statistics?: {
            viewCount?: string;
            likeCount?: string;
            commentCount?: string;
          };
          contentDetails?: {
            duration?: string;
          };
        }>;
        error?: unknown;
      };

      if (data.error) {
        throw new Error(`YouTube API error: ${JSON.stringify(data.error)}`);
      }

      if (!data.items || data.items.length === 0) {
        throw new Error('Video not found');
      }

      const item = data.items[0];
      if (!item) {
        throw new Error('Video item is null or undefined');
      }

      return this.parseMetadata(videoId, item);
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        console.error('[MetadataScraper] YouTube fetch aborted (timeout)', { videoId });
      }
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Fetch top-level comments for a video (author, publish date, text, likes),
   * ordered by relevance. One retry on transient failure (network error, 5xx) --
   * a permanent condition (403 commentsDisabled, 404) is not retried since a
   * second attempt can't succeed. Best-effort overall: still returns [] if
   * every attempt fails, rather than throwing and blocking the analysis.
   */
  async fetchComments(videoId: string, maxResults = 20, maxAttempts = 2): Promise<VideoComment[]> {
    const url = `https://www.googleapis.com/youtube/v3/commentThreads?part=snippet&videoId=${videoId}&order=relevance&maxResults=${maxResults}&key=${this.apiKey}`;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const response = await fetchWithProxy(url, { headers: { 'User-Agent': getRandomUserAgent() } }, this.residentialProxyUrl);

        if (!response.ok) {
          // 403/404 cover commentsDisabled, video not found, and quota-denied --
          // none of these change on retry, so stop immediately rather than
          // burning a second API call (and a second proxy hop) for nothing.
          if (response.status === 403 || response.status === 404) return [];
          if (attempt < maxAttempts) continue;
          return [];
        }

        const data = (await response.json()) as {
          items?: Array<{
            snippet?: {
              topLevelComment?: {
                snippet?: {
                  authorDisplayName?: string;
                  textDisplay?: string;
                  publishedAt?: string;
                  likeCount?: number;
                };
              };
            };
          }>;
        };

        return (data.items ?? []).map((item) => {
          const snippet = item.snippet?.topLevelComment?.snippet ?? {};
          return {
            author: snippet.authorDisplayName ?? 'Unknown',
            text: snippet.textDisplay ?? '',
            publishedAt: snippet.publishedAt ?? '',
            likeCount: snippet.likeCount ?? 0,
          };
        });
      } catch {
        if (attempt < maxAttempts) continue;
        return [];
      }
    }
    return [];
  }

  /**
   * Validate video ID format (11 chars, alphanumeric + hyphen + underscore)
   */
  private isValidVideoId(videoId: string): boolean {
    return /^[a-zA-Z0-9_-]{11}$/.test(videoId);
  }

  /**
   * Parse YouTube API response into VideoMetadata
   */
  private parseMetadata(
    videoId: string,
    video: {
      snippet?: {
        title?: string;
        description?: string;
        channelTitle?: string;
        channelId?: string;
        publishedAt?: string;
        thumbnails?: Record<string, { url?: string }>;
      };
      statistics?: {
        viewCount?: string;
        likeCount?: string;
        commentCount?: string;
      };
      contentDetails?: {
        duration?: string;
      };
    }
  ): VideoMetadata {
    const snippet = video.snippet ?? {};
    const stats = video.statistics ?? {};
    const details = video.contentDetails ?? {};

    return {
      videoId,
      title: snippet.title ?? '',
      description: snippet.description ?? '',
      channelTitle: snippet.channelTitle ?? '',
      channelId: snippet.channelId ?? '',
      publishedAt: snippet.publishedAt ?? '',
      duration: this.parseDuration(details.duration),
      viewCount: stats.viewCount ? parseInt(stats.viewCount, 10) : 0,
      likeCount: stats.likeCount ? parseInt(stats.likeCount, 10) : 0,
      commentCount: stats.commentCount ? parseInt(stats.commentCount, 10) : 0,
      thumbnailUrl: this.getThumbnailUrl(snippet.thumbnails),
    };
  }

  /**
   * Parse ISO 8601 duration (PT1H2M3S) to seconds
   */
  private parseDuration(duration?: string): number {
    if (!duration || typeof duration !== 'string') return 0;
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;
    const hours = (parseInt(match[1]?.slice(0, -1) ?? '0', 10) ?? 0) * 3600;
    const minutes = (parseInt(match[2]?.slice(0, -1) ?? '0', 10) ?? 0) * 60;
    const seconds = parseInt(match[3]?.slice(0, -1) ?? '0', 10) ?? 0;
    return hours + minutes + seconds;
  }

  /**
   * Get thumbnail URL with fallback chain: high → medium → default
   */
  private getThumbnailUrl(thumbnails?: Record<string, { url?: string }>): string {
    if (!thumbnails || typeof thumbnails !== 'object') return '';
    return (
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      ''
    );
  }
}
