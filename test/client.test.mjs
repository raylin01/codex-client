import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import {
  CodexClient,
  StructuredCodexClient,
  listCodexSessionSummaries,
  readCodexSessionRecord
} from '../dist/esm/index.js';

class FakeCodexRawClient extends EventEmitter {
  constructor() {
    super();
    this.turnCounter = 0;
    this.startTurnCalls = [];
    this.responses = [];
    this.errors = [];
  }

  async startTurn(params) {
    this.startTurnCalls.push(params);
    this.turnCounter += 1;
    return { turn: { id: `remote-${this.turnCounter}` } };
  }

  sendResponse(id, result) {
    this.responses.push({ id, result });
  }

  sendError(id, error) {
    this.errors.push({ id, error });
  }

  async interruptTurn() {
    return {};
  }

  async shutdown() {}
}

function makeClientWithStubbedProc() {
  const client = new CodexClient({ cwd: process.cwd() });
  const writes = [];

  client.proc = {
    stdin: {
      destroyed: false,
      write: (line) => {
        writes.push(line);
        return true;
      }
    }
  };

  return { client, writes };
}

test('sendRequest writes JSON-RPC payload', async () => {
  const { client, writes } = makeClientWithStubbedProc();

  const pending = client.sendRequest('thread/list', { limit: 5 });
  const payload = JSON.parse(writes[0]);

  assert.equal(payload.method, 'thread/list');
  assert.deepEqual(payload.params, { limit: 5 });

  client.handleLine(JSON.stringify({ id: payload.id, result: { data: [] } }));
  const result = await pending;
  assert.deepEqual(result, { data: [] });
});

test('sendRequest rejects when response has error', async () => {
  const { client, writes } = makeClientWithStubbedProc();

  const pending = client.sendRequest('thread/list', {});
  const payload = JSON.parse(writes[0]);
  client.handleLine(JSON.stringify({ id: payload.id, error: { message: 'boom' } }));

  await assert.rejects(pending, /boom/);
});

test('handleLine emits notification and request events', () => {
  const { client } = makeClientWithStubbedProc();
  const notifications = [];
  const requests = [];

  client.on('notification', (n) => notifications.push(n));
  client.on('request', (r) => requests.push(r));

  client.handleLine(JSON.stringify({ method: 'thread/started', params: { thread: { id: 't1' } } }));
  client.handleLine(JSON.stringify({ id: 1, method: 'item/tool/requestUserInput', params: { questions: [] } }));

  assert.equal(notifications.length, 1);
  assert.equal(requests.length, 1);
});

test('handleLine emits parse errors for invalid JSON', () => {
  const { client } = makeClientWithStubbedProc();
  const errors = [];

  client.on('error', (error) => errors.push(error));
  client.handleLine('{bad json');

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /Failed to parse codex message/);
});

test('structured client normalizes codex deltas and approval requests', async () => {
  const raw = new FakeCodexRawClient();
  const client = StructuredCodexClient.fromRawClient(raw, 'thread-1');
  const turn = client.send('Inspect the repo');

  await new Promise((resolve) => setTimeout(resolve, 0));
  raw.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });
  raw.emit('notification', {
    method: 'item/reasoning/textDelta',
    params: { threadId: 'thread-1', turnId: 'remote-1', itemId: 'reason-1', delta: 'Thinking' }
  });
  raw.emit('notification', {
    method: 'item/agentMessage/delta',
    params: { threadId: 'thread-1', turnId: 'remote-1', itemId: 'msg-1', delta: 'Hello' }
  });
  raw.emit('notification', {
    method: 'item/started',
    params: {
      threadId: 'thread-1',
      turnId: 'remote-1',
      item: { id: 'cmd-1', type: 'commandExecution', command: 'pwd', cwd: '/repo' }
    }
  });
  raw.emit('notification', {
    method: 'item/commandExecution/outputDelta',
    params: { threadId: 'thread-1', turnId: 'remote-1', itemId: 'cmd-1', delta: '/repo' }
  });
  raw.emit('request', {
    id: 7,
    method: 'item/commandExecution/requestApproval',
    params: { threadId: 'thread-1', turnId: 'remote-1', itemId: 'cmd-1', command: 'pwd', cwd: '/repo' }
  });

  const openRequests = client.getOpenRequests();
  assert.equal(openRequests.length, 1);
  assert.equal(openRequests[0].kind, 'tool_approval');

  await client.approveRequest(openRequests[0].id, { behavior: 'allow', scope: 'session' });
  assert.deepEqual(raw.responses[0], {
    id: 7,
    result: { decision: 'acceptForSession' }
  });

  raw.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });

  const snapshot = await turn.done;
  assert.equal(snapshot.status, 'completed');
  assert.equal(snapshot.text, 'Hello');
  assert.equal(snapshot.thinking, 'Thinking');
  assert.equal(snapshot.toolUses.length, 1);
  assert.equal(snapshot.toolResults[0].content, '/repo');
});

