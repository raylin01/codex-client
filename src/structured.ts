import { EventEmitter } from 'events';

import { CodexClient } from './client.js';
import type {
  AskForApproval,
  CodexServerNotification,
  CodexServerRequest,
  CommandExecutionApprovalDecision,
  CommandExecutionRequestApprovalParams,
  CommandExecutionRequestApprovalResponse,
  DynamicToolCallParams,
  DynamicToolCallResponse,
  FileChangeApprovalDecision,
  FileChangeRequestApprovalParams,
  FileChangeRequestApprovalResponse,
  JsonValue,
  ReasoningEffort,
  ReasoningSummary,
  SandboxMode,
  SandboxPolicy,
  ThreadForkResponse,
  ThreadResumeResponse,
  ThreadStartResponse,
  ToolRequestUserInputParams,
  ToolRequestUserInputResponse,
  TurnInterruptResponse,
  TurnStartParams,
  UserInput
} from './types.js';
import type { CodexClientOptions } from './client.js';

export type CodexOutputKind =
  | 'idle'
  | 'text'
  | 'thinking'
  | 'tool_use'
  | 'tool_result'
  | 'tool_approval'
  | 'question'
  | 'tool_call'
  | 'complete'
  | 'error';

export type CodexTurnStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'error';

export type CodexSendInput = string | { text: string } | { content: UserInput[] };

export interface StructuredCodexClientOptions extends CodexClientOptions {
  resumeThreadId?: string;
  forkThread?: boolean;
  history?: any[] | null;
  path?: string | null;
  persistSession?: boolean;
  model?: string | null;
  modelProvider?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandbox?: SandboxMode | null;
  config?: Record<string, JsonValue> | null;
  baseInstructions?: string | null;
  developerInstructions?: string | null;
  personality?: Record<string, any> | null;
  experimentalRawEvents?: boolean;
  dynamicTools?: any;
}

export interface CodexSendOptions {
  metadata?: Record<string, unknown>;
  cwd?: string | null;
  approvalPolicy?: AskForApproval | null;
  sandboxPolicy?: SandboxPolicy | null;
  model?: string | null;
  effort?: ReasoningEffort | null;
  summary?: ReasoningSummary | null;
  personality?: Record<string, any> | null;
  outputSchema?: JsonValue | null;
  collaborationMode?: string | null;
}

export interface CodexTurnMessageState {
  type: CodexOutputKind;
  content: string;
  toolName?: string;
  toolUseId?: string;
  requestId?: string;
}

export interface CodexToolUseState {
  id: string;
  name: string;
  input: Record<string, unknown>;
  startedAt: string;
}

export interface CodexToolResultState {
  toolUseId: string;
  content: string;
  isError: boolean;
  receivedAt: string;
}

export interface CodexQuestionOption {
  label: string;
  description: string;
}

export interface CodexQuestionPrompt {
  id: string;
  header: string;
  question: string;
  isOther: boolean;
  isSecret: boolean;
  options: CodexQuestionOption[];
}

export interface CodexOpenRequestBase {
  id: string;
  rawRequestId: string | number;
  turnId: string;
  createdAt: string;
}

export interface CodexApprovalRequest extends CodexOpenRequestBase {
  kind: 'tool_approval';
  approvalKind: 'command' | 'file';
  itemId: string;
  reason?: string | null;
  command?: string | null;
  cwd?: string | null;
  commandActions?: any[] | null;
  grantRoot?: string | null;
  proposedExecPolicyAmendment?: string[] | null;
}

export interface CodexQuestionRequest extends CodexOpenRequestBase {
  kind: 'question';
  itemId: string;
  questions: CodexQuestionPrompt[];
}

export interface CodexToolCallRequest extends CodexOpenRequestBase {
  kind: 'tool_call';
  callId: string;
  tool: string;
  arguments: JsonValue;
}

export type CodexOpenRequest = CodexApprovalRequest | CodexQuestionRequest | CodexToolCallRequest;

export interface CodexTurnResult {
  status: 'success' | 'error';
  error?: {
    message: string;
    data?: unknown;
  };
  remoteTurn?: Record<string, unknown>;
}

export interface CodexTurnHistoryEntry {
  kind: 'status' | 'output' | 'tool_use' | 'tool_result' | 'request' | 'completed' | 'error';
  timestamp: string;
  outputKind?: CodexOutputKind;
  content?: string;
  status?: CodexTurnStatus;
  toolUse?: CodexToolUseState;
  toolResult?: CodexToolResultState;
  request?: CodexOpenRequest;
  message?: CodexTurnMessageState;
  result?: CodexTurnResult;
}

export interface CodexTurnSnapshot {
  id: string;
  providerTurnId?: string;
  providerThreadId: string;
  input: CodexSendInput;
  status: CodexTurnStatus;
  currentOutputKind: CodexOutputKind;
  currentMessage: CodexTurnMessageState;
  text: string;
  thinking: string;
  toolUses: CodexToolUseState[];
  toolResults: CodexToolResultState[];
  openRequests: CodexOpenRequest[];
  history: CodexTurnHistoryEntry[];
  startedAt: string;
  completedAt?: string;
  result?: CodexTurnResult;
  metadata?: Record<string, unknown>;
}

