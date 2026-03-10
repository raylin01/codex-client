# @raylin01/codex-client

Node.js client for controlling Codex CLI app-server over JSON-RPC, with both the raw transport API and a structured thread/turn wrapper.

## Install

```bash
npm install @raylin01/codex-client
```

## Requirements

- Node.js 18+
- Codex CLI available on your PATH (or pass `codexPath`)

## Quickstart

```ts
import { CodexClient } from '@raylin01/codex-client';

const client = await CodexClient.init({
  cwd: process.cwd(),
  approvalPolicy: 'on-request'
});

const turn = client.send('Summarize this repository and mention the riskiest area.');

for await (const update of turn.updates()) {
  if (update.kind === 'output' && update.snapshot.currentOutputKind === 'text') {
    process.stdout.write(update.snapshot.text);
  }

  if (update.kind === 'request') {
    console.log('\nRequest:', update.snapshot.currentMessage.content);
  }
}

await turn.done;
await client.close();
```

## Structured API

- `CodexClient.init(options)` starts the app-server and initializes or resumes a thread
- `client.send(input, options?)` returns a turn handle immediately
- `turn.current()`, `turn.history()`, `turn.updates()`, and `turn.done` expose normalized turn state
- `client.getOpenRequests()` returns pending approvals, questions, and tool calls
- `client.approveRequest(...)`, `client.answerQuestion(...)`, and `client.respondToToolCall(...)` respond to Codex RPC requests without handling raw JSON-RPC directly

## Raw Transport API

If you need direct JSON-RPC control, the original `new CodexClient(...)` API is unchanged.

## Event Model

- `ready`: initialize handshake complete
- `request`: incoming JSON-RPC server request requiring a response
- `notification`: incoming JSON-RPC notification
- `log`: stderr output from app-server
- `error`: protocol/process errors

## API

### `new CodexClient(options)`

- `cwd`, `codexPath`, `args`, `env`
- `analyticsDefaultEnabled`
- `clientInfo` and `capabilities`

### `await CodexClient.init(options)`

- returns a `StructuredCodexClient`
- accepts thread bootstrap options like `resumeThreadId`, `forkThread`, `approvalPolicy`, `sandbox`, and instructions
- keeps the raw client available at `client.raw`

### Core methods

- `start()` and `shutdown()`
- `sendRequest(method, params)`
- `sendResponse(id, result)`
- `sendError(id, error)`

### Convenience wrappers

- Threads: `startThread`, `resumeThread`, `forkThread`, `listThreads`, `readThread`, ...
- Models: `listModels`, `setDefaultModel`
- Config: `readConfig`, `writeConfigValue`, `batchWriteConfig`
- Turns: `startTurn`, `interruptTurn`

## Examples

See `/examples`:

- `basic.ts`
- `events.ts`
- `error-handling.ts`

## Troubleshooting

- If startup fails, verify `codex app-server` runs from your shell.
- Listen for `log` and `error` events to debug handshake failures.

## Versioning

This package uses independent semver releases.

## Used by DisCode

DisCode uses this package as a real-world integration example:

- [raylin01/DisCode](https://github.com/raylin01/DisCode)

## License

ISC
