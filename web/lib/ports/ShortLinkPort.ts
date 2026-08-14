export interface ShortLinkResult {
  id: string;
  shortLink: string;
  url: string;
}

export interface ShortLinkClickAnalytics {
  clicks: number;
}

/** Programmatic short-link creation, resolution, and analytics (Dub.co). */
export interface ShortLinkPort {
  createLink(params: { url: string; key?: string; tenantId?: string }): Promise<ShortLinkResult>;
  getClickAnalytics(linkId: string): Promise<ShortLinkClickAnalytics>;
  deleteLink(linkId: string): Promise<void>;
}
