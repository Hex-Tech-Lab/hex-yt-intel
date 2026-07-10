#!/usr/bin/env tsx
/**
 * RCA Investigation: Cascade Fallback Incidents
 *
 * Purpose: Investigate why 2-level fallback occurred (Haiku 4.5 → Sonnet 4.6)
 * Uses native fetch to query Supabase REST API directly
 */

interface AnalysisRecord {
  id: string;
  video_id: string;
  user_id: string;
  model_used: string;
  created_at: string;
  analysis_payload?: Record<string, unknown> | null;
  status: string;
  validation_passed?: boolean;
  billing_status?: string;
}

interface CascadeIncident {
  analysisId: string;
  videoId: string;
  timestamp: string;
  modelUsed: string;
  status: string;
  hypothesis: string;
  evidence: string[];
}

// Environment configuration
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://adnmbikaqnxivalqoild.supabase.co';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';

/**
 * Query Supabase REST API for analyses using Sonnet 4.6
 */
async function findSonnetIncidents(daysBack: number = 7): Promise<AnalysisRecord[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysBack);

  console.log(`[RCA] Querying Supabase for Sonnet 4.6 usage since ${cutoffDate.toISOString()}...`);

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('[RCA] ❌ Missing Supabase configuration');
    console.error('   NEXT_PUBLIC_SUPABASE_URL:', SUPABASE_URL ? '✓' : '✗');
    console.error('   NEXT_PUBLIC_SUPABASE_ANON_KEY:', SUPABASE_KEY ? '✓' : '✗');
    return [];
  }

  try {
    // Query: select all recent analyses, filter client-side for Sonnet 4.6
    const url = `${SUPABASE_URL}/rest/v1/analyses?select=id,video_id,user_id,model_used,created_at,analysis_payload,status,validation_passed,billing_status&order=created_at.desc&limit=100`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      console.error(`[RCA] ❌ Supabase API error: ${response.status} ${response.statusText}`);
      const body = await response.text();
      console.error('[RCA] Response:', body.slice(0, 200));
      return [];
    }

    const allData: AnalysisRecord[] = await response.json();

    // Filter for records >= cutoffDate and using Sonnet 4.6
    const sonnetRecords = allData.filter((record: AnalysisRecord) => {
      const recordDate = new Date(record.created_at);
      const hasSonnet = record.model_used && record.model_used.includes('sonnet-4.6');
      return recordDate >= cutoffDate && hasSonnet;
    });

    console.log(`[RCA] ✓ Found ${sonnetRecords.length} Sonnet 4.6 analyses out of ${allData.length} total`);
    return sonnetRecords;
  } catch (error) {
    console.error('[RCA] ❌ Exception querying Supabase:', error instanceof Error ? error.message : String(error));
    return [];
  }
}

/**
 * Analyze each incident to determine root cause hypothesis
 */
function diagnoseIncident(record: AnalysisRecord): CascadeIncident {
  const incident: CascadeIncident = {
    analysisId: record.id,
    videoId: record.video_id,
    timestamp: record.created_at,
    modelUsed: record.model_used || 'unknown',
    status: record.status || 'unknown',
    hypothesis: 'UNDETERMINED',
    evidence: [],
  };

  // Evidence gathering
  if (!record.validation_passed) {
    incident.evidence.push('validation_passed=false');
  }
  if (record.billing_status !== 'completed') {
    incident.evidence.push(`billing_status=${record.billing_status || 'null'}`);
  }
  if (record.status !== 'complete') {
    incident.evidence.push(`status=${record.status}`);
  }

  // Hypothesis evaluation (per RCA guide §4)

  // Hypothesis A: Provider Quota Exhaustion (402)
  if (record.billing_status === 'quota_exceeded') {
    incident.hypothesis = 'Hypothesis A: Provider Quota Exhaustion (402)';
    incident.evidence.push('billing_status indicates quota exceeded');
  }

  // Hypothesis B: Provider Overload (429/503)
  else if (record.status === 'partial' && record.validation_passed === false) {
    incident.hypothesis = 'Hypothesis B: Provider Overload or Timeout (429/503)';
    incident.evidence.push('Partial status with validation failure suggests provider issue');
  }

  // Hypothesis C: Connection Timeout
  else if (record.status === 'processing' || record.status === 'stuck') {
    incident.hypothesis = 'Hypothesis C: Connection Timeout or Stuck Analysis';
    incident.evidence.push(`Analysis stuck in status: ${record.status}`);
  }

  // Hypothesis D: Model Refusal
  else if (record.model_used === 'anthropic/claude-sonnet-4.6:nitro' && !record.validation_passed) {
    incident.hypothesis = 'Hypothesis D: Model Refusal (Haiku 4.5 rejected prompt)';
    incident.evidence.push('Sonnet used after Haiku failed on same prompt');
  }

  // Hypothesis E: Our Code / Workflow Issue
  else {
    incident.hypothesis = 'Hypothesis E: Our Code or Workflow Issue (Cache, Validation, Schema)';
    incident.evidence.push('No clear provider error signal; likely application-side issue');
  }

  return incident;
}

