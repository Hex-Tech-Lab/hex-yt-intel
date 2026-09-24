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
import * as legacyRules from "../index";
import { SqlSecurityDefinerCallerKeyRule, SqlDropFunctionDefaultArgRule } from "../sql-migrations";
import { QualityEngine } from "../../application/QualityEngine";
import type { Rule } from "../../domain/Rule";

function checkSql(
  rule: Rule,
  code: string,
  path = "supabase/migrations/20260924000000_test_rule_fixture.sql",
  allFiles?: string[],
) {
  const project = new Project({ useInMemoryFileSystem: true });
  const source = project.createSourceFile(path, code);
  // Pass the repo-relative `path` (not source.getFilePath(), which ts-morph's
  // in-memory fs prefixes with '/') — matches production, where the engine
  // hands rules repo-relative paths.
  return rule.check({ filePath: path, ast: source, allFiles }) as { severity: string; title: string }[];
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

  test("pre-wave migration that IS changed in the current scan (ctx.allFiles) is NOT downgraded (2026-09-25 review gap)", () => {
    const findings = checkSql(
      SqlSecurityDefinerCallerKeyRule,
      R4_HISTORICAL_PRE_FIX,
      "supabase/migrations/20260701000000_old_pre_wave.sql",
      ["supabase/migrations/20260701000000_old_pre_wave.sql"]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].severity).toBe("high");
  });

  test("balanced-paren signature: vector(1536) before p_key does not hide the key param", () => {
    const findings = checkSql(
      SqlSecurityDefinerCallerKeyRule,
      R4_HISTORICAL_PRE_FIX.replace(
        "  p_id uuid,\n",
        "  p_embedding vector(1536),\n  p_id uuid,\n"
      )
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].why).toContain("'p_key'");
  });

  test("fires when a SECOND key-like text param is unguarded even if the first is allowlisted", () => {
    const twoKeyParams = R4_HISTORICAL_PRE_FIX.replace(
      "  p_value jsonb",
      "  p_value jsonb,\n  p_sort_col text"
    );
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, twoKeyParams);
    expect(findings).toHaveLength(1);
    expect(findings[0].why).toContain("'p_key', 'p_sort_col'");
  });

  test("generic /allowlist/ word in a comment does NOT close the surface (structural guard required)", () => {
    const commentAllowlist = R4_HISTORICAL_PRE_FIX.replace(
      "  affected integer;",
      "  affected integer;\n  -- allowlist enforcement handled elsewhere (TODO)"
    );
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, commentAllowlist);
    expect(findings).toHaveLength(1);
  });

  test("ACL posture matching survives parenthesized types in the signature (vector(1536))", () => {
    const vectorSig = R4_HISTORICAL_PRE_FIX
      .replace("  p_id uuid,\n", "  p_embedding vector(1536),\n  p_id uuid,\n")
      .replace(
        "revoke execute on function public.merge_analysis_payload_key(uuid, text, jsonb) from anon, public;\ngrant execute on function public.merge_analysis_payload_key(uuid, text, jsonb) to authenticated, service_role;",
        [
          "revoke all on function public.merge_analysis_payload_key(vector(1536), uuid, text, jsonb) from anon, authenticated, public;",
          "grant execute on function public.merge_analysis_payload_key(vector(1536), uuid, text, jsonb) to service_role;",
        ].join("\n")
      );
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, vectorSig);
    expect(findings).toHaveLength(0);
  });

  test("ACL posture is matched per exact signature (arity): a grant to a different-arity overload does not expose this block", () => {
    const overloaded = R4_HISTORICAL_PRE_FIX.replace(
      "revoke execute on function public.merge_analysis_payload_key(uuid, text, jsonb) from anon, public;\ngrant execute on function public.merge_analysis_payload_key(uuid, text, jsonb) to authenticated, service_role;",
      [
        "revoke all on function public.merge_analysis_payload_key(uuid, text, jsonb) from anon, authenticated, public;",
        "grant execute on function public.merge_analysis_payload_key(uuid, text, jsonb) to service_role;",
        "grant execute on function public.merge_analysis_payload_key(uuid, text, jsonb, int) to authenticated;",
      ].join("\n")
    );
    const findings = checkSql(SqlSecurityDefinerCallerKeyRule, overloaded);
    expect(findings).toHaveLength(0);
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

  test("fires with a trailing CASCADE (2026-09-25 review gap)", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      R13_HISTORICAL_PRE_FIX.replace(/\)\s*;$/, ") CASCADE;")
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].why).toContain("search_analyses_semantic");
  });

  test("fires with a trailing RESTRICT", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      R13_HISTORICAL_PRE_FIX.replace(/\)\s*;$/, ") RESTRICT;")
    );
    expect(findings).toHaveLength(1);
  });

  test("fires on each target of a multi-target DROP FUNCTION statement", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      `
      DROP FUNCTION IF EXISTS public.fn_a(vector(1536), timestamptz DEFAULT NULL), public.fn_b(uuid, int);
      `
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].why).toContain("fn_a");
  });

  test("balanced-paren args: vector(1536) does not break the argument scan", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      R13_HISTORICAL_PRE_FIX
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].why).toContain("DEFAULT NULL");
  });

  test("pre-wave migration that IS changed in the current scan (ctx.allFiles) is NOT downgraded", () => {
    const findings = checkSql(
      SqlDropFunctionDefaultArgRule,
      R13_HISTORICAL_PRE_FIX,
      "supabase/migrations/20260701000000_old_pre_wave.sql",
      ["supabase/migrations/20260701000000_old_pre_wave.sql"]
    );
    expect(findings[0].severity).toBe("high");
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

describe("WAVE Q4 integration: SQL migrations reach SQL rules through the real QualityEngine (diff + full)", () => {
  const TS_FILE_WITH_SQL_TEXT = "web/lib/migration-doc.ts";
  const SQL_FILE = "supabase/migrations/20260925000000_new_rule_fixture.sql";

  function makeEngine(files: Record<string, string>, mode: "diff" | "full") {
    const project = new Project({ useInMemoryFileSystem: true });
    for (const [p, c] of Object.entries(files)) project.createSourceFile(p, c, { overwrite: true });
    const loader = {
      load: async (p: string) => project.getSourceFile(p)!,
      loadFromText: async (p: string, t: string) => project.createSourceFile(p, t, { overwrite: true }),
      getImports: () => [] as string[],
    };
    const fs = {
      exists: (p: string) => !!project.getSourceFile(p),
      resolve: (p: string) => p,
    };
    const engine = new QualityEngine(
      [SqlSecurityDefinerCallerKeyRule, SqlDropFunctionDefaultArgRule] as Rule[],
      loader as any,
      undefined,
      fs as any,
      { mode, defaultScope: "file", concurrency: 1 }
    );
    return { engine, project };
  }

  const SQL_RULE_TEXT = R13_HISTORICAL_PRE_FIX;

  test.each(["diff", "full"] as const)("changed .sql file reaches the SQL rules in %s mode; TS is excluded from SQL-only rules", async (mode) => {
    const files: Record<string, string> = {
      [SQL_FILE]: SQL_RULE_TEXT,
      [TS_FILE_WITH_SQL_TEXT]: `export const DOC = \`${SQL_RULE_TEXT}\`;`,
    };
    const { engine } = makeEngine(files, mode);
    const findings = await engine.analyze(Object.keys(files));
    const sqlFindings = findings.filter((f) => f.file.endsWith(".sql"));
    const tsFindings = findings.filter((f) => f.file.endsWith(".ts"));
    expect(sqlFindings).toHaveLength(1);
    expect(sqlFindings[0]!.severity).toBe("high");
    expect(tsFindings).toHaveLength(0);
  });
});
