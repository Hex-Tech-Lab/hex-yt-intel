// @vitest-environment happy-dom
/**
 * Regression: PR #419 round 2 — setClassification previously short-circuited on
 * `recommendation` alone, so a partial classification fragment arriving early
 * (only `recommendation`) was followed by a fuller fragment (same
 * recommendation + qualifiers) that was silently dropped, leaving the UI with
 * a permanently incomplete classification. Also guards the two per-delta
 * `[Adapter]` console.debug logs in stream-delta-handler behind
 * window.__CHAT_DEBUG (Sentry-tunnel 429 class, CodeRabbit/Cubic #419 r2).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAnalysisMetadataStore } from '../stores/analysis-metadata-store';
import { StreamDeltaHandler } from '../adapters/stream-delta-handler';

const QUALIFIED = {
  recommendation: 'recommended' as const,
  safe: true,
  authoritative: true,
};

describe('analysis-metadata-store setClassification partial-delta resilience', () => {
  it('lands a fuller fragment with the same recommendation', () => {
    const store = useAnalysisMetadataStore.getState();
    store.setClassification({ recommendation: 'recommended' });
    store.setClassification(QUALIFIED);
    const { classification } = useAnalysisMetadataStore.getState();
    expect(classification).toEqual(QUALIFIED);
  });

  it('keeps the same reference when an identical object is set twice', () => {
    const store = useAnalysisMetadataStore.getState();
    store.setClassification(QUALIFIED);
    const first = useAnalysisMetadataStore.getState().classification;
    store.setClassification(QUALIFIED);
    const second = useAnalysisMetadataStore.getState().classification;
    expect(second).toBe(first);
  });

  it('drops a truly identical repeat (partial then identical partial)', () => {
    const store = useAnalysisMetadataStore.getState();
    store.setClassification({ recommendation: 'recommended' });
    const first = useAnalysisMetadataStore.getState().classification;
    store.setClassification({ recommendation: 'recommended' });
    expect(useAnalysisMetadataStore.getState().classification).toBe(first);
  });
});

// ---------------------------------------------------------------------------
// stream-delta-handler: per-delta [Adapter] logs behind window.__CHAT_DEBUG
// ---------------------------------------------------------------------------

describe('stream-delta-handler per-delta logging is opt-in', () => {
  let debugSpy: ReturnType<typeof vi.spyOn>;
  let errorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    debugSpy.mockRestore();
    errorSpy.mockRestore();
    delete (window as any).__CHAT_DEBUG;
  });

  it('does NOT log [Adapter] heal/parse failures by default', () => {
    const handler = new StreamDeltaHandler();
    // Partial JSON: heal succeeds mid-stream, full parse fails → healed-parse log path
    handler.handleDelta('{"schemaVersion":"2.0","perso', {} as any, () => {});
    const adapterLogs = debugSpy.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith('[Adapter]'));
    expect(adapterLogs).toHaveLength(0);
  });

  it('logs [Adapter] heal/parse failures only when window.__CHAT_DEBUG is set', () => {
    (window as any).__CHAT_DEBUG = true;
    const handler = new StreamDeltaHandler();
    handler.handleDelta('{"schemaVersion":"2.0","perso', {} as any, () => {});
    const adapterLogs = debugSpy.mock.calls.filter((c) => typeof c[0] === 'string' && c[0].startsWith('[Adapter]'));
    expect(adapterLogs.length).toBeGreaterThan(0);
  });
});
