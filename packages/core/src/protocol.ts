// --- Event types ---

export type SessionInitEvent = {
	type: "session_init";
	sessionId: string;
};

export type ResultEvent = {
	type: "result";
	result?: string;
};

export type ErrorEvent = {
	type: "error";
	message: string;
};

export type MessageStartEvent = {
	type: "message_start";
	role: "assistant";
	parentToolUseId?: string;
};

export type TextDeltaEvent = {
	type: "text_delta";
	text: string;
};

export type ThinkingDeltaEvent = {
	type: "thinking_delta";
	text: string;
};

export type ToolStartEvent = {
	type: "tool_start";
	toolCallId: string;
	toolName: string;
};

export type ToolInputDeltaEvent = {
	type: "tool_input_delta";
	toolCallId: string;
	text: string;
};

export type ToolCallEvent = {
	type: "tool_call";
	toolCallId: string;
	toolName: string;
	input: Record<string, unknown>;
};

export type ToolResultEvent = {
	type: "tool_result";
	toolCallId: string;
	result: unknown;
	isError?: boolean;
};

export type PermissionRequestEvent = {
	type: "permission_request";
	id: string;
	toolName: string;
	input: Record<string, unknown>;
	toolUseId?: string;
	reason?: string;
};

export type PermissionResolvedEvent = {
	type: "permission_resolved";
	id: string;
	behavior: "allow" | "deny";
};

export type UserQuestionEvent = {
	type: "user_question";
	id: string;
	question: string;
	options: { label: string; description: string }[];
};

export type UserQuestionAnsweredEvent = {
	type: "user_question_answered";
	id: string;
	answer: string;
};

export type AgentEvent =
	| SessionInitEvent
	| ResultEvent
	| ErrorEvent
	| MessageStartEvent
	| TextDeltaEvent
	| ThinkingDeltaEvent
	| ToolStartEvent
	| ToolInputDeltaEvent
	| ToolCallEvent
	| ToolResultEvent
	| PermissionRequestEvent
	| PermissionResolvedEvent
	| UserQuestionEvent
	| UserQuestionAnsweredEvent;

// --- Wire format ---

const DATA_PREFIX = "data: ";
const DONE_MARKER = "[DONE]";

export function encodeEvent(event: AgentEvent): string {
	return `${DATA_PREFIX}${JSON.stringify(event)}\n\n`;
}

export function encodeDone(): string {
	return `${DATA_PREFIX}${DONE_MARKER}\n\n`;
}

export function decodeEvent(line: string): AgentEvent | null {
	if (!line.startsWith(DATA_PREFIX)) {
		throw new Error(`Expected SSE data line, got: ${line}`);
	}
	const payload = line.slice(DATA_PREFIX.length);
	if (payload === DONE_MARKER) {
		return null;
	}
	return JSON.parse(payload) as AgentEvent;
}
