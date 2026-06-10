# PR #62 Review Matrix
Status: Review Blocked - CI/CD Integration Authentication Failure

## 1. CI Integration Status
- CodeRabbit: FAILED (Authentication: 401 Unauthorized)
- SonarCloud: FAILED (Authentication: Not connected)
- Snyk: PASSED (Global scan findings below)

## 2. Global Snyk Scan Findings (High Severity)
| Issue Type | File Path | Message |
|---|---|---|
| Hardcoded Secret | /web/.tests-parked-backup/config.ts:53 | Avoid hardcoding values meant to be secret |
| Hardcoded Secret | /web/lib/chat/outbox.ts:19 | Avoid hardcoding values meant to be secret |
| Hardcoded Secret | /web/playwright.config.ts:36-38 | Avoid hardcoding values meant to be secret |
| Path Traversal | /recovered_skills/.../discord/server.ts:429 | Unsanitized input into fs.writeFileSync |
| Path Traversal | /recovered_skills/.../fakechat/server.ts:113 | Unsanitized input into fs.copyFileSync |
| Path Traversal | /recovered_skills/.../fakechat/server.ts:165 | Unsanitized input into fs.readFileSync |
| SSRF | /recovered_skills/.../discord/server.ts:422 | Unsanitized input into fetch |

## 3. Resolution Plan
1. **Fix Authentication**: Re-authenticate the GitHub, CodeRabbit, and SonarCloud MCP servers to enable PR-specific reporting.
2. **Remediate High Severity Issues**:
   - Remove hardcoded secrets from `config.ts`, `outbox.ts`, and `playwright.config.ts`. Use environment variables (`process.env`).
   - Audit `recovered_skills/` for path traversal and SSRF vulnerabilities in `discord/server.ts` and `fakechat/server.ts`. If these are unused/recovered/legacy, move/delete them to remove the risk.
3. **Re-run CI**: Re-run automated PR checks.

## 4. Readiness for Phase 5
Status: **NOT READY**. PR review blocked by CI/CD authentication failures and outstanding high-severity security findings.
