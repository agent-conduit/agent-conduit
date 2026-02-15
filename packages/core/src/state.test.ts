import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./protocol";
import { type AgentState, initialState, reduceEvent } from "./state";

function reduce(events: AgentEvent[]): AgentState {
	return events.reduce(reduceEvent, initialState());
}

describe("reduceEvent", () => {
	describe("session_init", () => {
		it("sets sessionId and resets to running state", () => {
			const state = reduce([{ type: "session_init", sessionId: "s1" }]);
			expect(state.sessionId).toBe("s1");
			expect(state.isRunning).toBe(true);
			expect(state.messages).toEqual([]);
		});
	});

	describe("message_start", () => {
		it("pushes a new assistant message", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
			]);
			expect(state.messages).toHaveLength(1);
			expect(state.messages[0]?.role).toBe("assistant");
			expect(state.messages[0]?.parentToolUseId).toBeUndefined();
		});

		it("records parentToolUseId for subagent messages", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{
					type: "message_start",
					role: "assistant",
					parentToolUseId: "tool_abc",
				},
			]);
			expect(state.messages[0]?.parentToolUseId).toBe("tool_abc");
		});
	});

	describe("text_delta", () => {
		it("appends text to currentText on latest message", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "text_delta", text: "Hello " },
				{ type: "text_delta", text: "world" },
			]);
			expect(state.messages[0]?.currentText).toBe("Hello world");
		});
	});

	describe("thinking_delta", () => {
		it("appends text to currentThinking on latest message", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "thinking_delta", text: "Let me " },
				{ type: "thinking_delta", text: "think..." },
			]);
			expect(state.messages[0]?.currentThinking).toBe("Let me think...");
		});
	});

	describe("tool_start", () => {
		it("adds a new tool call to latest message", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc).toBeDefined();
			expect(tc?.toolName).toBe("Bash");
			expect(tc?.inputText).toBe("");
			expect(tc?.input).toBeUndefined();
			expect(tc?.result).toBeUndefined();
		});
	});

	describe("tool_input_delta", () => {
		it("appends to tool call inputText", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
				{ type: "tool_input_delta", toolCallId: "tc_1", text: '{"cmd":' },
				{ type: "tool_input_delta", toolCallId: "tc_1", text: '"ls"}' },
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc?.inputText).toBe('{"cmd":"ls"}');
		});
	});

	describe("tool_call", () => {
		it("finalizes tool call with parsed input", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
				{
					type: "tool_call",
					toolCallId: "tc_1",
					toolName: "Bash",
					input: { command: "ls" },
				},
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc?.input).toEqual({ command: "ls" });
		});
	});

	describe("tool_result", () => {
		it("sets result on matching tool call", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
				{
					type: "tool_call",
					toolCallId: "tc_1",
					toolName: "Bash",
					input: { command: "ls" },
				},
				{
					type: "tool_result",
					toolCallId: "tc_1",
					result: "file1.ts",
				},
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc?.result).toBe("file1.ts");
			expect(tc?.isError).toBeUndefined();
		});

		it("sets isError when tool result is an error", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
				{
					type: "tool_call",
					toolCallId: "tc_1",
					toolName: "Bash",
					input: { command: "bad" },
				},
				{
					type: "tool_result",
					toolCallId: "tc_1",
					result: "error",
					isError: true,
				},
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc?.isError).toBe(true);
		});

		it("finds tool call on earlier message", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "message_start", role: "assistant" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
				{
					type: "tool_call",
					toolCallId: "tc_1",
					toolName: "Bash",
					input: { command: "ls" },
				},
				{ type: "message_start", role: "assistant" },
				{
					type: "tool_result",
					toolCallId: "tc_1",
					result: "output",
				},
			]);
			const tc = state.messages[0]?.toolCalls.get("tc_1");
			expect(tc?.result).toBe("output");
		});
	});

	describe("permission_request", () => {
		it("adds to pendingPermissions", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{
					type: "permission_request",
					id: "p1",
					toolName: "Bash",
					input: { command: "rm -rf /" },
				},
			]);
			const perm = state.pendingPermissions.get("p1");
			expect(perm).toBeDefined();
			expect(perm?.toolName).toBe("Bash");
			expect(perm?.input).toEqual({ command: "rm -rf /" });
		});
	});

	describe("permission_resolved", () => {
		it("removes from pendingPermissions", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{
					type: "permission_request",
					id: "p1",
					toolName: "Bash",
					input: { command: "rm -rf /" },
				},
				{ type: "permission_resolved", id: "p1", behavior: "deny" },
			]);
			expect(state.pendingPermissions.has("p1")).toBe(false);
		});
	});

	describe("user_question", () => {
		it("adds to pendingQuestions", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{
					type: "user_question",
					id: "q1",
					question: "Which approach?",
					options: [
						{ label: "A", description: "First" },
						{ label: "B", description: "Second" },
					],
				},
			]);
			const q = state.pendingQuestions.get("q1");
			expect(q).toBeDefined();
			expect(q?.question).toBe("Which approach?");
			expect(q?.options).toHaveLength(2);
		});
	});

	describe("user_question_answered", () => {
		it("removes from pendingQuestions", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{
					type: "user_question",
					id: "q1",
					question: "Which?",
					options: [
						{ label: "A", description: "First" },
						{ label: "B", description: "Second" },
					],
				},
				{ type: "user_question_answered", id: "q1", answer: "A" },
			]);
			expect(state.pendingQuestions.has("q1")).toBe(false);
		});
	});

	describe("result", () => {
		it("sets isRunning false and stores result", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "result", result: "Done" },
			]);
			expect(state.isRunning).toBe(false);
			expect(state.result).toBe("Done");
			expect(state.error).toBeUndefined();
		});

		it("handles result without result text", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "result" },
			]);
			expect(state.isRunning).toBe(false);
			expect(state.result).toBeUndefined();
		});
	});

	describe("error", () => {
		it("sets isRunning false and stores error", () => {
			const state = reduce([
				{ type: "session_init", sessionId: "s1" },
				{ type: "error", message: "Something broke" },
			]);
			expect(state.isRunning).toBe(false);
			expect(state.error).toBe("Something broke");
			expect(state.result).toBeUndefined();
		});
	});

	describe("realistic multi-turn sequence", () => {
		it("produces correct final state", () => {
			const events: AgentEvent[] = [
				{ type: "session_init", sessionId: "sess_1" },
				{ type: "message_start", role: "assistant" },
				{ type: "text_delta", text: "Let me check" },
				{ type: "thinking_delta", text: "I should read the file" },
				{ type: "tool_start", toolCallId: "tc_1", toolName: "Read" },
				{
					type: "tool_input_delta",
					toolCallId: "tc_1",
					text: '{"file":"README.md"}',
				},
				{
					type: "tool_call",
					toolCallId: "tc_1",
					toolName: "Read",
					input: { file: "README.md" },
				},
				{
					type: "tool_result",
					toolCallId: "tc_1",
					result: "# Hello",
				},
				{ type: "message_start", role: "assistant" },
				{ type: "text_delta", text: "The file contains: " },
				{ type: "text_delta", text: "a heading" },
				{ type: "result", result: "Completed successfully" },
			];

			const state = reduce(events);

			expect(state.sessionId).toBe("sess_1");
			expect(state.isRunning).toBe(false);
			expect(state.result).toBe("Completed successfully");
			expect(state.messages).toHaveLength(2);

			const msg0 = state.messages[0];
			expect(msg0?.currentText).toBe("Let me check");
			expect(msg0?.currentThinking).toBe("I should read the file");
			expect(msg0?.toolCalls.size).toBe(1);
			const tc = msg0?.toolCalls.get("tc_1");
			expect(tc?.toolName).toBe("Read");
			expect(tc?.input).toEqual({ file: "README.md" });
			expect(tc?.result).toBe("# Hello");

			const msg1 = state.messages[1];
			expect(msg1?.currentText).toBe("The file contains: a heading");
			expect(msg1?.toolCalls.size).toBe(0);
		});
	});
});
