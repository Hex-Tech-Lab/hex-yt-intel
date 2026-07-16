/**
 * Dimension-0 executive digest use case.
 * Generates the three-tier digest once per owned analysis: idempotent when a
 * digest already exists, refuses when there is no analysis content to summarize,
 * and persists a parsed digest on the happy path. No real model or DB — the
 * completion and persistence ports are faked.
 */
import { GenerateExecutiveDigestUseCase } from '@/lib/usecases/GenerateExecutiveDigestUseCase';

const VALID_COMPLETION = [
  '#### 0.1 Snapshot',
  'A tight overview of the video in one paragraph.',
  '',
  '#### 0.2 Overview',
  'Paragraph one of the overview.',
  '',
  'Paragraph two of the overview.',
  '',
  '#### 0.3 Key Takeaways',
  '- First concrete takeaway',
  '- Second concrete takeaway',
  '',
  '#### 0.4 Detailed Summary',
  'Detailed summary content goes here.',
].join('\n');

type Row = { analysis_markdown?: string | null; executive_digest?: unknown } | null;

const makeDeps = (opts: { row: Row; completion?: string; completionThrows?: boolean }) => {
  let saved: unknown = null;
  let completionCalls = 0;
  const persistence = {
    verifyOwnership: () => Promise.resolve(opts.row),
    saveExecutiveDigest: (p: { digest: unknown }) => {
      saved = p.digest;
      return Promise.resolve(true);
    },
  };
  const completion = {
    complete: () => {
      completionCalls += 1;
      if (opts.completionThrows) return Promise.reject(new Error('all models down'));
      return Promise.resolve({ text: opts.completion ?? VALID_COMPLETION, model: 'test/model' });
    },
  };
  return {
    useCase: new GenerateExecutiveDigestUseCase(persistence as never, completion as never),
    getSaved: () => saved,
    getCompletionCalls: () => completionCalls,
  };
};

const baseParams = { analysisId: 'an-1', userId: 'user-1', models: [{ model: 'test/model' }] as const };

describe('GenerateExecutiveDigestUseCase', () => {
  it('404s when the analysis is not owned / not found', async () => {
    const { useCase, getCompletionCalls } = makeDeps({ row: null });
    const res = await useCase.execute(baseParams);
    expect(res.type).toBe('error');
    if (res.type !== 'error') return;
    expect(res.status).toBe(404);
    expect(getCompletionCalls()).toBe(0);
  });

  it('refuses (no model call) when the analysis has no content to summarize', async () => {
    const { useCase, getCompletionCalls } = makeDeps({ row: { analysis_markdown: '   ', executive_digest: null } });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'error') throw new Error('expected error');
    expect(res.code).toBe('ERR_ANALYSIS_MARKDOWN_EMPTY');
    expect(getCompletionCalls()).toBe(0);
  });

  it('returns the stored digest without a second model call (idempotent)', async () => {
    const existing = { snapshot: 'cached snap', takeaways: ['a'], overview: 'cached overview', model: 'x', generatedAt: 't' };
    const { useCase, getCompletionCalls } = makeDeps({ row: { analysis_markdown: '### D1\ncontent', executive_digest: existing } });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.cached).toBe(true);
    expect(res.digest.snapshot).toBe('cached snap');
    expect(getCompletionCalls()).toBe(0);
  });

  it('generates, parses, and persists a digest on the happy path', async () => {
    const { useCase, getSaved } = makeDeps({ row: { analysis_markdown: '### D1\nSubstantive content', executive_digest: null } });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.cached).toBe(false);
    expect(res.digest.snapshot).toMatch(/tight overview/i);
    expect(res.digest.takeaways).toHaveLength(2);
    expect(res.digest.overview).toMatch(/Paragraph one/);
    expect(res.digest.model).toBe('test/model');
    expect(getSaved()).toEqual(res.digest);
  });

  it('re-generates when force is set even if a digest exists', async () => {
    const existing = { snapshot: 'old', takeaways: ['a'], overview: 'old', model: 'x', generatedAt: 't' };
    const { useCase, getCompletionCalls } = makeDeps({ row: { analysis_markdown: '### D1\ncontent', executive_digest: existing } });
    const res = await useCase.execute({ ...baseParams, force: true });
    if (res.type !== 'success') throw new Error('expected success');
    expect(res.cached).toBe(false);
    expect(getCompletionCalls()).toBe(1);
  });

  it('errors when the completion is unparseable', async () => {
    const { useCase } = makeDeps({ row: { analysis_markdown: '### D1\ncontent', executive_digest: null }, completion: 'no tiers here at all' });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'error') throw new Error('expected error');
    expect(res.code).toBe('ERR_DIGEST_UNPARSEABLE');
  });

  it('surfaces a 502 when every model fails', async () => {
    const { useCase } = makeDeps({ row: { analysis_markdown: '### D1\ncontent', executive_digest: null }, completionThrows: true });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'error') throw new Error('expected error');
    expect(res.status).toBe(502);
    expect(res.code).toBe('ERR_DIGEST_COMPLETION_FAILED');
  });

  it('refuses when analysis_markdown is null or undefined', async () => {
    const { useCase, getCompletionCalls } = makeDeps({ row: { analysis_markdown: null, executive_digest: null } });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'error') throw new Error('expected error');
    expect(res.code).toBe('ERR_ANALYSIS_MARKDOWN_EMPTY');
    expect(getCompletionCalls()).toBe(0);
  });

  it('refuses when analysis_markdown is whitespace-only', async () => {
    const { useCase, getCompletionCalls } = makeDeps({ row: { analysis_markdown: '\r\n \t ', executive_digest: null } });
    const res = await useCase.execute(baseParams);
    if (res.type !== 'error') throw new Error('expected error');
    expect(res.code).toBe('ERR_ANALYSIS_MARKDOWN_EMPTY');
    expect(getCompletionCalls()).toBe(0);
  });
});
