# Changelog

## 0.2.3

- Added synthetic attached-turn handling so structured Codex clients can answer approvals and questions on resumed waiting turns.
- Added regression coverage for answering provider-originated question requests without a locally started turn.

## 0.2.2

- Added shared provider-neutral session browser types for raw plus normalized transcript access.
- Added a new read-only `./sessions` entrypoint with `listCodexSessionSummaries(...)` and `readCodexSessionRecord(...)`.
- Added normalized Codex thread extraction for user input, assistant output, reasoning, plans, command execution, file changes, and MCP calls.
- Added session browser tests for the new thread browsing surface.

## 0.2.1

- Added `createQuestionSession(...)` to the structured client for incremental multi-question workflows.
- Added `getOpenRequest(id)` for direct structured request lookup.
- Tightened approval mapping to only expose real Codex protocol capabilities, using `scope: 'once' | 'session'` plus `execPolicyAmendment` for command approvals.
- Updated tests and README guidance for the revised approval and question helpers.

## 0.2.0

- Added a structured thread and turn API via `CodexClient.init(...)`.
- Added normalized approval, question, and tool-call request handling helpers.
- Updated examples, tests, and package exports for the structured client surface.

## 0.1.0

- Initial standalone public package release.
- Added dual ESM/CJS builds with typed exports.
- Added tests, examples, and expanded package documentation.