export interface CodexTurnUpdate {
  turnId: string;
  snapshot: CodexTurnSnapshot;
  kind: 'queued' | 'started' | 'output' | 'tool_use' | 'tool_result' | 'request' | 'completed' | 'error';
}

export type CodexApprovalScope = 'once' | 'session';

export interface CodexApprovalDecision {
  behavior: 'allow' | 'deny';
  scope?: CodexApprovalScope;
  execPolicyAmendment?: string[] | null;
}

export interface CodexQuestionSessionSnapshot {
  requestId: string;
  request: CodexQuestionRequest;
  currentIndex: number;
  answers: Record<string, string | string[]>;
}

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeSendInput(input: CodexSendInput): CodexSendInput {
  if (typeof input === 'string') {
    return input;
  }

  if ('text' in input) {
    return { text: input.text };
  }

  return {
    content: input.content.map((item) => ({ ...item }))
  };
}

function toUserInput(input: CodexSendInput): UserInput[] {
  if (typeof input === 'string') {
    return [{ type: 'text', text: input, text_elements: [] }];
  }
  if ('text' in input) {
    return [{ type: 'text', text: input.text, text_elements: [] }];
  }
  return input.content.map((item) => ({ ...item }));
}

function cloneToolUse(toolUse: CodexToolUseState): CodexToolUseState {
  return {
    ...toolUse,
    input: { ...toolUse.input }
  };
}

function cloneToolResult(toolResult: CodexToolResultState): CodexToolResultState {
  return { ...toolResult };
}

function cloneOpenRequest(request: CodexOpenRequest): CodexOpenRequest {
  if (request.kind === 'tool_approval') {
    return {
      ...request,
      commandActions: request.commandActions ? [...request.commandActions] : request.commandActions,
      proposedExecPolicyAmendment: request.proposedExecPolicyAmendment
        ? [...request.proposedExecPolicyAmendment]
        : request.proposedExecPolicyAmendment
    };
  }

  if (request.kind === 'question') {
    return {
      ...request,
      questions: request.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option }))
      }))
    };
  }

  return {
    ...request,
    arguments: request.arguments == null
      ? request.arguments
      : JSON.parse(JSON.stringify(request.arguments))
  };
}

function cloneTurnResult(result: CodexTurnResult): CodexTurnResult {
  return {
    ...result,
    error: result.error ? { ...result.error } : undefined,
    remoteTurn: result.remoteTurn ? { ...result.remoteTurn } : undefined
  };
}

function getQuestionLookupKeys(question: CodexQuestionPrompt): string[] {
  const keys = [question.id, question.header, question.question].filter(
    (value): value is string => typeof value === 'string' && value.length > 0
  );
  return Array.from(new Set(keys));
}

function resolveQuestionPrompt(
  questions: CodexQuestionPrompt[],
  questionKey: string | number
): { index: number; question: CodexQuestionPrompt } {
  if (typeof questionKey === 'number') {
    const question = questions[questionKey];
    if (!question) {
      throw new Error(`Unknown question index: ${questionKey}`);
    }
    return { index: questionKey, question };
  }

  const index = questions.findIndex((question) => getQuestionLookupKeys(question).includes(questionKey));
  if (index < 0) {
    throw new Error(`Unknown question: ${questionKey}`);
  }

  return { index, question: questions[index] };
}

export class CodexQuestionSession {
  private readonly request: CodexQuestionRequest;
  private readonly answers = new Map<string, string | string[]>();
  private currentIndex = 0;

  constructor(private readonly client: StructuredCodexClient, request: CodexQuestionRequest) {
    this.request = cloneOpenRequest(request) as CodexQuestionRequest;
  }

  get requestId(): string {
    return this.request.id;
  }

  current(): CodexQuestionSessionSnapshot {
    return {
      requestId: this.request.id,
      request: cloneOpenRequest(this.request) as CodexQuestionRequest,
      currentIndex: this.currentIndex,
      answers: this.getAnswers()
    };
  }

  getCurrentQuestion(): CodexQuestionPrompt | null {
    const question = this.request.questions[this.currentIndex];
    if (!question) {
      return null;
    }

    return {
      ...question,
      options: question.options.map((option) => ({ ...option }))
    };
  }

  getAnswers(): Record<string, string | string[]> {
    const values: Record<string, string | string[]> = {};
    for (const question of this.request.questions) {
      const answer = this.answers.get(question.id);
      if (answer !== undefined) {
        values[question.id] = Array.isArray(answer) ? [...answer] : answer;
      }
    }
    return values;
  }

  setAnswer(questionKey: string | number, answer: string | string[]): this {
    const { question } = resolveQuestionPrompt(this.request.questions, questionKey);
    this.answers.set(question.id, Array.isArray(answer) ? [...answer] : answer);
    return this;
  }

