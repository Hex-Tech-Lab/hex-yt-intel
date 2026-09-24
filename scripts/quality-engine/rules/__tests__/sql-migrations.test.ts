/**
 * Wave Q4 (2026-09-24): SQL migration rules — R4 + R13.
 *
 * Each rule carries a positive-fire test on the REAL historical snippet (the
 * pre-fix migration content quoted verbatim from the git history below) and a
 * negative-control test on the fixed/safe shape. See
 * docs/qa-intel/RULESET_LESSONS_LEDGER.md entry 2026-09-24 and
 * docs/reviews/2026-09-24-pr322-external-review.md.
 */

import { describe, test, expect } from "vitest";
import { Project } from "ts-morph";
import type { SourceFile } from "ts-morph";
import * as legacyRules from "../index";
import { SqlSecurityDefinerCallerKeyRule, SqlDropFunctionDefaultArgRule } from "../sql-migrations";
import { ConflictMarkerRule } from "../data-lessons-20260924";

function createSqlSource(code: string, path = "supabase/migrations/20260924000000_test_rule_fixture.sql"): SourceFile {
  const project = new Project({ useInMemoryFileSystem: true });
  return project.createSourceFile(path, code);
}

function checkSql(rule: { check(ctx: { filePath: string; ast: SourceFile }): unknown[] }, code: string, path?: string) {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(path ?? "supabase/migrations/20260924000000_test_rule_fixture.sql", code);
  return rule.check({ filePath: source.getFilePath(), ast: source }) as { severity: string; title: string }[];
}

// R4 positive fixture — verbatim pre-fix content of
// supabase/migrations/20260924120000_merge_analysis_payload_key_rpc.sql
// (branch feat/stance-dual-persistence-wordcloud, head afe276a1; the missing
// key allowlist was the P1 fixed by CC commit c230345c on 2026-09-24).
const R4_HISTORICAL_PRE_FIX = `
create or replace function public.merge_analysis_payload_key(
  p_id uuid,
  p_key text,
  p_value jsonb
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected integer;
begin
  if p_key is null or p_key !~ '^[a-zA-Z0-9_]{1,64}$' then
    raise exception 'merge_analysis_payload_key: invalid payload key';
  end if;
  if p_value is null then
    raise exception 'merge_analysis_payload_key: null payload value not allowed';
  end if;
  update public.analyses
    set analysis_payload = jsonb_set(
          analysis_payload,
          array[p_key],
          p_value,
          true
        )
    where id = p_id
      and (
        auth.role() = 'service_role'
        or (auth.uid() is not null and user_id = auth.uid())
      );

  get diagnostics affected = row_count;
  return affected;
end;
$$;

revoke execute on function public.merge_analysis_payload_key(uuid, text, jsonb) from anon, public;
grant execute on function public.merge_analysis_payload_key(uuid, text, jsonb) to authenticated, service_role;
`;

// R4 negative fixture — the FIXED shape (CC c230345c): allowlist guard added.
const R4_FIXED = R4_HISTORICAL_PRE_FIX.replace(
  `  if p_value is null then`,
  `  if p_key not in ('stance_relations') then
    raise exception 'merge_analysis_payload_key: key % is not merge-allowed', p_key;
  end if;
  if p_value is null then`
);

// R13 positive fixture — verbatim pre-fix content of
// supabase/migrations/20260924143739_drop_unused_pgvector.sql (commit
// b2f1648d; DEFAULT in a DROP FUNCTION arg list is a Postgres syntax error
// that broke the Supabase preview branch; fixed ccb6f85a).
const R13_HISTORICAL_PRE_FIX = `
DROP FUNCTION IF EXISTS public.search_analyses_semantic(
  query_embedding vector(1536),
  match_threshold float,
  match_count int,
  p_user_id uuid,
  p_date_from timestamp with time zone DEFAULT NULL,
  p_date_to timestamp with time zone DEFAULT NULL
);
`;

// R13 negative fixture — the FIXED shape (ccb6f85a): types only.
const R13_FIXED = `
DROP FUNCTION IF EXISTS public.search_analyses_semantic(
  vector, double precision, integer, uuid, timestamp with time zone, timestamp with time zone
);
`;

// Negative control that exists on the CURRENT repo (real migration): a
// SECURITY DEFINER function with a key-shaped text parameter whose EXECUTE
// is fully revoked from the three untrusted roles (and granted only to
// service_role) must NOT fire — supabase/migrations/20260723200000_prompt_
// vault_registry.sql get_prompt_secret(p_key text).
const R4_NEGATIVE_FULLY_REVOKED = `
create or replace function public.get_prompt_secret(p_key text)
returns text
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_secret_id uuid;
begin
  select secret_id into v_secret_id from public.prompt_definitions where key = p_key;
  return v_secret_id;
end;
$$;

revoke all on function public.get_prompt_secret(text) from public, anon, authenticated;
grant execute on function public.get_prompt_secret(text) to service_role;
`;

