import { describe, expect, it } from "vitest";
import { convertMessages } from "./convert";
import type { AgentEvent } from "./protocol";
import { type AgentState, initialState, reduceEvent } from "./state";

function stateFrom(events: AgentEvent[]): AgentState {
	return events.reduce(reduceEvent, initialState());
}

describe("convertMessages", () => {
	it("returns empty array for empty state", () => {
		const state = stateFrom([{ type: "session_init", sessionId: "s1" }]);
		expect(convertMessages(state)).toEqual([]);
	});

	it("converts single text message", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Hello world" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("assistant");
		expect(messages[0]?.content).toEqual([
			{ type: "text", text: "Hello world" },
		]);
	});

	it("includes reasoning parts from thinking", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "thinking_delta", text: "Let me think about this" },
			{ type: "text_delta", text: "Here's my answer" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		const content = messages[0]?.content;
		expect(content).toEqual([
			{ type: "reasoning", text: "Let me think about this" },
			{ type: "text", text: "Here's my answer" },
		]);
	});

	it("converts tool calls with results", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Let me check" },
			{ type: "tool_start", toolCallId: "tc_1", toolName: "Read" },
			{
				type: "tool_call",
				toolCallId: "tc_1",
				toolName: "Read",
				input: { file_path: "/tmp/test.ts" },
			},
			{
				type: "tool_result",
				toolCallId: "tc_1",
				result: "file contents",
			},
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		const content = messages[0]?.content;
		expect(content).toHaveLength(2);
		expect(content?.[0]).toEqual({ type: "text", text: "Let me check" });
		expect(content?.[1]).toMatchObject({
			type: "tool-call",
			toolCallId: "tc_1",
			toolName: "Read",
			args: { file_path: "/tmp/test.ts" },
			result: "file contents",
		});
	});

	it("marks tool call errors with isError", () => {
		const state = stateFrom([
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
				result: "command failed",
				isError: true,
			},
			{ type: "result" },
		]);
		const tc = convertMessages(state)[0]?.content?.[0];
		expect(tc).toMatchObject({
			type: "tool-call",
			isError: true,
			result: "command failed",
		});
	});

	it("includes streaming text as text part on latest message", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Partial response so far" },
			// No result yet — still streaming
		]);
		const messages = convertMessages(state);
		expect(messages[0]?.content).toEqual([
			{ type: "text", text: "Partial response so far" },
		]);
	});

	it("includes streaming tool input as argsText", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
			{
				type: "tool_input_delta",
				toolCallId: "tc_1",
				text: '{"command": "ls',
			},
			// Still streaming — no tool_call finalized yet
		]);
		const tc = convertMessages(state)[0]?.content?.[0];
		expect(tc).toMatchObject({
			type: "tool-call",
			toolCallId: "tc_1",
			toolName: "Bash",
			argsText: '{"command": "ls',
		});
	});

	it("maps parentToolUseId to parentId on tool-call parts", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{
				type: "message_start",
				role: "assistant",
				parentToolUseId: "parent_tc",
			},
			{ type: "text_delta", text: "Subagent output" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		expect(messages[0]?.metadata?.custom?.parentToolUseId).toBe("parent_tc");
	});

	it("converts multiple messages in sequence", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "First" },
			{ type: "tool_start", toolCallId: "tc_1", toolName: "Read" },
			{
				type: "tool_call",
				toolCallId: "tc_1",
				toolName: "Read",
				input: { file: "a.ts" },
			},
			{ type: "tool_result", toolCallId: "tc_1", result: "contents" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Second" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.content?.[0]).toMatchObject({
			type: "text",
			text: "First",
		});
		expect(messages[1]?.content).toEqual([{ type: "text", text: "Second" }]);
	});

	it("sets status to running on last message when isRunning", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Working..." },
		]);
		const messages = convertMessages(state);
		expect(messages[0]?.status).toEqual({ type: "running" });
	});

	it("sets status to complete when not running", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Done" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		expect(messages[0]?.status).toEqual({ type: "complete" });
	});

	it("skips messages with no content", () => {
		const state = stateFrom([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			// No text, no thinking, no tools
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Hello" },
			{ type: "result" },
		]);
		const messages = convertMessages(state);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.content).toEqual([{ type: "text", text: "Hello" }]);
	});
});