  setCurrentAnswer(answer: string | string[]): this {
    const question = this.getCurrentQuestion();
    if (!question) {
      throw new Error('No current question available.');
    }

    return this.setAnswer(question.id, answer);
  }

  next(): CodexQuestionPrompt | null {
    if (this.currentIndex < this.request.questions.length - 1) {
      this.currentIndex += 1;
    }
    return this.getCurrentQuestion();
  }

  previous(): CodexQuestionPrompt | null {
    if (this.currentIndex > 0) {
      this.currentIndex -= 1;
    }
    return this.getCurrentQuestion();
  }

  async submit(): Promise<void> {
    await this.client.answerQuestion(this.request.id, this.getAnswers());
  }
}

function cloneHistoryEntry(entry: CodexTurnHistoryEntry): CodexTurnHistoryEntry {
  return {
    ...entry,
    toolUse: entry.toolUse ? cloneToolUse(entry.toolUse) : undefined,
    toolResult: entry.toolResult ? cloneToolResult(entry.toolResult) : undefined,
    request: entry.request ? cloneOpenRequest(entry.request) : undefined,
    message: entry.message ? { ...entry.message } : undefined,
    result: entry.result ? cloneTurnResult(entry.result) : undefined
  };
}

function cloneSnapshot(snapshot: CodexTurnSnapshot): CodexTurnSnapshot {
  return {
    ...snapshot,
    input: normalizeSendInput(snapshot.input),
    currentMessage: { ...snapshot.currentMessage },
    toolUses: snapshot.toolUses.map(cloneToolUse),
    toolResults: snapshot.toolResults.map(cloneToolResult),
    openRequests: snapshot.openRequests.map(cloneOpenRequest),
    history: snapshot.history.map(cloneHistoryEntry),
    result: snapshot.result ? cloneTurnResult(snapshot.result) : undefined,
    metadata: snapshot.metadata ? { ...snapshot.metadata } : undefined
  };
}

export class CodexTurnHandle extends EventEmitter {
  private snapshot: CodexTurnSnapshot;
  private updateQueue: CodexTurnUpdate[] = [];
  private updateWaiters: Array<(update: CodexTurnUpdate | null) => void> = [];
  readonly done: Promise<CodexTurnSnapshot>;
  private resolveDone!: (snapshot: CodexTurnSnapshot) => void;
  private rejectDone!: (error: Error) => void;

  constructor(
    id: string,
    threadId: string,
    input: CodexSendInput,
    metadata?: Record<string, unknown>
  ) {
    super();
    const startedAt = nowIso();
    this.snapshot = {
      id,
      providerThreadId: threadId,
      input: normalizeSendInput(input),
      status: 'queued',
      currentOutputKind: 'idle',
      currentMessage: { type: 'idle', content: '' },
      text: '',
      thinking: '',
      toolUses: [],
      toolResults: [],
      openRequests: [],
      history: [
        {
          kind: 'status',
          status: 'queued',
          timestamp: startedAt
        }
      ],
      startedAt,
      metadata
    };

    this.done = new Promise<CodexTurnSnapshot>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
  }

  current(): CodexTurnSnapshot {
    return cloneSnapshot(this.snapshot);
  }

  history(): CodexTurnHistoryEntry[] {
    return this.snapshot.history.map(cloneHistoryEntry);
  }

  onUpdate(listener: (update: CodexTurnUpdate) => void): this {
    this.on('update', listener);
    return this;
  }

  async *updates(): AsyncIterableIterator<CodexTurnUpdate> {
    while (true) {
      if (this.updateQueue.length > 0) {
        const update = this.updateQueue.shift()!;
        yield update;
        if (update.kind === 'completed' || update.kind === 'error') {
          return;
        }
        continue;
      }

      const nextUpdate = await new Promise<CodexTurnUpdate | null>((resolve) => {
        this.updateWaiters.push(resolve);
      });

      if (!nextUpdate) {
        return;
      }

      yield nextUpdate;
      if (nextUpdate.kind === 'completed' || nextUpdate.kind === 'error') {
        return;
      }
    }
  }

  setProviderTurnId(turnId: string): void {
    this.snapshot.providerTurnId = turnId;
  }

  markQueued(): void {
    this.snapshot.status = 'queued';
    this.snapshot.history.push({ kind: 'status', status: 'queued', timestamp: nowIso() });
    this.emitUpdate('queued');
  }

  markStarted(): void {
    this.snapshot.status = 'running';
    this.snapshot.history.push({ kind: 'status', status: 'running', timestamp: nowIso() });
    this.emitUpdate('started');
  }

  setWaiting(): void {
    this.snapshot.status = 'waiting';
    this.snapshot.history.push({ kind: 'status', status: 'waiting', timestamp: nowIso() });
  }