describe("WAVE Q4: SqlSecurityDefinerCallerKeyRule (R4)", () => {
  test("fires on the real historical pre-fix merge_analysis_payload_key RPC (afe276a1)", () => {
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, R4_HISTORICAL_PRE_FIX);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("SECURITY DEFINER");
    expect(findings[0].why).toContain("'p_key'");
  });

  test("does not fire on the fixed shape (key allowlist, c230345c)", () => {
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, R4_FIXED);
    expect(findings).toHaveLength(0);
  });

  test("does not fire on a SECURITY DEFINER function fully revoked from anon/authenticated/public (real on-disk get_prompt_secret shape)", () => {
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, R4_NEGATIVE_FULLY_REVOKED);
    expect(findings).toHaveLength(0);
  });

  test("does not fire when the function is SECURITY INVOKER", () => {
    const invoker = R4_HISTORICAL_PRE_FIX.replace("security definer", "security invoker");
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, invoker);
    expect(findings).toHaveLength(0);
  });

  test("does not fire when the definer function has no key/column/path-shaped text parameter", () => {
    const noKeyParam = R4_HISTORICAL_PRE_FIX
      .replace("  p_key text,\n", "")
      .replace(/p_key/g, "p_fixed_key_literal")
      .replace(
        "auth.role() = 'service_role'",
        "auth.role() = 'service_role' and 'x' <> 'y' -- p_fixed_key_literal is not a parameter"
      );
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, noKeyParam);
    expect(findings).toHaveLength(0);
  });

  test("pre-wave migrations (already applied) are downgraded to informational low severity", () => {
    const findings = checkSql(
      SqlSecurityDefinerCallerKeyRule,
      R4_HISTORICAL_PRE_FIX,
      "supabase/migrations/20260701000000_old_pre_wave.sql"
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
  });

  test("is registered in the real Object.values(legacyRules) production set", () => {
    expect(Object.values(legacyRules)).toContain(SqlSecurityDefinerCallerKeyRule);
  });

  test("is silent on non-SQL files (TS/TSX remain outside this rule's scope)", () => {
    const findings = checkSql(
      SqlSecurityDefinerCallerKeyRule,
      R4_HISTORICAL_PRE_FIX,
      "web/lib/some-file.ts"
    );
    expect(findings).toHaveLength(0);
  });
});

describe("WAVE Q4: SqlDropFunctionDefaultArgRule (R13)", () => {
  test("fires on the real historical pre-fix drop_unused_pgvector migration (b2f1648d)", () => {
    const findings = checkSql(SqlDropFunctionDefaultArgRule, R13_HISTORICAL_PRE_FIX);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("DEFAULT clause");
    expect(findings[0].why).toContain("search_analyses_semantic");
  });

  test("does not fire on the fixed shape (types only, ccb6f85a)", () => {
    const findings = checkSql(SqlDropFunctionDefaultArgRule, R13_FIXED);
    expect(findings).toHaveLength(0);
  });

  test("does not fire on a CREATE FUNCTION with DEFAULT arguments (CREATE allows DEFAULT; only DROP does not)", () => {
    const createWithDefault = `
      create or replace function public.some_fn(
        p_date_from timestamptz DEFAULT NULL
      ) returns void
      language sql
      as $$ select 1 $$;
    `;
    const findings = checkSql(SqlDropFunctionDefaultArgRule, createWithDefault);
    expect(findings).toHaveLength(0);
  });

  test("does not fire on a DROP FUNCTION without DEFAULT in its argument list", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      "DROP FUNCTION IF EXISTS public.ok_fn(uuid, int);"
    );
    expect(findings).toHaveLength(0);
  });

  test("pre-wave migrations are downgraded to informational low severity", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      R13_HISTORICAL_PRE_FIX,
      "supabase/migrations/20260701000000_old_pre_wave.sql"
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("low");
  });

  test("is registered in the real Object.values(legacyRules) production set", () => {
    expect(Object.values(legacyRules)).toContain(SqlDropFunctionDefaultArgRule);
  });
});

// Merge semantics of PR #334 (Q3 R12 × Q4 SQL-migration surface):
// supabase/migrations/*.sql run BOTH the SQL rules (R4/R13) and R12
// (ConflictMarkerRule, opted into languages ["ts","sql"]).
describe("migration SQL runs the full gated rule set AND ConflictMarkerRule (PR #334)", () => {
  // Markers built via concat so this file itself never contains literal
  // conflict-marker lines (the pre-commit `git grep` gate would trip).
  const START = "<" + "<".repeat(6) + " HEAD";
  const SEP = "=".repeat(7);
  const END = ">" + ">".repeat(6) + " origin/main";
  const CONFLICTED_MIGRATION = `
${START}
drop function if exists public.fn_x(p_ts timestamptz DEFAULT NULL);
${SEP}
drop function if exists public.fn_x(p_ts timestamptz);
${END}
`;

  test("R12 (ConflictMarkerRule) flags a conflicted SQL migration", () => {
    const findings = checkSql(ConflictMarkerRule, CONFLICTED_MIGRATION);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("conflict markers");
  });

  test("R13 (SqlDropFunctionDefaultArgRule) still fires on the same conflicted migration", () => {
    const findings = checkSql(SqlDropFunctionDefaultArgRule, CONFLICTED_MIGRATION);
    expect(findings).toHaveLength(1);
    expect(findings[0].title).toContain("DROP FUNCTION");
  });

  test("ConflictMarkerRule opts into sql language gating so the engine routes it to migrations", () => {
    expect(ConflictMarkerRule.languages).toContain("sql");
    expect(ConflictMarkerRule.languages).toContain("ts");
  });
});
