import type { NextResponse } from 'next/server';

/** Result of a quota gate check. */
export interface QuotaGateResult {
  /** true = request may proceed; false = a denial response is attached. */
  allowed: boolean;
  /** Pre-built NextResponse to return when denied (429 or 402). */
  denialResponse?: NextResponse;
  /** Rate-limit headers to attach to the success response when allowed. */
  headers?: Record<string, string>;
}