  appendText(delta: string): void {
    if (!delta) {
      return;
    }

    this.snapshot.text += delta;
    this.snapshot.currentOutputKind = 'text';
    this.snapshot.currentMessage = {
      type: 'text',
      content: this.snapshot.text
    };
    this.snapshot.history.push({
      kind: 'output',
      outputKind: 'text',
      content: this.snapshot.text,
      message: { ...this.snapshot.currentMessage },
      timestamp: nowIso()
    });
    this.emitUpdate('output');
  }

  appendThinking(delta: string): void {
    if (!delta) {
      return;
    }

    this.snapshot.thinking += delta;
    this.snapshot.currentOutputKind = 'thinking';
    this.snapshot.currentMessage = {
      type: 'thinking',
      content: this.snapshot.thinking
    };
    this.snapshot.history.push({
      kind: 'output',
      outputKind: 'thinking',
      content: this.snapshot.thinking,
      message: { ...this.snapshot.currentMessage },
      timestamp: nowIso()
    });
    this.emitUpdate('output');
  }

  addToolUse(id: string, name: string, input: Record<string, unknown>): void {
    const toolUse: CodexToolUseState = {
      id,
      name,
      input,
      startedAt: nowIso()
    };
    this.snapshot.toolUses.push(toolUse);
    this.snapshot.currentOutputKind = 'tool_use';
    this.snapshot.currentMessage = {
      type: 'tool_use',
      content: name,
      toolName: name,
      toolUseId: id
    };
    this.snapshot.history.push({
      kind: 'tool_use',
      toolUse: cloneToolUse(toolUse),
      message: { ...this.snapshot.currentMessage },
      timestamp: nowIso()
    });
    this.emitUpdate('tool_use');
  }

  addToolResult(toolUseId: string, content: string, isError = false): void {
    if (!content) {
      return;
    }

    const toolResult: CodexToolResultState = {
      toolUseId,
      content,
      isError,
      receivedAt: nowIso()
    };
    this.snapshot.toolResults.push(toolResult);
    this.snapshot.currentOutputKind = 'tool_result';
    this.snapshot.currentMessage = {
      type: 'tool_result',
      content,
      toolUseId
    };
    this.snapshot.history.push({
      kind: 'tool_result',
      toolResult: cloneToolResult(toolResult),
      message: { ...this.snapshot.currentMessage },
      timestamp: nowIso()
    });
    this.emitUpdate('tool_result');
  }

  addRequest(request: CodexOpenRequest): void {
    this.snapshot.openRequests.push(request);
    this.snapshot.currentOutputKind = request.kind;
    this.snapshot.currentMessage = {
      type: request.kind,
      content: summarizeRequest(request),
      requestId: request.id
    };
    this.setWaiting();
    this.snapshot.history.push({
      kind: 'request',
      request: cloneOpenRequest(request),
      message: { ...this.snapshot.currentMessage },
      timestamp: nowIso()
    });
    this.emitUpdate('request');
  }

  resolveRequest(requestId: string): CodexOpenRequest | null {
    const index = this.snapshot.openRequests.findIndex((request) => request.id === requestId);
    if (index < 0) {
      return null;
    }

    const [request] = this.snapshot.openRequests.splice(index, 1);
    if (this.snapshot.openRequests.length === 0 && this.snapshot.status === 'waiting') {
      this.snapshot.status = 'running';
      this.snapshot.history.push({ kind: 'status', status: 'running', timestamp: nowIso() });
    }
    return request;
  }

  complete(result: CodexTurnResult): void {
    this.snapshot.status = result.status === 'error' ? 'error' : 'completed';
    this.snapshot.completedAt = nowIso();
    this.snapshot.result = cloneTurnResult(result);
    this.snapshot.currentOutputKind = result.status === 'error' ? 'error' : 'complete';
    this.snapshot.currentMessage = {
      type: this.snapshot.currentOutputKind,
      content: result.error?.message || this.snapshot.text
    };
    this.snapshot.history.push({
      kind: result.status === 'error' ? 'error' : 'completed',
      result: cloneTurnResult(result),
      message: { ...this.snapshot.currentMessage },
      timestamp: this.snapshot.completedAt
    });
    this.emitUpdate(result.status === 'error' ? 'error' : 'completed');
    this.resolveDone(cloneSnapshot(this.snapshot));
    this.closeIterators();
  }

  fail(error: Error): void {
    this.snapshot.status = 'error';
    this.snapshot.completedAt = nowIso();
    this.snapshot.currentOutputKind = 'error';
    this.snapshot.currentMessage = {
      type: 'error',
      content: error.message
    };
    this.snapshot.history.push({
      kind: 'error',
      content: error.message,
      message: { ...this.snapshot.currentMessage },
      timestamp: this.snapshot.completedAt
    });
    this.emitUpdate('error');
    this.rejectDone(error);
    this.closeIterators();
  }

  private emitUpdate(kind: CodexTurnUpdate['kind']): void {
    const update: CodexTurnUpdate = {
      kind,
      turnId: this.snapshot.id,
      snapshot: cloneSnapshot(this.snapshot)
    };
    const waiter = this.updateWaiters.shift();
    if (waiter) {
      waiter(update);
    } else {
      this.updateQueue.push(update);
    }
    this.emit('update', update);
  }

