export const dynamic = 'force-dynamic';

import { NextResponse } from 'next/server';
import { getSupabaseServiceClient } from '@/lib/supabase';
import { requireAdmin } from '@/lib/utils/require-admin';
import * as Sentry from '@sentry/nextjs';

export interface AdminSettingRow {
  key: string;
  tier: string;
  dataType: string;
  validation: Record<string, unknown>;
  defaultValue: unknown;
  value: unknown;
  isOverridden: boolean;
  description: string;
  ownerRole: string;
  updatedAt: string;
}

/**
 * Admin-only: list every setting_definitions row joined with its current
 * system-scope setting_values row (falling back to default_value when no
 * override exists). Submenu grouping (by key prefix, e.g. 'cascade.*',
 * 'comments.*') happens client-side in AdminSettingsClient -- this just
 * returns the flat catalog.
 */
export async function GET(): Promise<NextResponse<{ settings: AdminSettingRow[] } | { error: string }>> {
  const admin = await requireAdmin('admin/settings:GET');
  if (!admin.ok) {
    return NextResponse.json({ error: admin.error }, { status: admin.status });
  }

  try {
    const supabase = getSupabaseServiceClient();
    const [{ data: defs, error: defErr }, { data: vals, error: valErr }] = await Promise.all([
      supabase.from('setting_definitions').select('key, tier, data_type, validation, default_value, description, owner_role, updated_at').order('key'),
      supabase.from('setting_values').select('setting_key, value, updated_at').eq('scope_type', 'system').is('scope_id', null),
    ]);

    if (defErr || valErr) throw defErr || valErr;

    const overrides = new Map((vals ?? []).map((v) => [v.setting_key, v]));
    const settings: AdminSettingRow[] = (defs ?? []).map((def) => {
      const override = overrides.get(def.key);
      return {
        key: def.key,
        tier: def.tier,
        dataType: def.data_type,
        validation: (def.validation ?? {}) as Record<string, unknown>,
        defaultValue: def.default_value,
        value: override ? override.value : def.default_value,
        isOverridden: !!override,
        description: def.description,
        ownerRole: def.owner_role,
        updatedAt: override?.updated_at ?? def.updated_at,
      };
    });

    return NextResponse.json({ settings });
  } catch (error) {
    Sentry.captureException(error, { tags: { operation: 'admin_settings_list' } });
    return NextResponse.json({ error: 'Failed to load settings' }, { status: 500 });
  }
}
