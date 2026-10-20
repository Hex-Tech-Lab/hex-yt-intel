---
name: jev_decision_router
description: Classify text with TypeSafe Jev via OpenRouter's Decisions API. Invoke when asked to "use Jev to sort/score/classify these".
metadata:
  type: reference
---

# Jev decision router

Jev answers structured questions over a piece of text. Each question is one of three primitives. Use the client in `scripts/jev/jevRouter.ts`; do not hand-roll HTTP.

## When to use
Triggers: "Use Jev to sort these", "score these leads with Jev", "classify with Jev", "is this a bug per Jev".

## How to run
1. Build a `questions` map and a `state` object (the text under test).
2. Call `askJev(apiKey, questions, state)` with `apiKey = readEnvKey('web/.env.local', 'OPENROUTER_API_KEY')`.
3. Read `response.answers[name]` per question. Report `latencyMs`, `usage.cost`, and the raw answers.
4. Live E2E reference: `pnpm tsx scripts/test_jev_router.ts`.

Never print the key. It lives in `web/.env.local`, which `.gitignore` covers via `.env*`.

## Endpoint and model
- `POST https://openrouter.ai/api/alpha/decisions`, `Authorization: Bearer <key>`.
- Model: `typesafe/jev-1.13`. Resolves to `typesafe/jev-1.13-20260917`, provider `TypeSafe`.
- `typesafe/jev-router` is NOT accepted by this endpoint (HTTP 400 "does not exist"). The `/api/v1/models` list shows it, but do not use it here.

## Schema mapping (the three primitives)

| Primitive | Question shape | Answer shape | Meaning |
|---|---|---|---|
| `noul` | `{type:'noul', instructions, criteria:{true, false}}` | `{type:'noul', noul: number}` | Probability the statement is true, 0..1 |
| `choice` | `{type:'choice', instructions, criteria: {key: description}}` | `{type:'choice', choice, probabilities, confidence}` | One key from `criteria` |
| `score` | `{type:'score', instructions, criteria: [ordered labels]}` | `{type:'score', score, legend, probabilities, confidence}` | Ordinal position, fractional. `legend` maps index to label |

Do not invent other shapes. Jev returns only these three. Coerce nothing.

## Cost and latency
Observed on the E2E run: about 1.0 s, about $0.00003 per call for three questions and about 600 input tokens.

## Gotchas
- `score` is fractional (2.99 means mostly index 3). Use `Math.round` only if the caller asks for a discrete label.
- `probabilities` keys are strings ("0", "1"), not numbers.

Client: [[scripts/jev/jevRouter.ts]]. Live test: [[scripts/test_jev_router.ts]].
