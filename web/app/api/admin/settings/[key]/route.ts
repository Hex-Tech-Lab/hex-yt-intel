export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

const BodySchema = z.object({ value: z.unknown() });

/**
 * Admin-only: update one setting's system-scope value. Validates against the
 * setting's own data_type + validation contract (setting_definitions) before
 * writing, rather than trusting the client -- the same contract every other
 * consumer (Zod schemas, prompt generation) is supposed to read from, per
 * migration 20260723090000's stated motivation.
 *
 * Note: SupabaseSettingsAdapter.getRegistrySettings caches resolved values
 * in-process for 60s (per Vercel instance) -- an edit here can take up to
 * that long to be visible to a request already served by a warm instance
 * that cached the old value. Same tradeoff as the existing prompt-cache
 * situation (see /api/admin/prompts/invalidate); not addressed here.
 */
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ key: string }> }
): Promise<NextResponse<{ ok: true } | { error: string }>> {
  const admin = await requireAdmin('admin/settings/[key]:PUT');
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  const { key } = await params;

  const parsed = BodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid body: expected { value: unknown }' }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServiceClient();
    const { data: def, error: defErr } = await supabase
      .from('setting_definitions')
      .select('data_type, validation')
      .eq('key', key)
      .maybeSingle();

    if (defErr) throw defErr;
    if (!def) {
      return NextResponse.json({ error: `Unknown setting key: ${key}` }, { status: 404 });
    }

    const validationError = validateAgainstContract(parsed.data.value, def.data_type, (def.validation ?? {}) as Record<string, unknown>);
    if (validationError) {
      return NextResponse.json({ error: validationError }, { status: 400 });
    }

    const { error: upsertErr } = await supabase
      .from('setting_values')
      .upsert(
        {
          setting_key: key,
          scope_type: 'system',
          scope_id: null,
          value: parsed.data.value,
          updated_by: admin.userId,
        },
        { onConflict: 'setting_key,scope_type,scope_id' }
      );

    if (upsertErr) throw upsertErr;

    return NextResponse.json({ ok: true });
  } catch (error) {
    Sentry.captureException(error, { tags: { operation: 'admin_settings_update' }, extra: { key } });
    return NextResponse.json({ error: 'Failed to update setting' }, { status: 500 });
  }
}

function validateAgainstContract(value: unknown, dataType: string, validation: Record<string, unknown>): string | null {
  switch (dataType) {
    case 'number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return 'Expected a finite number';
      if (typeof validation.min === 'number' && value < validation.min) return `Value must be >= ${validation.min}`;
      if (typeof validation.max === 'number' && value > validation.max) return `Value must be <= ${validation.max}`;
      return null;
    }
    case 'string': {
      if (typeof value !== 'string') return 'Expected a string';
      if (typeof validation.minLength === 'number' && value.length < validation.minLength) return `Must be at least ${validation.minLength} characters`;
      if (typeof validation.maxLength === 'number' && value.length > validation.maxLength) return `Must be at most ${validation.maxLength} characters`;
      if (typeof validation.regex === 'string' && !new RegExp(validation.regex).test(value)) return 'Does not match required pattern';
      return null;
    }
    case 'boolean':
      return typeof value === 'boolean' ? null : 'Expected a boolean';
    case 'enum': {
      const allowed = Array.isArray(validation.enumValues) ? validation.enumValues : [];
      return allowed.includes(value as never) ? null : `Must be one of: ${allowed.join(', ')}`;
    }
    case 'array':
      return Array.isArray(value) ? null : 'Expected an array';
    case 'json':
      return value !== null && typeof value === 'object' ? null : 'Expected a JSON object or array';
    default:
      return null;
  }
}
