"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeCodexThreadMessages = normalizeCodexThreadMessages;
exports.listCodexSessionSummaries = listCodexSessionSummaries;
exports.readCodexSessionRecord = readCodexSessionRecord;
function toIsoTimestamp(value) {
    if (typeof value === 'string') {
        const parsed = Date.parse(value);
        if (Number.isFinite(parsed))
            return new Date(parsed).toISOString();
    }
    if (typeof value === 'number') {
        const ms = value > 1_000_000_000_000 ? value : value * 1000;
        return new Date(ms).toISOString();
    }
    return new Date().toISOString();
}
function safeJson(value, maxChars = 1200) {
    try {
        const raw = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return raw.length > maxChars ? `${raw.slice(0, maxChars)}...` : raw;
    }
    catch {
        return String(value);
    }
}
function buildTranscriptMessage(role, createdAt, turnId, itemId, blockIndex, block) {
    return {
        id: `${turnId}:${itemId}:${blockIndex}`,
        role,
        createdAt,
        turnId,
        itemId,
        content: [block]
    };
}
function collectTextFromUserInputs(content) {
    const texts = [];
    for (const entry of content) {
        if (!entry || typeof entry !== 'object')
            continue;
        if (entry.type === 'text' && typeof entry.text === 'string' && entry.text.trim()) {
            texts.push(entry.text.trim());
        }
        else if (typeof entry.text === 'string' && entry.text.trim()) {
            texts.push(entry.text.trim());
        }
    }
    return texts;
}
function commandResultText(item) {
    const lines = [];
    if (typeof item?.status === 'string')
        lines.push(`Status: ${item.status}`);
    if (typeof item?.exitCode === 'number')
        lines.push(`Exit code: ${item.exitCode}`);
    if (typeof item?.durationMs === 'number')
        lines.push(`Duration: ${item.durationMs} ms`);
    if (typeof item?.aggregatedOutput === 'string' && item.aggregatedOutput.trim()) {
        lines.push('');
        lines.push(item.aggregatedOutput.trim());
    }
    return lines.join('\n').trim() || 'No command output available.';
}
function fileChangeResultText(item) {
    const changes = Array.isArray(item?.changes) ? item.changes : [];
    const lines = [`Files changed: ${changes.length}`];
    if (typeof item?.status === 'string')
        lines.unshift(`Status: ${item.status}`);
    for (const change of changes.slice(0, 20)) {
        const changePath = change?.path || change?.filePath || change?.file || change?.name || 'unknown';
        const kind = change?.kind || change?.changeType || 'updated';
        lines.push(`- ${kind}: ${changePath}`);
    }
    if (changes.length > 20)
        lines.push(`- ...and ${changes.length - 20} more`);
    return lines.join('\n').trim();
}
function mcpResultText(item) {
    if (item?.error)
        return `Error: ${safeJson(item.error, 800)}`;
    if (item?.result != null)
        return safeJson(item.result, 1200);
    return 'No MCP result available.';
}
function extractFirstPrompt(thread) {
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    for (const turn of turns) {
        const turnInput = Array.isArray(turn?.input) ? turn.input : [];
        for (const entry of turnInput) {
            if (typeof entry?.text === 'string' && entry.text.trim())
                return entry.text.trim();
        }
        const items = Array.isArray(turn?.items) ? turn.items : [];
        for (const wrappedItem of items) {
            const item = wrappedItem?.item || wrappedItem;
            if (item?.type === 'userMessage') {
                const texts = collectTextFromUserInputs(Array.isArray(item?.content) ? item.content : []);
                if (texts.length > 0)
                    return texts[0];
            }
        }
    }
    return thread.preview || 'Codex thread';
}
function normalizeCodexThreadMessages(thread) {
    const messages = [];
    const turns = Array.isArray(thread.turns) ? thread.turns : [];
    turns.forEach((turn, turnIndex) => {
        const turnId = typeof turn?.id === 'string' ? turn.id : `turn-${turnIndex}`;
        const turnCreatedAt = toIsoTimestamp(turn?.createdAt ?? thread.updatedAt ?? Date.now());
        const turnInput = Array.isArray(turn?.input) ? turn.input : [];
        turnInput.forEach((entry, index) => {
            const text = typeof entry?.text === 'string' ? entry.text.trim() : '';
            if (!text)
                return;
            messages.push(buildTranscriptMessage('user', turnCreatedAt, turnId, `input-${index}`, 0, { type: 'text', text }));
        });
        const items = Array.isArray(turn?.items) ? turn.items : [];
        items.forEach((wrappedItem, itemIndex) => {
            const item = wrappedItem?.item || wrappedItem;
            const itemType = typeof item?.type === 'string' ? item.type : 'unknown';
            const itemId = typeof item?.id === 'string' ? item.id : `item-${itemIndex}`;
            const createdAt = toIsoTimestamp(item?.createdAt ?? turnCreatedAt);
            const blocks = [];
            let role = 'assistant';
            switch (itemType) {
                case 'userMessage': {
                    role = 'user';
                    for (const text of collectTextFromUserInputs(Array.isArray(item?.content) ? item.content : [])) {
                        blocks.push({ type: 'text', text });
                    }
                    break;
                }
                case 'agentMessage': {
                    if (typeof item?.text === 'string' && item.text.trim())
                        blocks.push({ type: 'text', text: item.text.trim() });
                    break;
                }
                case 'reasoning': {
                    const summary = Array.isArray(item?.summary) ? item.summary.filter((x) => typeof x === 'string') : [];
                    const content = Array.isArray(item?.content) ? item.content.filter((x) => typeof x === 'string') : [];
                    const thinking = [...summary, ...content].join('\n').trim();
                    if (thinking)
                        blocks.push({ type: 'thinking', thinking });
                    break;
                }
                case 'plan': {
                    if (typeof item?.text === 'string' && item.text.trim())
                        blocks.push({ type: 'plan', text: item.text.trim() });
                    break;
                }
                case 'commandExecution': {
                    blocks.push({
                        type: 'tool_use',
                        name: 'CommandExecution',
                        toolUseId: itemId,
                        input: { command: item?.command, cwd: item?.cwd, commandActions: item?.commandActions }
                    });
                    blocks.push({
                        type: 'tool_result',
                        toolUseId: itemId,
                        isError: item?.status === 'failed' || item?.status === 'declined',
                        content: commandResultText(item)
                    });
                    if (item?.status === 'inProgress') {
                        blocks.push({
                            type: 'approval_needed',
                            title: 'Command approval may be required',
                            description: 'This command appears unresolved in the saved Codex thread.',
                            toolName: 'CommandExecution',
                            status: item?.status,
                            requiresAttach: true,
                            payload: { command: item?.command, cwd: item?.cwd }
                        });
                    }
                    break;
                }
                case 'fileChange': {
                    blocks.push({
                        type: 'tool_use',
                        name: 'FileChange',
                        toolUseId: itemId,
                        input: { changes: item?.changes, status: item?.status }
                    });
                    blocks.push({
                        type: 'tool_result',
                        toolUseId: itemId,
                        isError: item?.status === 'failed' || item?.status === 'declined',
                        content: fileChangeResultText(item)
                    });
                    break;
                }
                case 'mcpToolCall': {
                    blocks.push({
                        type: 'tool_use',
                        name: `MCP ${item?.server || 'server'}/${item?.tool || 'tool'}`,
                        toolUseId: itemId,
                        input: item?.arguments
                    });
                    blocks.push({
                        type: 'tool_result',
                        toolUseId: itemId,
                        isError: item?.status === 'failed',
                        content: mcpResultText(item)
                    });
                    break;
                }
                default: {
                    const fallback = safeJson(item, 900).trim();
                    if (fallback)
                        blocks.push({ type: 'text', text: `[${itemType}] ${fallback}` });
                    break;
                }
            }
            blocks.forEach((block, blockIndex) => {
                messages.push(buildTranscriptMessage(role, createdAt, turnId, itemId, blockIndex, block));
            });
        });
    });
    return messages;
}
async function listCodexSessionSummaries(client, params = {}) {
    const response = await client.listThreads(params);
    return response.data.map((thread) => ({
        provider: 'codex',
        sessionId: thread.id,
        title: thread.preview || 'Codex thread',
        createdAt: toIsoTimestamp(thread.createdAt),
        updatedAt: toIsoTimestamp(thread.updatedAt ?? thread.createdAt),
        messageCount: Array.isArray(thread.turns) ? thread.turns.length : 0,
        projectPath: thread.cwd || (typeof thread.path === 'string' ? thread.path : undefined),
        gitBranch: typeof thread.gitInfo?.branch === 'string' ? thread.gitInfo.branch : undefined,
        raw: thread
    }));
}
async function readCodexSessionRecord(client, threadId, params = {}) {
    const response = await client.readThread({ ...params, threadId, includeTurns: true });
    const thread = response.thread;
    if (!thread)
        return null;
    return {
        provider: 'codex',
        sessionId: thread.id,
        title: thread.preview || extractFirstPrompt(thread),
        createdAt: toIsoTimestamp(thread.createdAt),
        updatedAt: toIsoTimestamp(thread.updatedAt ?? thread.createdAt),
        messageCount: Array.isArray(thread.turns) ? thread.turns.length : 0,
        projectPath: thread.cwd || (typeof thread.path === 'string' ? thread.path : undefined),
        gitBranch: typeof thread.gitInfo?.branch === 'string' ? thread.gitInfo.branch : undefined,
        raw: thread,
        rawMessages: Array.isArray(thread.turns) ? thread.turns : [],
        messages: normalizeCodexThreadMessages(thread)
    };
}
