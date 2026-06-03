/**
 * MetadataScraper - Pure Service
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
   * Fetch video metadata from YouTube API
   */
  async fetch(videoId: string): Promise<VideoMetadata> {
    if (!this.isValidVideoId(videoId)) {
      throw new Error(`Invalid video ID format: ${videoId}`);
    }

    const url = `https://www.googleapis.com/youtube/v3/videos?part=statistics,snippet,contentDetails&id=${videoId}&key=${this.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);

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

      const data = (await response.json()) as {
        items?: Array<{ snippet?: any; statistics?: any; contentDetails?: any }>;
        error?: any;
      };

      if (data.error) {
        throw new Error(`YouTube API error: ${JSON.stringify(data.error)}`);
      }

      if (!data.items || data.items.length === 0) {
        throw new Error('Video not found');
      }

      return this.parseMetadata(videoId, data.items[0]);
    } finally {
      clearTimeout(timeout);
    }
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
    video: { snippet?: any; statistics?: any; contentDetails?: any }
  ): VideoMetadata {
    const snippet = video.snippet || {};
    const stats = video.statistics || {};
    const details = video.contentDetails || {};

    return {
      videoId,
      title: String(snippet.title || ''),
      description: String(snippet.description || ''),
      channelTitle: String(snippet.channelTitle || ''),
      channelId: String(snippet.channelId || ''),
      publishedAt: String(snippet.publishedAt || ''),
      duration: this.parseDuration(details.duration),
      viewCount: parseInt(String(stats.viewCount || '0'), 10),
      likeCount: parseInt(String(stats.likeCount || '0'), 10),
      commentCount: parseInt(String(stats.commentCount || '0'), 10),
      thumbnailUrl: this.getThumbnailUrl(snippet.thumbnails),
    };
  }

  /**
   * Parse ISO 8601 duration (PT1H2M3S) to seconds
   */
  private parseDuration(duration: any): number {
    if (!duration || typeof duration !== 'string') return 0;
    const match = duration.match(/PT(\d+H)?(\d+M)?(\d+S)?/);
    if (!match) return 0;
    const hours = (parseInt(match[1] || '0') || 0) * 3600;
    const minutes = (parseInt(match[2] || '0') || 0) * 60;
    const seconds = parseInt(match[3] || '0') || 0;
    return hours + minutes + seconds;
  }

  /**
   * Get thumbnail URL with fallback chain: high → medium → default
   */
  private getThumbnailUrl(thumbnails: any): string {
    if (!thumbnails || typeof thumbnails !== 'object') return '';
    return (
      thumbnails.high?.url ||
      thumbnails.medium?.url ||
      thumbnails.default?.url ||
      ''
    );
  }
}
