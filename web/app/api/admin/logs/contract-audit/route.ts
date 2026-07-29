export const dynamic = 'force-dynamic';

import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/utils/require-admin';
import { fetchContractAuditLogs } from '@/lib/admin-logs/fetchers';

/**
 * GET /api/admin/logs/contract-audit — Admin-only history of
 * scripts/contract-auditor.ts runs (public.contract_audit_runs).
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const adminResult = await requireAdmin('admin/logs/contract-audit:GET');
  if (!adminResult.ok) {
    return NextResponse.json({ error: adminResult.error }, { status: adminResult.status });
  }
  const { searchParams } = new URL(request.url);
  const result = await fetchContractAuditLogs(searchParams);
  return NextResponse.json(result.body, { status: result.status });
}
