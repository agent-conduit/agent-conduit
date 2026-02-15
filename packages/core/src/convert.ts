import type { AgentMessage, AgentState, ToolCallInfo } from "./state";

type TextPart = { type: "text"; text: string };
type ReasoningPart = { type: "reasoning"; text: string };
type ToolCallPart = {
	type: "tool-call";
	toolCallId: string;
	toolName: string;
	args?: Record<string, unknown>;
	argsText?: string;
	result?: unknown;
	isError?: boolean;
};

type MessagePart = TextPart | ReasoningPart | ToolCallPart;

type MessageStatus = { type: "running" } | { type: "complete" };

export type ConvertedMessage = {
	role: "assistant";
	content: MessagePart[];
	status: MessageStatus;
	metadata?: {
		custom?: Record<string, unknown>;
	};
};

function convertToolCall(tc: ToolCallInfo): ToolCallPart {
	const part: ToolCallPart = {
		type: "tool-call",
		toolCallId: tc.toolCallId,
		toolName: tc.toolName,
	};

	if (tc.input) {
		part.args = tc.input;
		part.argsText = JSON.stringify(tc.input);
	} else if (tc.inputText) {
		part.argsText = tc.inputText;
	}

	if (tc.result !== undefined) {
		part.result = tc.result;
	}
	if (tc.isError) {
		part.isError = tc.isError;
	}

	return part;
}

function convertMessage(
	msg: AgentMessage,
	isLast: boolean,
	isRunning: boolean,
): ConvertedMessage | null {
	const parts: MessagePart[] = [];

	if (msg.currentThinking) {
		parts.push({ type: "reasoning", text: msg.currentThinking });
	}

	if (msg.currentText) {
		parts.push({ type: "text", text: msg.currentText });
	}

	for (const tc of msg.toolCalls.values()) {
		parts.push(convertToolCall(tc));
	}

	if (parts.length === 0) return null;

	const status: MessageStatus =
		isLast && isRunning ? { type: "running" } : { type: "complete" };

	const result: ConvertedMessage = {
		role: "assistant",
		content: parts,
		status,
	};

	if (msg.parentToolUseId) {
		result.metadata = {
			custom: { parentToolUseId: msg.parentToolUseId },
		};
	}

	return result;
}

export function convertMessages(state: AgentState): ConvertedMessage[] {
	const results: ConvertedMessage[] = [];
	const lastIndex = state.messages.length - 1;

	for (let i = 0; i < state.messages.length; i++) {
		const msg = state.messages[i];
		if (!msg) continue;
		const converted = convertMessage(msg, i === lastIndex, state.isRunning);
		if (converted) results.push(converted);
	}

	return results;
}
