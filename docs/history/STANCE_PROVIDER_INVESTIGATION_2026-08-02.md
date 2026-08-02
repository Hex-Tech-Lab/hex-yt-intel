# Stance-Relations Provider Attribution Investigation (2026-08-02)

## Background

User reported an observed pattern: stance-relations cascade requesting Groq
but allegedly being served by Cerebras in 2-of-3 videos within a single
session. Provider-attribution logging was added this session
(`web/lib/intelligence/relations-engine.ts`, gated by the new
`observability.logProviderAttribution` settings key) specifically to make
requested-vs-served provider mismatches visible going forward — previously
a cascade "succeeding" only ever meant OpenRouter returned 200, never
recorded which provider actually served it.

## Data available

Sentry does **not** capture this — the log line is `console.log` only, by
design (cheap, high-volume-safe, no Sentry event cost per the settings
migration comment). The only source is Vercel runtime logs, whose retention
on this project's plan is short (Pro tier: ~24h/1-day window per the API's
own response). Historical data from earlier in the session (when the pattern
was originally reported) is outside that retention window and unrecoverable.

## What was found (single live sample, 2026-08-02 22:13 UTC)

```
GET /api/analyses/607d7243-da9c-4fc2-9a4c-e74c67d374af/relations 200
[relations/engine] Cascade attempt 1/4: gpt-oss-120b (Groq) (openai/gpt-oss-120b)
[relations/engine] Requested provider=groq model=openai/gpt-oss-120b, OpenRouter served via provider=Groq
[relations/engine] Successfully extracted 6 stance relation insights using openai/gpt-oss-120b
```

**Clean match** — requested Groq, served by Groq, tier 1/4, no fallback. This
contradicts the user-reported substitution pattern, but is a single data
point and does not disprove it; the reported pattern may be intermittent,
load-dependent on OpenRouter's/Groq's side, or specific to conditions not
present in this one sample.

## Real observability gap identified (unresolved)

Current logging only records the **final successful tier's** attribution. If
Groq is attempted, fails or times out, and the cascade legitimately falls
back to Cerebras (tier 2+), the log for that call would show
`Requested provider=cerebras ... served via provider=Cerebras` — indistinguishable
from a first-attempt success. There is currently no logged evidence of *why*
a fallback happened (Groq 429, Groq timeout, Groq malformed response, etc.)
at the cascade-tier level for stance relations specifically — only the
generic `console.warn` per failed tier in `callStanceModelStream`, which is
not attribution-tagged the same way.

**To actually resolve the user's original observation**, the fix is not more
investigation but more targeted logging: capture and surface the tier-level
failure reason (not just "trying next tier") so a genuine Groq→Cerebras
fallback is distinguishable from a Groq request that OpenRouter silently
re-routed. This is scoped as future work, not done in this session.

## Conclusion

Inconclusive with current data. One real sample available (clean, no
mismatch) due to short Vercel log retention destroying the original
session's evidence window. Recommend re-running this investigation the next
time the user observes the substitution pattern live, ideally within the
same session so retention doesn't erase the evidence before it can be
pulled.