  private closeIterators(): void {
    while (this.updateWaiters.length > 0) {
      const waiter = this.updateWaiters.shift();
      waiter?.(null);
    }
  }
}

function summarizeRequest(request: CodexOpenRequest): string {
  if (request.kind === 'tool_approval') {
    return request.approvalKind === 'command'
      ? request.command || request.reason || 'Command approval requested'
      : request.reason || request.grantRoot || 'File change approval requested';
  }

  if (request.kind === 'question') {
    return request.questions.map((question) => question.header || question.question).join('\n');
  }

  return `${request.tool} requested`;
}

function toolNameFromItem(item: any): string | null {
  if (!item || typeof item !== 'object') {
    return null;
  }

  if (typeof item.tool === 'string') {
    return item.tool;
  }

  if (typeof item.name === 'string') {
    return item.name;
  }

  switch (item.type) {
    case 'commandExecution':
      return 'CommandExecution';
    case 'fileChange':
      return 'FileChange';
    case 'mcpToolCall':
      return 'McpToolCall';
    default:
      return typeof item.type === 'string' ? item.type : null;
  }
}

function itemInputFromNotification(item: any): Record<string, unknown> {
  if (!item || typeof item !== 'object') {
    return {};
  }

  const input: Record<string, unknown> = {};
  if (typeof item.command === 'string') {
    input.command = item.command;
  }
  if (typeof item.cwd === 'string') {
    input.cwd = item.cwd;
  }
  if (item.arguments && typeof item.arguments === 'object') {
    input.arguments = item.arguments;
  }
  if (item.reason) {
    input.reason = item.reason;
  }
  return input;
}

export class StructuredCodexClient extends EventEmitter {
  private readonly rawClient: CodexClient;
  private readonly turns: CodexTurnHandle[] = [];
  private readonly pendingTurns: Array<{ handle: CodexTurnHandle; options?: CodexSendOptions }> = [];
  private readonly turnsByProviderId = new Map<string, CodexTurnHandle>();
  private readonly requestsById = new Map<string, CodexOpenRequest>();
  private activeTurn: CodexTurnHandle | null = null;
  private threadId: string | null;
  private turnCounter = 0;
  private requestCounter = 0;
  constructor(rawClient: CodexClient, threadId: string | null = null) {
    super();
    this.rawClient = rawClient;
    this.threadId = threadId;
    this.attachRawEventHandlers();
  }

  static async init(options: StructuredCodexClientOptions): Promise<StructuredCodexClient> {
    const rawClient = new CodexClient(options);
    await rawClient.start();
    const client = new StructuredCodexClient(rawClient);
    await client.initializeThread(options);
    return client;
  }

  static fromRawClient(rawClient: CodexClient, threadId: string): StructuredCodexClient {
    return new StructuredCodexClient(rawClient, threadId);
  }

  get raw(): CodexClient {
    return this.rawClient;
  }

  get providerThreadId(): string | null {
    return this.threadId;
  }

  async initializeThread(options: StructuredCodexClientOptions): Promise<string> {
    const threadResponse = await this.bootstrapThread(options);
    this.threadId = threadResponse.thread.id;
    return this.threadId;
  }

  send(input: CodexSendInput, options?: CodexSendOptions): CodexTurnHandle {
    if (!this.threadId) {
      throw new Error('Codex thread is not initialized');
    }

    const turnId = `turn-${++this.turnCounter}`;
    const handle = new CodexTurnHandle(turnId, this.threadId, normalizeSendInput(input), options?.metadata);
    this.turns.push(handle);

    if (this.activeTurn) {
      handle.markQueued();
      this.pendingTurns.push({ handle, options });
    } else {
      void this.startTurn(handle, options);
    }

    return handle;
  }

  getCurrentTurn(): CodexTurnSnapshot | null {
    return this.activeTurn ? this.activeTurn.current() : null;
  }

  getHistory(): CodexTurnSnapshot[] {
    return this.turns.map((turn) => turn.current()).filter((turn) => turn.status === 'completed' || turn.status === 'error');
  }

  getOpenRequests(): CodexOpenRequest[] {
    return this.activeTurn?.current().openRequests ?? [];
  }

  getOpenRequest(requestId: string): CodexOpenRequest | null {
    const request = this.requestsById.get(requestId);
    return request ? cloneOpenRequest(request) : null;
  }

  createQuestionSession(requestId: string): CodexQuestionSession {
    const request = this.requestsById.get(requestId);
    if (!request || request.kind !== 'question') {
      throw new Error(`Unknown question request: ${requestId}`);
    }

    return new CodexQuestionSession(this, request);
  }

