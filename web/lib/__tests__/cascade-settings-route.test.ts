/**
 * Route-level regression (ADR 040): PUT /api/admin/settings/[key] must
 * reject a cascade.* save whose value references a model ID outside the
 * code-derived allowlist — 400 BEFORE any setting_values upsert, so a bad
 * model ID can no longer ship silently as runtime OpenRouter 404s.
 */
import { NextRequest } from 'next/server';
import { describe, it, expect, vi } from 'vitest';

const requireAdmin = vi.hoisted(() => vi.fn(() => ({ ok: true, userId: 'admin-1' })));
const Sentry = vi.hoisted(() => ({ captureException: vi.fn(), captureMessage: vi.fn() }));

vi.mock('@/lib/utils/require-admin', () => ({ requireAdmin }));
vi.mock('@sentry/nextjs', () => Sentry);

const defRows: Record<string, { data_type: string; validation: Record<string, unknown> } | null> = {};
const upserts: unknown[] = [];

vi.mock('@/lib/supabase', () => ({
  getSupabaseServiceClient: () => ({
    from(table: string) {
      if (table === 'setting_definitions') {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: () => {
                const lastKey = Object.keys(defRows)[0];
                return Promise.resolve({ data: lastKey ? defRows[lastKey] : null, error: null });
              },
            }),
          }),
        };
      }
      return {
        upsert: (row: unknown) => {
          upserts.push(row);
          return Promise.resolve({ error: null });
        },
      };
    },
  }),
}));

import { PUT } from '@/app/api/admin/settings/[key]/route';

function makePut(key: string, value: unknown) {
  defRows[key] = { data_type: 'json', validation: { kind: 'cascadeRegistry' } };
  return PUT(
    new NextRequest(`http://localhost/api/admin/settings/${key}`, {
      method: 'PUT',
      body: JSON.stringify({ value }),
    }),
    { params: Promise.resolve({ key }) },
  );
}

describe('PUT /api/admin/settings/[key] — cascadeRegistry marker (ADR 040)', () => {
  it('rejects an unknown model ID with 400 BEFORE the upsert', async () => {
    const res = await makePut('cascade.chat', [{ model: 'claude-3-5-haiku', name: 'Injected' }]);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/Unknown model ID "claude-3-5-haiku"/);
    expect(upserts).toHaveLength(0);
  });

  it('accepts an allowlisted cascade and writes setting_values', async () => {
    const value = [{ model: 'openai/gpt-oss-120b', name: 'gpt-oss-120b (Groq)', providerOrder: ['groq'] }];
    const res = await makePut('cascade.chat', value);
    expect(res.status).toBe(200);
    expect(upserts).toHaveLength(1);
  });
});
