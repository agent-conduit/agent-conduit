import type { AgentEvent } from "./protocol";

export type ToolCallInfo = {
	toolCallId: string;
	toolName: string;
	inputText: string;
	input?: Record<string, unknown>;
	result?: unknown;
	isError?: boolean;
};

export type PendingPermission = {
	id: string;
	toolName: string;
	input: Record<string, unknown>;
};

export type PendingQuestion = {
	id: string;
	question: string;
	options: { label: string; description: string }[];
};

export type AgentMessage = {
	role: "assistant";
	parentToolUseId?: string;
	currentText: string;
	currentThinking: string;
	toolCalls: Map<string, ToolCallInfo>;
};

export type AgentState = {
	sessionId: string | undefined;
	isRunning: boolean;
	messages: AgentMessage[];
	pendingPermissions: Map<string, PendingPermission>;
	pendingQuestions: Map<string, PendingQuestion>;
	result?: string;
	error?: string;
};

export function initialState(): AgentState {
	return {
		sessionId: undefined,
		isRunning: false,
		messages: [],
		pendingPermissions: new Map(),
		pendingQuestions: new Map(),
	};
}

function latestMessage(state: AgentState): AgentMessage {
	const msg = state.messages[state.messages.length - 1];
	if (!msg) throw new Error("No messages in state");
	return msg;
}

export function reduceEvent(state: AgentState, event: AgentEvent): AgentState {
	switch (event.type) {
		case "session_init":
			return {
				...initialState(),
				sessionId: event.sessionId,
				isRunning: true,
			};

		case "message_start": {
			const msg: AgentMessage = {
				role: event.role,
				parentToolUseId: event.parentToolUseId,
				currentText: "",
				currentThinking: "",
				toolCalls: new Map(),
			};
			return { ...state, messages: [...state.messages, msg] };
		}

		case "text_delta": {
			const msg = latestMessage(state);
			const updated: AgentMessage = {
				...msg,
				currentText: msg.currentText + event.text,
			};
			return {
				...state,
				messages: [...state.messages.slice(0, -1), updated],
			};
		}

		case "thinking_delta": {
			const msg = latestMessage(state);
			const updated: AgentMessage = {
				...msg,
				currentThinking: msg.currentThinking + event.text,
			};
			return {
				...state,
				messages: [...state.messages.slice(0, -1), updated],
			};
		}

		case "tool_start": {
			const msg = latestMessage(state);
			const toolCalls = new Map(msg.toolCalls);
			toolCalls.set(event.toolCallId, {
				toolCallId: event.toolCallId,
				toolName: event.toolName,
				inputText: "",
			});
			return {
				...state,
				messages: [...state.messages.slice(0, -1), { ...msg, toolCalls }],
			};
		}

		case "tool_input_delta": {
			const msg = latestMessage(state);
			const tc = msg.toolCalls.get(event.toolCallId);
			if (!tc) return state;
			const toolCalls = new Map(msg.toolCalls);
			toolCalls.set(event.toolCallId, {
				...tc,
				inputText: tc.inputText + event.text,
			});
			return {
				...state,
				messages: [...state.messages.slice(0, -1), { ...msg, toolCalls }],
			};
		}

		case "tool_call": {
			const msg = latestMessage(state);
			const tc = msg.toolCalls.get(event.toolCallId);
			if (!tc) return state;
			const toolCalls = new Map(msg.toolCalls);
			toolCalls.set(event.toolCallId, { ...tc, input: event.input });
			return {
				...state,
				messages: [...state.messages.slice(0, -1), { ...msg, toolCalls }],
			};
		}

		case "tool_result": {
			// Find tool call across all messages
			for (let i = state.messages.length - 1; i >= 0; i--) {
				const msg = state.messages[i];
				if (!msg) continue;
				const tc = msg.toolCalls.get(event.toolCallId);
				if (tc) {
					const toolCalls = new Map(msg.toolCalls);
					toolCalls.set(event.toolCallId, {
						...tc,
						result: event.result,
						isError: event.isError,
					});
					const messages = [...state.messages];
					messages[i] = { ...msg, toolCalls };
					return { ...state, messages };
				}
			}
			return state;
		}

		case "permission_request": {
			const pendingPermissions = new Map(state.pendingPermissions);
			pendingPermissions.set(event.id, {
				id: event.id,
				toolName: event.toolName,
				input: event.input,
			});
			return { ...state, pendingPermissions };
		}

		case "permission_resolved": {
			const pendingPermissions = new Map(state.pendingPermissions);
			pendingPermissions.delete(event.id);
			return { ...state, pendingPermissions };
		}

		case "user_question": {
			const pendingQuestions = new Map(state.pendingQuestions);
			pendingQuestions.set(event.id, {
				id: event.id,
				question: event.question,
				options: event.options,
			});
			return { ...state, pendingQuestions };
		}

		case "user_question_answered": {
			const pendingQuestions = new Map(state.pendingQuestions);
			pendingQuestions.delete(event.id);
			return { ...state, pendingQuestions };
		}

		case "result":
			return { ...state, isRunning: false, result: event.result };

		case "error":
			return { ...state, isRunning: false, error: event.message };
	}
}