test('structured client queues turns and answers question requests', async () => {
  const raw = new FakeCodexRawClient();
  const client = StructuredCodexClient.fromRawClient(raw, 'thread-1');

  const first = client.send('first');
  const second = client.send('second');

  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(raw.startTurnCalls.length, 1);

  raw.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });
  raw.emit('request', {
    id: 9,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1',
      turnId: 'remote-1',
      itemId: 'ask-1',
      questions: [
        {
          id: 'q1',
          header: 'Pick one',
          question: 'Choose',
          isOther: false,
          isSecret: false,
          options: [{ label: 'A', description: 'first' }]
        }
      ]
    }
  });

  const [question] = client.getOpenRequests();
  await client.answerQuestion(question.id, 'A');
  assert.deepEqual(raw.responses[0], {
    id: 9,
    result: { answers: { q1: { answers: ['A'] } } }
  });

  raw.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });

  await first.done;
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(raw.startTurnCalls.length, 2);

  raw.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'remote-2' } }
  });
  raw.emit('notification', {
    method: 'turn/completed',
    params: { threadId: 'thread-1', turn: { id: 'remote-2' } }
  });

  const secondSnapshot = await second.done;
  assert.equal(secondSnapshot.status, 'completed');
});

test('structured client supports incremental codex question sessions', async () => {
  const raw = new FakeCodexRawClient();
  const client = StructuredCodexClient.fromRawClient(raw, 'thread-1');

  client.send('ask a few things');

  await new Promise((resolve) => setTimeout(resolve, 0));
  raw.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });
  raw.emit('request', {
    id: 10,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1',
      turnId: 'remote-1',
      itemId: 'ask-2',
      questions: [
        {
          id: 'q1',
          header: 'Primary',
          question: 'Choose one',
          isOther: false,
          isSecret: false,
          options: [{ label: 'A', description: 'first' }]
        },
        {
          id: 'q2',
          header: 'Secondary',
          question: 'Choose many',
          isOther: true,
          isSecret: false,
          options: [
            { label: 'B', description: 'second' },
            { label: 'C', description: 'third' }
          ]
        }
      ]
    }
  });

  const [question] = client.getOpenRequests();
  const session = client.createQuestionSession(question.id);

  assert.equal(session.getCurrentQuestion()?.id, 'q1');
  session.setCurrentAnswer('A');
  session.next();
  session.setCurrentAnswer(['B', 'C']);

  assert.deepEqual(session.current().answers, {
    q1: 'A',
    q2: ['B', 'C']
  });

  await session.submit();
  assert.deepEqual(raw.responses[0], {
    id: 10,
    result: {
      answers: {
        q1: { answers: ['A'] },
        q2: { answers: ['B', 'C'] }
      }
    }
  });
});

test('structured client can attach to an existing waiting turn and answer questions', async () => {
  const raw = new FakeCodexRawClient();
  const client = StructuredCodexClient.fromRawClient(raw, 'thread-1');

  raw.emit('request', {
    id: 12,
    method: 'item/tool/requestUserInput',
    params: {
      threadId: 'thread-1',
      turnId: 'remote-existing',
      itemId: 'ask-existing',
      questions: [
        {
          id: 'q1',
          header: 'Takeover',
          question: 'Choose one',
          isOther: false,
          isSecret: false,
          options: [{ label: 'A', description: 'first' }]
        }
      ]
    }
  });

  const [question] = client.getOpenRequests();
  assert.equal(question.kind, 'question');
  assert.equal(raw.errors.length, 0);

  await client.answerQuestion(question.id, 'A');
  assert.deepEqual(raw.responses[0], {
    id: 12,
    result: {
      answers: {
        q1: { answers: ['A'] }
      }
    }
  });
});

test('structured client maps exec policy amendments without fake always scope', async () => {
  const raw = new FakeCodexRawClient();
  const client = StructuredCodexClient.fromRawClient(raw, 'thread-1');

  client.send('Inspect command approval');

  await new Promise((resolve) => setTimeout(resolve, 0));
  raw.emit('notification', {
    method: 'turn/started',
    params: { threadId: 'thread-1', turn: { id: 'remote-1' } }
  });
  raw.emit('request', {
    id: 11,
    method: 'item/commandExecution/requestApproval',
    params: {
      threadId: 'thread-1',
      turnId: 'remote-1',
      itemId: 'cmd-2',
      command: 'pwd',
      cwd: '/repo',
      proposedExecPolicyAmendment: ['allow pwd']
    }
  });

  const [request] = client.getOpenRequests();
  await client.approveRequest(request.id, {
    behavior: 'allow',
    execPolicyAmendment: ['allow pwd']
  });

  assert.deepEqual(raw.responses[0], {
    id: 11,
    result: {
      decision: {
        acceptWithExecpolicyAmendment: {
          execpolicy_amendment: ['allow pwd']
        }
      }
    }
  });
});

test('session browser lists and reads Codex threads', async () => {
  const thread = {
    id: 'thread-1',
    preview: 'Inspect project',
    cwd: '/repo',
    createdAt: 1704067200,
    updatedAt: 1704067260,
    gitInfo: { branch: 'main' },
    turns: [
      {
        id: 'turn-1',
        input: [{ type: 'text', text: 'Inspect project' }],
        items: [
          { item: { id: 'assistant-1', type: 'agentMessage', text: 'Project inspected' } }
        ]
      }
    ]
  };

  const browserClient = {
    async listThreads() {
      return { data: [thread], nextCursor: null };
    },
    async readThread() {
      return { thread };
    }
  };

  const summaries = await listCodexSessionSummaries(browserClient);
  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].provider, 'codex');

  const record = await readCodexSessionRecord(browserClient, 'thread-1');
  assert.equal(record?.provider, 'codex');
  assert.equal(record?.rawMessages.length, 1);
  assert.equal(record?.messages.some((message) => message.role === 'assistant'), true);
});
