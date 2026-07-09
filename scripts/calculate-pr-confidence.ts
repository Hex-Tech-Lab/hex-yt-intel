#!/usr/bin/env node

/**
 * PR Confidence Calculator
 *
 * Multidimensional scoring system for pull request readiness:
 * - Cubic: Extract score from PR review comments (30 pts max)
 * - CodeRabbit: Count passed checks in comment (20 pts max)
 * - Snyk: Count resolved security findings (15 pts max)
 * - CI/CD: All GitHub Actions checks passed (10 pts max)
 * - Vercel: Deployment status = READY/PRODUCTION (5 pts max)
 * - CodeQL: Zero blocking alerts (5 pts max)
 *
 * Formula: sum of all points ÷ 85 × 100 = confidence %
 *
 * Usage:
 *   npx tsx scripts/calculate-pr-confidence.ts --pr=129
 *   npm run pr:confidence --pr=129
 */

import { execFileSync } from 'child_process';

interface PRConfidenceBreakdown {
  cubic: number;
  coderabbit: number;
  snyk: number;
  ci_cd: number;
  vercel: number;
  codeql: number;
}

interface PRConfidenceResult {
  pr: number;
  confidence: number;
  breakdown: PRConfidenceBreakdown;
  recommendation: string;
  details: {
    cubic_comment?: string;
    coderabbit_comment?: string;
    snyk_comment?: string;
    ci_status?: string;
    vercel_status?: string;
    codeql_alerts?: number;
  };
  timestamp: string;
}

/**
 * Parse command line arguments
 */
function parseArgs(): number {
  const prArg = process.argv.find((arg) => arg.startsWith('--pr='));
  if (!prArg) {
    console.error('Usage: calculate-pr-confidence --pr=<number>');
    console.error('Example: calculate-pr-confidence --pr=129');
    process.exit(1);
  }
  const prNumber = parseInt(prArg.replace('--pr=', ''), 10);
  if (isNaN(prNumber)) {
    console.error('Invalid PR number');
    process.exit(1);
  }
  return prNumber;
}

/**
 * Query GitHub API using gh CLI
 */