  async approveRequest(requestId: string, decision: CodexApprovalDecision = { behavior: 'allow' }): Promise<void> {
    const request = this.requestsById.get(requestId);
    if (!request) {
      throw new Error(`Unknown request: ${requestId}`);
    }

    if (request.kind !== 'tool_approval') {
      throw new Error(`Request ${requestId} is not an approval request`);
    }

    if (request.approvalKind === 'command') {
      const response: CommandExecutionRequestApprovalResponse = {
        decision: mapCommandApprovalDecision(decision, request.proposedExecPolicyAmendment)
      };
      this.rawClient.sendResponse(request.rawRequestId, response);
    } else {
      const response: FileChangeRequestApprovalResponse = {
        decision: mapFileApprovalDecision(decision)
      };
      this.rawClient.sendResponse(request.rawRequestId, response);
    }

    this.resolveRequest(requestId);
  }

  async denyRequest(requestId: string, message?: string): Promise<void> {
    const request = this.requestsById.get(requestId);
    if (!request) {
      throw new Error(`Unknown request: ${requestId}`);
    }

    if (request.kind === 'tool_call') {
      this.rawClient.sendError(request.rawRequestId, { message: message || 'Tool call denied' });
      this.resolveRequest(requestId);
      return;
    }

    await this.approveRequest(requestId, { behavior: 'deny' });
  }

  async answerQuestion(
    requestId: string,
    answers: string | string[] | Record<string, string | string[]>
  ): Promise<void> {
    const request = this.requestsById.get(requestId);
    if (!request || request.kind !== 'question') {
      throw new Error(`Unknown question request: ${requestId}`);
    }

    const normalizedAnswers = normalizeQuestionAnswers(request, answers);
    const response: ToolRequestUserInputResponse = { answers: normalizedAnswers };
    this.rawClient.sendResponse(request.rawRequestId, response);
    this.resolveRequest(requestId);
  }

  async respondToToolCall(requestId: string, response: DynamicToolCallResponse): Promise<void> {
    const request = this.requestsById.get(requestId);
    if (!request || request.kind !== 'tool_call') {
      throw new Error(`Unknown tool call request: ${requestId}`);
    }

    this.rawClient.sendResponse(request.rawRequestId, response);
    this.resolveRequest(requestId);
  }

  async interruptCurrentTurn(): Promise<TurnInterruptResponse | null> {
    const snapshot = this.activeTurn?.current();
    if (!this.threadId || !snapshot?.providerTurnId) {
      return null;
    }

    return this.rawClient.interruptTurn({
      threadId: this.threadId,
      turnId: snapshot.providerTurnId
    });
  }

  async close(): Promise<void> {
    await this.rawClient.shutdown();
  }

  private async bootstrapThread(options: StructuredCodexClientOptions): Promise<ThreadStartResponse | ThreadResumeResponse | ThreadForkResponse> {
    const baseParams = {
      model: options.model ?? null,
      modelProvider: options.modelProvider ?? null,
      cwd: options.cwd ?? process.cwd(),
      approvalPolicy: options.approvalPolicy ?? 'on-request',
      sandbox: options.sandbox ?? null,
      config: options.config ?? null,
      baseInstructions: options.baseInstructions ?? null,
      developerInstructions: options.developerInstructions ?? null,
      personality: options.personality ?? null
    };

    if (options.resumeThreadId) {
      if (options.forkThread) {
        return this.rawClient.forkThread({
          threadId: options.resumeThreadId,
          path: options.path ?? null,
          ...baseParams
        });
      }

      return this.rawClient.resumeThread({
        threadId: options.resumeThreadId,
        history: options.history ?? null,
        path: options.path ?? null,
        ...baseParams
      });
    }

    return this.rawClient.startThread({
      ...baseParams,
      ephemeral: options.persistSession === false,
      experimentalRawEvents: options.experimentalRawEvents ?? false,
      dynamicTools: options.dynamicTools
    });
  }

  private async startTurn(handle: CodexTurnHandle, options?: CodexSendOptions): Promise<void> {
    if (!this.threadId) {
      handle.fail(new Error('Codex thread is not initialized'));
      return;
    }

    this.activeTurn = handle;
    handle.markStarted();

    const params: TurnStartParams = {
      threadId: this.threadId,
      input: toUserInput(handle.current().input),
      cwd: options?.cwd ?? null,
      approvalPolicy: options?.approvalPolicy ?? null,
      sandboxPolicy: options?.sandboxPolicy ?? null,
      model: options?.model ?? null,
      effort: options?.effort ?? null,
      summary: options?.summary ?? null,
      personality: options?.personality ?? null,
      outputSchema: options?.outputSchema ?? null,
      collaborationMode: options?.collaborationMode ?? null
    };

    try {
      const response = await this.rawClient.startTurn(params);
      const providerTurnId = response.turn.id;
      handle.setProviderTurnId(providerTurnId);
      this.turnsByProviderId.set(providerTurnId, handle);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      handle.fail(err);
      this.activeTurn = null;
      this.drainPendingTurns();
    }
  }

