# Changelog

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