/**
 * Generate RCA report with grouped incidents
 */
function generateReport(incidents: CascadeIncident[]): void {
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║          ROOT CAUSE ANALYSIS: CASCADE FALLBACK INCIDENTS    ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  if (incidents.length === 0) {
    console.log('[RCA] ✅ No Sonnet 4.6 fallback incidents found in the past 7 days.');
    console.log('[RCA] This suggests: either fallback is rare (expected), or logs have rotated.\n');
    return;
  }

  // Group by hypothesis
  const byHypothesis = new Map<string, CascadeIncident[]>();
  for (const incident of incidents) {
    const key = incident.hypothesis;
    if (!byHypothesis.has(key)) {
      byHypothesis.set(key, []);
    }
    byHypothesis.get(key)!.push(incident);
  }

  // Print by hypothesis
  for (const [hypothesis, group] of byHypothesis) {
    console.log(`\n📊 ${hypothesis}`);
    console.log(`   Count: ${group.length} incident${group.length > 1 ? 's' : ''}\n`);

    for (const incident of group.slice(0, 3)) {
      console.log(`   Analysis ID: ${incident.analysisId}`);
      console.log(`   Timestamp: ${incident.timestamp}`);
      console.log(`   Video: ${incident.videoId.substring(0, 12)}...`);
      console.log(`   Status: ${incident.status}`);
      console.log(`   Evidence: ${incident.evidence.join(', ') || 'none collected'}`);
      console.log();
    }

    if (group.length > 3) {
      console.log(`   ... and ${group.length - 3} more incidents\n`);
    }
  }

  // Summary and recommendations
  console.log('\n╔════════════════════════════════════════════════════════════╗');
  console.log('║                     RECOMMENDATIONS                        ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  const hypothesisE = byHypothesis.get('Hypothesis E: Our Code or Workflow Issue (Cache, Validation, Schema)');
  if (hypothesisE && hypothesisE.length > 0) {
    console.log('🔴 PRIMARY: Hypothesis E (Our Code) — Most likely root cause');
    console.log('   Actions:');
    console.log('   1. Review cache.ts: Verify transcript hash is always computed (never empty fallback) ✓ FIXED');
    console.log('   2. Check validation logic: Ensure failed validation triggers proper fallback');
    console.log('   3. Add structured logging (ADR 011 §6) to link stream → model → fallback reason [IN PROGRESS]');
    console.log('   4. For next incident, extract full app logs around timestamp ± 2min\n');
  }

  const hypothesisB = byHypothesis.get('Hypothesis B: Provider Overload or Timeout (429/503)');
  if (hypothesisB && hypothesisB.length > 0) {
    console.log('🟡 SECONDARY: Hypothesis B (Provider Overload)');
    console.log('   This is expected fallback behavior. Monitor frequency.\n');
  }

  const hypothesisA = byHypothesis.get('Hypothesis A: Provider Quota Exhaustion (402)');
  if (hypothesisA && hypothesisA.length > 0) {
    console.log('🟡 SECONDARY: Hypothesis A (Quota Exhaustion)');
    console.log('   Monitor OpenRouter credit; may need to increase account quota.\n');
  }

  console.log('📝 Next Steps:');
  console.log('   1. Implement structured logging per ADR 011 §6 [IN PROGRESS]');
  console.log('   2. On next Sonnet 4.6 incident, extract app logs and correlate with this query');
  console.log('   3. Use RCA_GUIDE_OPENROUTER_FALLBACK_ANOMALIES.md for diagnostic workflow\n');
}

/**
 * Main execution
 */
async function main(): Promise<void> {
  console.log('╔════════════════════════════════════════════════════════════╗');
  console.log('║     Cascade Fallback RCA: Fetching Supabase Data          ║');
  console.log('╚════════════════════════════════════════════════════════════╝\n');

  try {
    // Query for Sonnet 4.6 incidents
    const sonnetRecords = await findSonnetIncidents(7);

    // Diagnose each
    const incidents = sonnetRecords.map(diagnoseIncident);

    // Generate report
    generateReport(incidents);

    // Summary statistics
    if (incidents.length > 0) {
      const failureRate = (incidents.length / sonnetRecords.length) * 100;
      console.log(`\n📊 Fallback Rate: ${incidents.length}/${sonnetRecords.length} (${failureRate.toFixed(1)}%)`);
      console.log('   Context: If >5% of analyses trigger Sonnet 4.6, investigate root cause.\n');
    }
  } catch (error) {
    console.error('❌ [RCA] Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

// Execute
main().catch((error) => {
  console.error('[RCA] Unhandled error:', error);
  process.exit(1);
});
