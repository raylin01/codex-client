import { EventEmitter } from 'events';
import { CodexClient } from './client.js';
function nowIso() {
    return new Date().toISOString();
}
function normalizeSendInput(input) {
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
function toUserInput(input) {
    if (typeof input === 'string') {
        return [{ type: 'text', text: input, text_elements: [] }];
    }
    if ('text' in input) {
        return [{ type: 'text', text: input.text, text_elements: [] }];
    }
    return input.content.map((item) => ({ ...item }));
}
function cloneToolUse(toolUse) {
    return {
        ...toolUse,
        input: { ...toolUse.input }
    };
}
function cloneToolResult(toolResult) {
    return { ...toolResult };
}
function cloneOpenRequest(request) {
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
function cloneTurnResult(result) {
    return {
        ...result,
        error: result.error ? { ...result.error } : undefined,
        remoteTurn: result.remoteTurn ? { ...result.remoteTurn } : undefined
    };
}
function getQuestionLookupKeys(question) {
    const keys = [question.id, question.header, question.question].filter((value) => typeof value === 'string' && value.length > 0);
    return Array.from(new Set(keys));
}
function resolveQuestionPrompt(questions, questionKey) {
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
    client;
    request;
    answers = new Map();
    currentIndex = 0;
    constructor(client, request) {
        this.client = client;
        this.request = cloneOpenRequest(request);
    }
    get requestId() {
        return this.request.id;
    }
    current() {
        return {
            requestId: this.request.id,
            request: cloneOpenRequest(this.request),
            currentIndex: this.currentIndex,
            answers: this.getAnswers()
        };
    }
    getCurrentQuestion() {
        const question = this.request.questions[this.currentIndex];
        if (!question) {
            return null;
        }
        return {
            ...question,
            options: question.options.map((option) => ({ ...option }))
        };
    }
    getAnswers() {
        const values = {};
        for (const question of this.request.questions) {
            const answer = this.answers.get(question.id);
            if (answer !== undefined) {
                values[question.id] = Array.isArray(answer) ? [...answer] : answer;
            }
        }
        return values;
    }
    setAnswer(questionKey, answer) {
        const { question } = resolveQuestionPrompt(this.request.questions, questionKey);
        this.answers.set(question.id, Array.isArray(answer) ? [...answer] : answer);
        return this;
    }
    setCurrentAnswer(answer) {
        const question = this.getCurrentQuestion();
        if (!question) {
            throw new Error('No current question available.');
        }
        return this.setAnswer(question.id, answer);
    }
    next() {
        if (this.currentIndex < this.request.questions.length - 1) {
            this.currentIndex += 1;
        }
        return this.getCurrentQuestion();
    }
    previous() {
        if (this.currentIndex > 0) {
            this.currentIndex -= 1;
        }
        return this.getCurrentQuestion();
    }
    async submit() {
        await this.client.answerQuestion(this.request.id, this.getAnswers());
    }
}
function cloneHistoryEntry(entry) {
    return {
        ...entry,
        toolUse: entry.toolUse ? cloneToolUse(entry.toolUse) : undefined,
        toolResult: entry.toolResult ? cloneToolResult(entry.toolResult) : undefined,
        request: entry.request ? cloneOpenRequest(entry.request) : undefined,
        message: entry.message ? { ...entry.message } : undefined,
        result: entry.result ? cloneTurnResult(entry.result) : undefined
    };
}
function cloneSnapshot(snapshot) {
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
    snapshot;
    updateQueue = [];
    updateWaiters = [];
    done;
    resolveDone;
    rejectDone;
    constructor(id, threadId, input, metadata) {
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
        this.done = new Promise((resolve, reject) => {
            this.resolveDone = resolve;
            this.rejectDone = reject;
        });
    }
    current() {
        return cloneSnapshot(this.snapshot);
    }
    history() {
        return this.snapshot.history.map(cloneHistoryEntry);
    }
    onUpdate(listener) {
        this.on('update', listener);
        return this;
    }
    async *updates() {
        while (true) {
            if (this.updateQueue.length > 0) {
                const update = this.updateQueue.shift();
                yield update;
                if (update.kind === 'completed' || update.kind === 'error') {
                    return;
                }
                continue;
            }
            const nextUpdate = await new Promise((resolve) => {
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
    setProviderTurnId(turnId) {
        this.snapshot.providerTurnId = turnId;
    }
    markQueued() {
        this.snapshot.status = 'queued';
        this.snapshot.history.push({ kind: 'status', status: 'queued', timestamp: nowIso() });
        this.emitUpdate('queued');
    }
    markStarted() {
        this.snapshot.status = 'running';
        this.snapshot.history.push({ kind: 'status', status: 'running', timestamp: nowIso() });
        this.emitUpdate('started');
    }
    setWaiting() {
        this.snapshot.status = 'waiting';
        this.snapshot.history.push({ kind: 'status', status: 'waiting', timestamp: nowIso() });
    }
    appendText(delta) {
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
    appendThinking(delta) {
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
    addToolUse(id, name, input) {
        const toolUse = {
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
    addToolResult(toolUseId, content, isError = false) {
        if (!content) {
            return;
        }
        const toolResult = {
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
    addRequest(request) {
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
    resolveRequest(requestId) {
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
    complete(result) {
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
    fail(error) {
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
    emitUpdate(kind) {
        const update = {
            kind,
            turnId: this.snapshot.id,
            snapshot: cloneSnapshot(this.snapshot)
        };
        const waiter = this.updateWaiters.shift();
        if (waiter) {
            waiter(update);
        }
        else {
            this.updateQueue.push(update);
        }
        this.emit('update', update);
    }
    closeIterators() {
        while (this.updateWaiters.length > 0) {
            const waiter = this.updateWaiters.shift();
            waiter?.(null);
        }
    }
}
function summarizeRequest(request) {
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
function toolNameFromItem(item) {
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
function itemInputFromNotification(item) {
    if (!item || typeof item !== 'object') {
        return {};
    }
    const input = {};
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
    rawClient;
    turns = [];
    pendingTurns = [];
    turnsByProviderId = new Map();
    requestsById = new Map();
    activeTurn = null;
    threadId;
    turnCounter = 0;
    requestCounter = 0;
    constructor(rawClient, threadId = null) {
        super();
        this.rawClient = rawClient;
        this.threadId = threadId;
        this.attachRawEventHandlers();
    }
    static async init(options) {
        const rawClient = new CodexClient(options);
        await rawClient.start();
        const client = new StructuredCodexClient(rawClient);
        await client.initializeThread(options);
        return client;
    }
    static fromRawClient(rawClient, threadId) {
        return new StructuredCodexClient(rawClient, threadId);
    }
    get raw() {
        return this.rawClient;
    }
    get providerThreadId() {
        return this.threadId;
    }
    async initializeThread(options) {
        const threadResponse = await this.bootstrapThread(options);
        this.threadId = threadResponse.thread.id;
        return this.threadId;
    }
    send(input, options) {
        if (!this.threadId) {
            throw new Error('Codex thread is not initialized');
        }
        const turnId = `turn-${++this.turnCounter}`;
        const handle = new CodexTurnHandle(turnId, this.threadId, normalizeSendInput(input), options?.metadata);
        this.turns.push(handle);
        if (this.activeTurn) {
            handle.markQueued();
            this.pendingTurns.push({ handle, options });
        }
        else {
            void this.startTurn(handle, options);
        }
        return handle;
    }
    getCurrentTurn() {
        return this.activeTurn ? this.activeTurn.current() : null;
    }
    getHistory() {
        return this.turns.map((turn) => turn.current()).filter((turn) => turn.status === 'completed' || turn.status === 'error');
    }
    getOpenRequests() {
        return this.activeTurn?.current().openRequests ?? [];
    }
    getOpenRequest(requestId) {
        const request = this.requestsById.get(requestId);
        return request ? cloneOpenRequest(request) : null;
    }
    createQuestionSession(requestId) {
        const request = this.requestsById.get(requestId);
        if (!request || request.kind !== 'question') {
            throw new Error(`Unknown question request: ${requestId}`);
        }
        return new CodexQuestionSession(this, request);
    }
    async approveRequest(requestId, decision = { behavior: 'allow' }) {
        const request = this.requestsById.get(requestId);
        if (!request) {
            throw new Error(`Unknown request: ${requestId}`);
        }
        if (request.kind !== 'tool_approval') {
            throw new Error(`Request ${requestId} is not an approval request`);
        }
        if (request.approvalKind === 'command') {
            const response = {
                decision: mapCommandApprovalDecision(decision, request.proposedExecPolicyAmendment)
            };
            this.rawClient.sendResponse(request.rawRequestId, response);
        }
        else {
            const response = {
                decision: mapFileApprovalDecision(decision)
            };
            this.rawClient.sendResponse(request.rawRequestId, response);
        }
        this.resolveRequest(requestId);
    }
    async denyRequest(requestId, message) {
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
    async answerQuestion(requestId, answers) {
        const request = this.requestsById.get(requestId);
        if (!request || request.kind !== 'question') {
            throw new Error(`Unknown question request: ${requestId}`);
        }
        const normalizedAnswers = normalizeQuestionAnswers(request, answers);
        const response = { answers: normalizedAnswers };
        this.rawClient.sendResponse(request.rawRequestId, response);
        this.resolveRequest(requestId);
    }
    async respondToToolCall(requestId, response) {
        const request = this.requestsById.get(requestId);
        if (!request || request.kind !== 'tool_call') {
            throw new Error(`Unknown tool call request: ${requestId}`);
        }
        this.rawClient.sendResponse(request.rawRequestId, response);
        this.resolveRequest(requestId);
    }
    async interruptCurrentTurn() {
        const snapshot = this.activeTurn?.current();
        if (!this.threadId || !snapshot?.providerTurnId) {
            return null;
        }
        return this.rawClient.interruptTurn({
            threadId: this.threadId,
            turnId: snapshot.providerTurnId
        });
    }
    async close() {
        await this.rawClient.shutdown();
    }
    async bootstrapThread(options) {
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
    async startTurn(handle, options) {
        if (!this.threadId) {
            handle.fail(new Error('Codex thread is not initialized'));
            return;
        }
        this.activeTurn = handle;
        handle.markStarted();
        const params = {
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
        }
        catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            handle.fail(err);
            this.activeTurn = null;
            this.drainPendingTurns();
        }
    }
    completeTurn(handle, result) {
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
    failTurn(handle, error) {
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
    drainPendingTurns() {
        if (this.activeTurn || this.pendingTurns.length === 0) {
            return;
        }
        const next = this.pendingTurns.shift();
        void this.startTurn(next.handle, next.options);
    }
    resolveRequest(requestId) {
        const request = this.requestsById.get(requestId);
        if (!request) {
            return;
        }
        this.requestsById.delete(requestId);
        const turn = this.turnsByProviderId.get(request.turnId);
        turn?.resolveRequest(requestId);
    }
    turnFromRemote(turnId, createIfMissing = false) {
        if (turnId && this.turnsByProviderId.has(turnId)) {
            return this.turnsByProviderId.get(turnId);
        }
        if (!this.activeTurn && createIfMissing && this.threadId && turnId) {
            const handle = new CodexTurnHandle(`attached-${++this.turnCounter}`, this.threadId, '', { resumed: true, synthetic: true });
            handle.setProviderTurnId(turnId);
            handle.markStarted();
            this.turns.push(handle);
            this.turnsByProviderId.set(turnId, handle);
            this.activeTurn = handle;
            return handle;
        }
        return this.activeTurn;
    }
    attachRawEventHandlers() {
        this.rawClient.on('notification', (notification) => {
            this.handleNotification(notification);
        });
        this.rawClient.on('request', (request) => {
            this.handleRequest(request);
        });
        this.rawClient.on('error', (error) => {
            if (this.activeTurn) {
                this.failTurn(this.activeTurn, error);
            }
        });
    }
    handleNotification(notification) {
        const params = notification.params || {};
        const notificationThreadId = params.threadId || params.thread?.id;
        if (this.threadId && notificationThreadId && notificationThreadId !== this.threadId) {
            return;
        }
        const turn = this.turnFromRemote(params.turnId || params.turn?.id, true);
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
                const result = params.turn?.error
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
    handleRequest(request) {
        const params = request.params || {};
        const requestThreadId = params.threadId || params.thread?.id || params.conversationId;
        if (this.threadId && requestThreadId && requestThreadId !== this.threadId) {
            return;
        }
        const turn = this.turnFromRemote(params.turnId, true);
        if (!turn) {
            this.rawClient.sendError(request.id, { message: 'Unknown turn' });
            return;
        }
        const requestId = `request-${++this.requestCounter}`;
        let openRequest = null;
        switch (request.method) {
            case 'item/commandExecution/requestApproval':
                openRequest = this.buildCommandApprovalRequest(requestId, request.id, params);
                break;
            case 'item/fileChange/requestApproval':
                openRequest = this.buildFileApprovalRequest(requestId, request.id, params);
                break;
            case 'item/tool/requestUserInput':
                openRequest = this.buildQuestionRequest(requestId, request.id, params);
                break;
            case 'item/tool/call':
                openRequest = this.buildToolCallRequest(requestId, request.id, params);
                break;
            default:
                this.rawClient.sendError(request.id, { message: `Unsupported request: ${request.method}` });
                return;
        }
        this.requestsById.set(requestId, openRequest);
        turn.addRequest(openRequest);
    }
    buildCommandApprovalRequest(requestId, rawRequestId, params) {
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
    buildFileApprovalRequest(requestId, rawRequestId, params) {
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
    buildQuestionRequest(requestId, rawRequestId, params) {
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
    buildToolCallRequest(requestId, rawRequestId, params) {
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
function mapCommandApprovalDecision(decision, suggestedAmendment) {
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
function mapFileApprovalDecision(decision) {
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
function normalizeQuestionAnswers(request, answers) {
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
    const normalized = {};
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
