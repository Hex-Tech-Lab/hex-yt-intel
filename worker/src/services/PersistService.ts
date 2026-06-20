import { reconstructMarkdown, extractJsonPayload } from './MarkdownReconstructor';
import { UCISPayloadSchema } from './ZodSchemas';
import { hmacHex } from '../crypto';
import { z } from 'zod';

export interface PersistOptions {
  analysisId: string;
  videoId: string;
  finalText: string;
  modelUsed: string;
  status: 'completed' | 'interrupted';
  activeSecret: string;
  appUrl: string;
  validate12D: (text: string) => boolean;
  chunkIndex?: number;
  totalChunks?: number;
}

const rawFetch = fetch;

export class PersistService {
  async persist(options: PersistOptions): Promise<boolean> {
    let markdown = options.finalText;
    let jsonPayload: Record<string, unknown> | null = null;

    const extracted = extractJsonPayload(options.finalText);

    if (extracted) {
      const isChunk = options.chunkIndex !== undefined;
      const schema = isChunk
        ? z.object({
            schemaVersion: z.literal('2.0'),
            dimensions: z.array(z.any())
          }).passthrough()
        : UCISPayloadSchema;

      const result = schema.safeParse(extracted);
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

    const valid = options.validate12D(markdown);
    const canonical = JSON.stringify({ markdown, payload: jsonPayload });
    const contentSig = await hmacHex(options.activeSecret, canonical);

    return this._attemptPersist({
      ...options,
      markdown,
      jsonPayload,
      valid,
      contentSig,
    });
  }

  async _attemptPersist(params: {
    analysisId: string;
    videoId: string;
    finalText: string;
    markdown: string;
    jsonPayload: Record<string, unknown> | null;
    modelUsed: string;
    status: 'completed' | 'interrupted';
    activeSecret: string;
    appUrl: string;
    valid: boolean;
    contentSig: string;
    chunkIndex?: number;
    totalChunks?: number;
  }): Promise<boolean> {
    const maxRetries = 2;
    for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex++) {
      try {
        const persistRes = await rawFetch(`${params.appUrl}/api/analyses/persist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            analysisId: params.analysisId,
            videoId: params.videoId,
            markdown: params.markdown,
            payload: params.jsonPayload,
            model: params.modelUsed,
            valid: params.valid,
            contentSig: params.contentSig,
            status: params.status,
            chunkIndex: params.chunkIndex,
            totalChunks: params.totalChunks,
          }),
        });
        if (persistRes.ok) return true;
        console.warn(`[persist] ${params.status} persist returned ${persistRes.status}, retrying...`);
      } catch (e) {
        console.error(`[persist] ${params.status} persist attempt ${tryIndex + 1}/${maxRetries + 1} failed`, e);
      }
      if (tryIndex < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (tryIndex + 1)));
      }
    }
    return false;
  }

  async settleAnalysis(options: {
    analysisId: string;
    videoId: string;
    finalText: string;
    modelUsed: string;
    activeSecret: string;
    appUrl: string;
    validate12D: (text: string) => boolean;
    status: 'failed' | 'interrupted';
  }): Promise<void> {
    let markdown = options.finalText;
    let jsonPayload: Record<string, unknown> | null = null;

    const extracted = extractJsonPayload(options.finalText);
    if (extracted) {
      const schema = z.object({
        schemaVersion: z.literal('2.0'),
        dimensions: z.array(z.any())
      }).passthrough();
      const result = schema.safeParse(extracted);
      if (result.success) {
        jsonPayload = result.data as unknown as Record<string, unknown>;
      }
    }

    if (jsonPayload) {
      try {
        markdown = reconstructMarkdown(jsonPayload);
      } catch {
        markdown = options.finalText;
      }
    }

    const valid = options.validate12D(markdown);
    const canonical = JSON.stringify({ markdown, payload: jsonPayload });
    const contentSig = await hmacHex(options.activeSecret, canonical);

    const maxRetries = 2;
    for (let tryIndex = 0; tryIndex <= maxRetries; tryIndex++) {
      try {
        await rawFetch(`${options.appUrl}/api/analyses/persist`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: AbortSignal.timeout(10000),
          body: JSON.stringify({
            analysisId: options.analysisId,
            videoId: options.videoId,
            markdown,
            payload: jsonPayload,
            model: options.modelUsed,
            valid,
            contentSig,
            status: options.status,
          }),
        });
        return;
      } catch (e) {
        console.error(`[settle] ${options.status} settlement attempt ${tryIndex + 1}/${maxRetries + 1} failed`, e);
      }
      if (tryIndex < maxRetries) {
        await new Promise(r => setTimeout(r, 500 * (tryIndex + 1)));
      }
    }
  }
}