function queryGitHub(query: string): string {
  try {
    const args = ['api', ...query.split(/\s+/)];
    return execFileSync('gh', args, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    // Return empty array JSON for graceful handling
    return '[]';
  }
}

/**
 * Extract Cubic score from PR comments
 * Cubic review tool leaves scores in comments like "Cubic Score: 28/30"
 */
function extractCubicScore(prNumber: number): { score: number; comment?: string } {
  try {
    const commentsJson = queryGitHub(`issues/${prNumber}/comments --paginate --limit=100`);
    const data = JSON.parse(commentsJson || '[]');

    if (!Array.isArray(data)) return { score: 0 };

    for (const comment of data) {
      const body = (comment.body || '').toString();
      if (!body) continue;

      // Look for Cubic score pattern: "Cubic Score: 28/30" or "Cubic: 28"
      const cubicMatch = body.match(/cubic[:\s]+([0-9]+)/i);
      if (cubicMatch) {
        const score = Math.min(parseInt(cubicMatch[1], 10), 30);
        return { score, comment: body.substring(0, 200) };
      }

      // Also look for explicit 28/30 score format in review sections
      if (body.toLowerCase().includes('cubic') && body.includes('/')) {
        const scoreMatch = body.match(/(\d+)\s*\/\s*30/);
        if (scoreMatch) {
          const score = Math.min(parseInt(scoreMatch[1], 10), 30);
          return { score, comment: body.substring(0, 200) };
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pr-confidence] Failed to extract Cubic score:', msg);
  }
  return { score: 0 };
}

/**
 * Extract CodeRabbit score from PR comments
 * Looks for "passed" check counts in CodeRabbit reviews
 */
function extractCodeRabbitScore(prNumber: number): { score: number; comment?: string } {
  try {
    const commentsJson = queryGitHub(`issues/${prNumber}/comments --paginate --limit=100`);
    const data = JSON.parse(commentsJson || '[]');

    if (!Array.isArray(data)) return { score: 0 };

    for (const comment of data) {
      const body = (comment.body || '').toString();
      if (!body || !body.toLowerCase().includes('coderabbit')) continue;

      // Count passed checks: "12 passed checks"
      const passedMatch = body.match(/(\d+)\s+passed/i);
      if (passedMatch) {
        const passed = parseInt(passedMatch[1], 10);
        const score = Math.min(Math.round((passed / 10) * 20), 20);
        return { score, comment: body.substring(0, 200) };
      }

      // Look for explicit X/20 score format
      const scoreMatch = body.match(/(\d+)\s*\/\s*20/);
      if (scoreMatch) {
        const score = Math.min(parseInt(scoreMatch[1], 10), 20);
        return { score, comment: body.substring(0, 200) };
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pr-confidence] Failed to extract CodeRabbit score:', msg);
  }
  return { score: 0 };
}

/**
 * Extract Snyk score from PR comments
 * Looks for resolved security findings
 */
function extractSnyxScore(prNumber: number): { score: number; comment?: string } {
  try {
    const commentsJson = queryGitHub(`issues/${prNumber}/comments --paginate --limit=100`);
    const data = JSON.parse(commentsJson || '[]');

    if (!Array.isArray(data)) return { score: 0 };

    for (const comment of data) {
      const body = (comment.body || '').toString();
      if (!body || !body.toLowerCase().includes('snyk')) continue;

      // Look for resolved issues count: "5 resolved", "10 fixed"
      const resolvedMatch = body.match(/(\d+)\s+(resolved|fixed)/i);
      if (resolvedMatch) {
        const resolved = parseInt(resolvedMatch[1], 10);
        const score = Math.min(resolved, 15);
        return { score, comment: body.substring(0, 200) };
      }

      // Look for explicit X/15 score format
      const scoreMatch = body.match(/(\d+)\s*\/\s*15/);
      if (scoreMatch) {
        const score = Math.min(parseInt(scoreMatch[1], 10), 15);
        return { score, comment: body.substring(0, 200) };
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pr-confidence] Failed to extract Snyk score:', msg);
  }
  return { score: 0 };
}

/**
 * Extract CI/CD status from GitHub Actions checks
 * All checks must pass for full score
 */
function extractCICDStatus(prNumber: number): { score: number; status?: string } {
  try {
    const checksJson = queryGitHub(`repos/{owner}/{repo}/commits/refs/pull/${prNumber}/merge/check-runs`);
    const data = JSON.parse(checksJson || '{}');

    const checkRuns = data.check_runs || [];
    if (checkRuns.length === 0) {
      return { score: 0, status: 'no-checks' };
    }

    const passedCount = checkRuns.filter(
      (check: { conclusion?: string }) => check.conclusion === 'success'
    ).length;

    if (passedCount === checkRuns.length) {
      return { score: 10, status: 'all-passed' };
    }

    // Partial credit
    const score = Math.floor((passedCount / checkRuns.length) * 10);
    return { score, status: `${passedCount}/${checkRuns.length}-passed` };
  } catch (error) {
    // Default to partial score if unable to query
    return { score: 5, status: 'unknown' };
  }
}

/**
 * Extract Vercel deployment status from PR comments
 * Looks for "READY" or "PRODUCTION" status
 */
function extractVercelStatus(prNumber: number): { score: number; status?: string } {
  try {
    // Check PR comments for Vercel bot messages
    const commentsJson = queryGitHub(`issues/${prNumber}/comments --paginate --limit=50`);
    const commentData = JSON.parse(commentsJson || '[]');

    if (Array.isArray(commentData)) {
      for (const comment of commentData) {
        const body = (comment.body || '').toUpperCase();
        if (body.includes('VERCEL')) {
          if (body.includes('READY') || body.includes('PRODUCTION')) {
            return { score: 5, status: 'READY' };
          }
          if (body.includes('DEPLOYED') || body.includes('PREVIEW')) {
            return { score: 3, status: 'deployed' };
          }
        }
      }
    }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[pr-confidence] Failed to extract Vercel status:', msg);
  }
  return { score: 0, status: 'not-deployed' };
}

/**
 * Extract CodeQL alerts from PR
 * Zero blocking alerts = full score
 */
function extractCodeQLStatus(prNumber: number): { score: number; alerts?: number } {
  try {
    // Query for code scanning alerts on the PR (scoped to PR ref)
    const alertsJson = queryGitHub(`repos/{owner}/{repo}/code-scanning/alerts?state=open&sort=updated&direction=desc --paginate --limit=50`);
    const data = JSON.parse(alertsJson || '[]');

    if (!Array.isArray(data)) {
      return { score: 5, alerts: 0 };
    }

    const blockingAlerts = data.filter(
      (alert: { rule?: { severity?: string } }) =>
        alert.rule?.severity === 'critical' || alert.rule?.severity === 'high'
    );

    if (blockingAlerts.length === 0) {
      return { score: 5, alerts: 0 };
    }

    // Partial credit: lose 1 pt per alert (up to 5 pts max loss)
    const score = Math.max(0, 5 - blockingAlerts.length);
    return { score, alerts: blockingAlerts.length };
  } catch (error) {
    // CodeQL might not be configured — default to full score
    return { score: 5, alerts: 0 };
  }
}

/**
 * Calculate recommendation based on confidence percentage
 */
function getRecommendation(confidence: number): string {
  if (confidence >= 85) {
    return 'MERGE READY';
  }
  if (confidence >= 70) {
    return 'ACCEPTABLE (minor debt)';
  }
  if (confidence >= 50) {
    return 'AT RISK (review findings)';
  }
  return 'NOT READY (critical issues)';
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const prNumber = parseArgs();

  console.error(`\n📊 Calculating PR Confidence for #${prNumber}...\n`);

  // Extract all scores in parallel
  const [
    cubicResult,
    coderabbitResult,
    snyxResult,
    cicdResult,
    vercelResult,
    codeqlResult,
  ] = await Promise.all([
    Promise.resolve(extractCubicScore(prNumber)),
    Promise.resolve(extractCodeRabbitScore(prNumber)),
    Promise.resolve(extractSnyxScore(prNumber)),
    Promise.resolve(extractCICDStatus(prNumber)),
    Promise.resolve(extractVercelStatus(prNumber)),
    Promise.resolve(extractCodeQLStatus(prNumber)),
  ]);

  const breakdown: PRConfidenceBreakdown = {
    cubic: cubicResult.score,
    coderabbit: coderabbitResult.score,
    snyk: snyxResult.score,
    ci_cd: cicdResult.score,
    vercel: vercelResult.score,
    codeql: codeqlResult.score,
  };

  const totalPoints = Object.values(breakdown).reduce((a, b) => a + b, 0);
  const confidence = Math.round((totalPoints / 85) * 100);
  const recommendation = getRecommendation(confidence);

  const result: PRConfidenceResult = {
    pr: prNumber,
    confidence,
    breakdown,
    recommendation,
    details: {
      cubic_comment: cubicResult.comment,
      coderabbit_comment: coderabbitResult.comment,
      snyk_comment: snyxResult.comment,
      ci_status: cicdResult.status,
      vercel_status: vercelResult.status,
      codeql_alerts: codeqlResult.alerts,
    },
    timestamp: new Date().toISOString(),
  };

  // Print human-readable summary to stderr
  console.error('\n📈 Breakdown:');
  console.error(`  Cubic:       ${breakdown.cubic}/30`);
  console.error(`  CodeRabbit:  ${breakdown.coderabbit}/20`);
  console.error(`  Snyk:        ${breakdown.snyk}/15`);
  console.error(`  CI/CD:       ${breakdown.ci_cd}/10`);
  console.error(`  Vercel:      ${breakdown.vercel}/5`);
  console.error(`  CodeQL:      ${breakdown.codeql}/5`);
  console.error(`  ─────────────────────`);
  console.error(`  Total:       ${totalPoints}/85`);
  console.error(`\n🎯 Confidence: ${confidence}% (${recommendation})\n`);

  // Output single-line JSON to stdout (last line, for CI extraction)
  console.log(JSON.stringify(result));
}

main().catch((error) => {
  console.error('Error:', error.message);
  process.exit(1);
});
