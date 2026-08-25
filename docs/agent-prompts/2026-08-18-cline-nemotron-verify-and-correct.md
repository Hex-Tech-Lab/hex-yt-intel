# Agent Dispatch — Cline (Nemotron 3.5 Lightning, low effort) — self-verify and correct today's MCP-config mistakes

## Model-tuning note
This is a first real test of Nemotron 3.5 Lightning (low effort) on Cline — untested capability, verify everything it claims, don't assume competence carries over from prior model/tool combos. Low-effort tier: literal numbered steps, not prose principles — same rule as OC/AGY dispatches.

## 0. Ledger protocol — ALWAYS
Follow `AGENTS.md` §5 in full: read `.memory/AGENT_LEDGER.md` and `.memory/ADRS.md` before touching any file. Post `[IN_PROGRESS]` with intent + target files as your first action. Post `[DONE]`/`[PARTIAL]`/`[BLOCKED]` with a real summary of what you actually did (not what you intended) as your last action.

## 1. Context
Earlier today (2026-08-17), you (Cline, on a different model config) made four real, verified mistakes while setting up MCP servers in this repo's `.mcp.json`: (1) printed 5 live API key values in plaintext into chat instead of confirming presence only, (2) used `uvx` for npm packages when it only runs PyPI packages, (3) then correctly identified them as npm packages but used `npx`, which is broken in this project's WSL2 environment (should have been `pnpm dlx`), (4) reported a config as "fixed" without re-reading the actual file, so the report described a state that didn't match disk. These are now permanently documented in `AGENTS.md` §5.0.3 ("Real incident record — MCP config task, 2026-08-17"). This is a first test of a different model (Nemotron 3.5 Lightning, low effort) to see whether it avoids repeating the same class of mistake, given the same guardrails already written down.

## 2. Task
1. Read `AGENTS.md` in full at this repo's root, especially §5.0.1 (standing preferences), §5.0.2 (skill stack), and §5.0.3 (the incident record above) before doing anything else.
2. Read the current, real state of `/home/kellyb_dev/projects/hex-yt-intel/.mcp.json` directly from disk — do not assume or recall its contents from any prior conversation.
3. Verify each of the following against real, current evidence (not memory, not assumption):
   - Is `uvx` or `pnpm dlx`/`npx` used for each server, and does that match the real package registry each package lives on (PyPI vs npm)? Check the real registry page for each package name before concluding.
   - Are the `exa` and `brave-search` package names (`exa-mcp-server`, `@modelcontextprotocol/server-brave-search`) real, independently verifiable packages — confirm by checking their actual npm registry pages, not by pattern-matching a string that looks plausible.
   - Are API keys referenced via env-var substitution (e.g. `${EXA_API_KEY}`), never hardcoded as literal key values in the file?
4. If you find anything wrong, fix it — using `pnpm dlx`, never `npx`/`npm` (broken in this WSL2 environment per project standing rule).
5. Do NOT print any real API key value into your chat output at any point in this task, for any reason, including "to verify" or "to show the fix worked" — confirm presence only (e.g. `grep -c "^EXA_API_KEY" .env.local`, redacted).
6. After any edit, re-read the actual file from disk and quote what's really there in your report — do not report "fixed" from memory of what you intended to write.

## 3. Goal / definition of done
A real, verified `.mcp.json` where every command/package/registry pairing is independently confirmed correct (not assumed), no credential values appear anywhere in your output, and your final report quotes the actual post-edit file content pulled from a fresh read, not from what you wrote a moment ago.

## 4. Expected results
- `.mcp.json` either confirmed already-correct (with evidence cited) or corrected in place.
- A `.memory/AGENT_LEDGER.md` entry documenting what you checked and found.
- No new files needed for this task.

## 5. Task-specific skills/tools/MCPs
No production code touched — qa-intel/contract-auditor/simplify don't apply here. This is a config-verification task; the relevant skill is just the disciplined verification process itself, per §5.0.3.

## 6. Fixtures
Starting state: `/home/kellyb_dev/projects/hex-yt-intel/.mcp.json` as it currently exists on disk (read it fresh, don't trust this prompt's description of it).

## 7. The three tenets — ALWAYS
1. **Contract**: state exactly what "correct" means for this file (real registry match, pnpm dlx, env-var key refs, no plaintext keys) before checking it.
2. **E2E proof**: don't just eyeball the JSON — cite the actual real registry page or command output that confirms each package/command pairing is right.
3. **Tangent hunt**: if you notice any other config file in this repo with the same class of issue (wrong package manager, invented package name, hardcoded secret), report it even if you don't fix it this pass.

If you're not confident a package name or registry claim is real, STOP and say so rather than asserting it — this is exactly the failure mode from the incident record.

## 8. Report format — ALWAYS
RCA (what you checked and why) → Contract → Findings (correct as-is, or what was wrong) → Fix (if any) → E2E proof (real command/registry output cited) → Tangents found → Skills/process followed → Files changed.

## 9. Gates
No build/test gates apply — this is a JSON config file, not application code. Confirm the file is valid JSON after any edit (`cat .mcp.json | python3 -m json.tool` or equivalent) as the only required check.
