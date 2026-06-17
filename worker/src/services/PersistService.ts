import { reconstructMarkdown, extractJsonPayload } from './MarkdownReconstructor';
import { UCISPayloadSchema } from './ZodSchemas';
import { hmacHex } from '../crypto';

export interface PersistOptions {
  analysisId: string;
  videoId: string;
  finalText: string;
  jsonPayload: Record<string, unknown> | null;
  modelUsed: string;
  valid: boolean;
  status: 'completed' | 'interrupted';
  activeSecret: string;
  appUrl: string;
}

export class PersistService {
  private persisted = false;

  async persist(options: PersistOptions): Promise<void> {
    if (this.persisted || !options.finalText) return;

    let markdown = options.finalText;
    let jsonPayload: Record<string, unknown> | null = null;

    const extracted = extractJsonPayload(options.finalText);

    if (extracted) {
      const result = UCISPayloadSchema.safeParse(extracted);
      if (result.success) {
        jsonPayload = result.data as unknown as Record<string, unknown>;
      } else {
        console.error('[persist] Zod validation failed:', result.error.format());
      }
    }

    if (jsonPayload) {
      try {
        markdown = reconstructMarkdown(jsonPayload);
      } catch (error) {
        console.error('[persist] reconstructMarkdown failed:', error);
        markdown = options.finalText;
      }
    }

    const canonical = JSON.stringify({ markdown, payload: jsonPayload });
    const contentSig = await hmacHex(options.activeSecret, canonical);

    this.persisted = true;
    const maxRetries = 2;
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const persistRes = await fetch(`${options.appUrl}/api/analyses/persist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            analysisId: options.analysisId,
            videoId: options.videoId,
            markdown,
            payload: jsonPayload,
            model: options.modelUsed,
            valid: options.valid,
            contentSig,
            status: options.status,
          }),
        });
        if (persistRes.ok) break;
        console.warn(`[persist] ${options.status} persist returned ${persistRes.status}, retrying...`);
      } catch (e) {
        console.error(`[persist] ${options.status} persist attempt ${attempt + 1}/${maxRetries + 1} failed`, e);
      }
      if (attempt < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (attempt + 1)));
      }
    }
  }
}
