import type { CodexClient } from './client.js';
import type { Thread, ThreadListParams, ThreadReadParams, SessionBrowserRecord, SessionBrowserSummary, SessionTranscriptMessage } from './types.js';
export declare function normalizeCodexThreadMessages(thread: Thread): SessionTranscriptMessage[];
export declare function listCodexSessionSummaries(client: Pick<CodexClient, 'listThreads'>, params?: ThreadListParams): Promise<SessionBrowserSummary<Thread>[]>;
export declare function readCodexSessionRecord(client: Pick<CodexClient, 'readThread'>, threadId: string, params?: Omit<ThreadReadParams, 'threadId' | 'includeTurns'>): Promise<SessionBrowserRecord<Thread, unknown> | null>;