  private completeTurn(handle: CodexTurnHandle, result: CodexTurnResult): void {
    const snapshot = handle.current();
    if (snapshot.providerTurnId) {
      this.turnsByProviderId.delete(snapshot.providerTurnId);
    }
    handle.complete(result);
    if (this.activeTurn === handle) {
      this.activeTurn = null;
      this.drainPendingTurns();
    }
  }

  private failTurn(handle: CodexTurnHandle, error: Error): void {
    const snapshot = handle.current();
    if (snapshot.providerTurnId) {
      this.turnsByProviderId.delete(snapshot.providerTurnId);
    }
    handle.fail(error);
    if (this.activeTurn === handle) {
      this.activeTurn = null;
      this.drainPendingTurns();
    }
  }

  private drainPendingTurns(): void {
    if (this.activeTurn || this.pendingTurns.length === 0) {
      return;
    }

    const next = this.pendingTurns.shift()!;
    void this.startTurn(next.handle, next.options);
  }

  private resolveRequest(requestId: string): void {
    const request = this.requestsById.get(requestId);
    if (!request) {
      return;
    }
    this.requestsById.delete(requestId);

    const turn = this.turnsByProviderId.get(request.turnId);
    turn?.resolveRequest(requestId);
  }

  private turnFromRemote(turnId?: string): CodexTurnHandle | null {
    if (turnId && this.turnsByProviderId.has(turnId)) {
      return this.turnsByProviderId.get(turnId)!;
    }
    return this.activeTurn;
  }

  private attachRawEventHandlers(): void {
    this.rawClient.on('notification', (notification: CodexServerNotification) => {
      this.handleNotification(notification);
    });

    this.rawClient.on('request', (request: CodexServerRequest) => {
      this.handleRequest(request);
    });

    this.rawClient.on('error', (error: Error) => {
      if (this.activeTurn) {
        this.failTurn(this.activeTurn, error);
      }
    });
  }

  private handleNotification(notification: CodexServerNotification): void {
    const params: any = (notification as any).params || {};
    const notificationThreadId = params.threadId || params.thread?.id;
    if (this.threadId && notificationThreadId && notificationThreadId !== this.threadId) {
      return;
    }

    const turn = this.turnFromRemote(params.turnId || params.turn?.id);
    switch (notification.method) {
      case 'turn/started':
        if (turn && params.turn?.id) {
          turn.setProviderTurnId(params.turn.id);
          this.turnsByProviderId.set(params.turn.id, turn);
        }
        break;
      case 'item/agentMessage/delta':
        turn?.appendText(params.delta || '');
        break;
      case 'item/reasoning/textDelta':
      case 'item/reasoning/summaryTextDelta':
        turn?.appendThinking(params.delta || '');
        break;
      case 'item/commandExecution/outputDelta':
      case 'item/fileChange/outputDelta':
        turn?.addToolResult(params.itemId || 'tool', params.delta || '');
        break;
      case 'item/mcpToolCall/progress':
        turn?.addToolResult(params.itemId || 'tool', params.message || '');
        break;
      case 'item/started': {
        const item = params.item;
        const toolName = toolNameFromItem(item);
        if (toolName && item?.id) {
          turn?.addToolUse(item.id, toolName, itemInputFromNotification(item));
        }
        break;
      }
      case 'item/completed': {
        const item = params.item;
        if (item?.type === 'agentMessage' && typeof item.text === 'string') {
          turn?.appendText(item.text.slice(turn.current().text.length));
        }
        if (item?.id && typeof item.output === 'string') {
          turn?.addToolResult(item.id, item.output, item.status === 'error');
        }
        break;
      }
      case 'turn/completed': {
        if (!turn) {
          break;
        }

        const result: CodexTurnResult = params.turn?.error
          ? {
              status: 'error',
              error: {
                message: params.turn.error?.message || 'Codex turn failed',
                data: params.turn.error
              },
              remoteTurn: params.turn
            }
          : {
              status: 'success',
              remoteTurn: params.turn
            };
        this.completeTurn(turn, result);
        break;
      }
      case 'error': {
        if (!turn || params.willRetry) {
          break;
        }

        const message = params.error?.message || 'Codex protocol error';
        this.completeTurn(turn, {
          status: 'error',
          error: {
            message,
            data: params.error
          }
        });
        break;
      }
      default:
        break;
    }
  }

