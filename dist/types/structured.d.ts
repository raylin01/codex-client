import { EventEmitter } from 'events';
import { CodexClient } from './client.js';
import type { AskForApproval, DynamicToolCallResponse, JsonValue, ReasoningEffort, ReasoningSummary, SandboxMode, SandboxPolicy, TurnInterruptResponse, UserInput } from './types.js';
import type { CodexClientOptions } from './client.js';
export type CodexOutputKind = 'idle' | 'text' | 'thinking' | 'tool_use' | 'tool_result' | 'tool_approval' | 'question' | 'tool_call' | 'complete' | 'error';
export type CodexTurnStatus = 'queued' | 'running' | 'waiting' | 'completed' | 'error';
export type CodexSendInput = string | {
    text: string;
} | {
    content: UserInput[];
};
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
export interface CodexApprovalDecision {
    behavior: 'allow' | 'deny';
    scope?: 'once' | 'session' | 'always';
    execPolicyAmendment?: string[] | null;
}
export declare class CodexTurnHandle extends EventEmitter {
    private snapshot;
    private updateQueue;
    private updateWaiters;
    readonly done: Promise<CodexTurnSnapshot>;
    private resolveDone;
    private rejectDone;
    constructor(id: string, threadId: string, input: CodexSendInput, metadata?: Record<string, unknown>);
    current(): CodexTurnSnapshot;
    history(): CodexTurnHistoryEntry[];
    onUpdate(listener: (update: CodexTurnUpdate) => void): this;
    updates(): AsyncIterableIterator<CodexTurnUpdate>;
    setProviderTurnId(turnId: string): void;
    markQueued(): void;
    markStarted(): void;
    setWaiting(): void;
    appendText(delta: string): void;
    appendThinking(delta: string): void;
    addToolUse(id: string, name: string, input: Record<string, unknown>): void;
    addToolResult(toolUseId: string, content: string, isError?: boolean): void;
    addRequest(request: CodexOpenRequest): void;
    resolveRequest(requestId: string): CodexOpenRequest | null;
    complete(result: CodexTurnResult): void;
    fail(error: Error): void;
    private emitUpdate;
    private closeIterators;
}
export declare class StructuredCodexClient extends EventEmitter {
    private readonly rawClient;
    private readonly turns;
    private readonly pendingTurns;
    private readonly turnsByProviderId;
    private readonly requestsById;
    private activeTurn;
    private threadId;
    private turnCounter;
    private requestCounter;
    constructor(rawClient: CodexClient, threadId?: string | null);
    static init(options: StructuredCodexClientOptions): Promise<StructuredCodexClient>;
    static fromRawClient(rawClient: CodexClient, threadId: string): StructuredCodexClient;
    get raw(): CodexClient;
    get providerThreadId(): string | null;
    initializeThread(options: StructuredCodexClientOptions): Promise<string>;
    send(input: CodexSendInput, options?: CodexSendOptions): CodexTurnHandle;
    getCurrentTurn(): CodexTurnSnapshot | null;
    getHistory(): CodexTurnSnapshot[];
    getOpenRequests(): CodexOpenRequest[];
    approveRequest(requestId: string, decision?: CodexApprovalDecision): Promise<void>;
    denyRequest(requestId: string, message?: string): Promise<void>;
    answerQuestion(requestId: string, answers: string | string[] | Record<string, string | string[]>): Promise<void>;
    respondToToolCall(requestId: string, response: DynamicToolCallResponse): Promise<void>;
    interruptCurrentTurn(): Promise<TurnInterruptResponse | null>;
    close(): Promise<void>;
    private bootstrapThread;
    private startTurn;
    private completeTurn;
    private failTurn;
    private drainPendingTurns;
    private resolveRequest;
    private turnFromRemote;
    private attachRawEventHandlers;
    private handleNotification;
    private handleRequest;
    private buildCommandApprovalRequest;
    private buildFileApprovalRequest;
    private buildQuestionRequest;
    private buildToolCallRequest;
}