  private handleRequest(request: CodexServerRequest): void {
    const params: any = (request as any).params || {};
    const requestThreadId = params.threadId || params.thread?.id || params.conversationId;
    if (this.threadId && requestThreadId && requestThreadId !== this.threadId) {
      return;
    }

    const turn = this.turnFromRemote(params.turnId);
    if (!turn) {
      this.rawClient.sendError(request.id, { message: 'Unknown turn' });
      return;
    }

    const requestId = `request-${++this.requestCounter}`;
    let openRequest: CodexOpenRequest | null = null;

    switch (request.method) {
      case 'item/commandExecution/requestApproval':
        openRequest = this.buildCommandApprovalRequest(requestId, request.id, params as CommandExecutionRequestApprovalParams);
        break;
      case 'item/fileChange/requestApproval':
        openRequest = this.buildFileApprovalRequest(requestId, request.id, params as FileChangeRequestApprovalParams);
        break;
      case 'item/tool/requestUserInput':
        openRequest = this.buildQuestionRequest(requestId, request.id, params as ToolRequestUserInputParams);
        break;
      case 'item/tool/call':
        openRequest = this.buildToolCallRequest(requestId, request.id, params as DynamicToolCallParams);
        break;
      default:
        this.rawClient.sendError(request.id, { message: `Unsupported request: ${request.method}` });
        return;
    }

    this.requestsById.set(requestId, openRequest);
    turn.addRequest(openRequest);
  }

  private buildCommandApprovalRequest(
    requestId: string,
    rawRequestId: string | number,
    params: CommandExecutionRequestApprovalParams
  ): CodexApprovalRequest {
    return {
      id: requestId,
      rawRequestId,
      kind: 'tool_approval',
      approvalKind: 'command',
      itemId: params.itemId,
      turnId: params.turnId,
      createdAt: nowIso(),
      reason: params.reason,
      command: params.command,
      cwd: params.cwd,
      commandActions: params.commandActions,
      proposedExecPolicyAmendment: params.proposedExecpolicyAmendment
    };
  }

  private buildFileApprovalRequest(
    requestId: string,
    rawRequestId: string | number,
    params: FileChangeRequestApprovalParams
  ): CodexApprovalRequest {
    return {
      id: requestId,
      rawRequestId,
      kind: 'tool_approval',
      approvalKind: 'file',
      itemId: params.itemId,
      turnId: params.turnId,
      createdAt: nowIso(),
      reason: params.reason,
      grantRoot: params.grantRoot
    };
  }

  private buildQuestionRequest(
    requestId: string,
    rawRequestId: string | number,
    params: ToolRequestUserInputParams
  ): CodexQuestionRequest {
    return {
      id: requestId,
      rawRequestId,
      kind: 'question',
      itemId: params.itemId,
      turnId: params.turnId,
      createdAt: nowIso(),
      questions: params.questions.map((question) => ({
        id: question.id,
        header: question.header,
        question: question.question,
        isOther: question.isOther,
        isSecret: question.isSecret,
        options: (question.options || []).map((option) => ({ ...option }))
      }))
    };
  }

  private buildToolCallRequest(
    requestId: string,
    rawRequestId: string | number,
    params: DynamicToolCallParams
  ): CodexToolCallRequest {
    return {
      id: requestId,
      rawRequestId,
      kind: 'tool_call',
      turnId: params.turnId,
      createdAt: nowIso(),
      callId: params.callId,
      tool: params.tool,
      arguments: params.arguments
    };
  }
}

function mapCommandApprovalDecision(
  decision: CodexApprovalDecision,
  suggestedAmendment?: string[] | null
): CommandExecutionApprovalDecision {
  if (decision.behavior === 'deny') {
    return 'decline';
  }

  if (decision.scope === 'session') {
    if (decision.execPolicyAmendment && decision.execPolicyAmendment.length > 0) {
      throw new Error('execPolicyAmendment cannot be combined with session-scoped Codex approvals.');
    }
    return 'acceptForSession';
  }

  const amendment = decision.execPolicyAmendment ?? suggestedAmendment ?? null;
  if (amendment && amendment.length > 0) {
    return { acceptWithExecpolicyAmendment: { execpolicy_amendment: amendment } };
  }

  return 'accept';
}

function mapFileApprovalDecision(decision: CodexApprovalDecision): FileChangeApprovalDecision {
  if (decision.behavior === 'deny') {
    return 'decline';
  }

  if (decision.execPolicyAmendment && decision.execPolicyAmendment.length > 0) {
    throw new Error('execPolicyAmendment is only supported for Codex command approvals.');
  }

  if (decision.scope === 'session') {
    return 'acceptForSession';
  }

  return 'accept';
}

function normalizeQuestionAnswers(
  request: CodexQuestionRequest,
  answers: string | string[] | Record<string, string | string[]>
): ToolRequestUserInputResponse['answers'] {
  if (typeof answers === 'string' || Array.isArray(answers)) {
    if (request.questions.length !== 1) {
      throw new Error('Multiple questions require an answers object keyed by question id');
    }

    const question = request.questions[0];
    return {
      [question.id]: {
        answers: Array.isArray(answers) ? answers : [answers]
      }
    };
  }

  const normalized: ToolRequestUserInputResponse['answers'] = {};
  for (const question of request.questions) {
    const answerKey = getQuestionLookupKeys(question).find((key) => answers[key] != null);
    const answer = answerKey ? answers[answerKey] : undefined;
    if (answer == null) {
      throw new Error(`Missing answer for question: ${question.id}`);
    }

    normalized[question.id] = {
      answers: Array.isArray(answer) ? answer : [answer]
    };
  }

  return normalized;
}