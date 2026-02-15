import { describe, expect, it } from "vitest";
import type { AgentEvent } from "./protocol";
import { decodeEvent, encodeDone, encodeEvent } from "./protocol";

const allEvents: AgentEvent[] = [
	// Session lifecycle
	{ type: "session_init", sessionId: "sess_123" },
	{ type: "result", result: "Task completed" },
	{ type: "result" },
	{ type: "error", message: "Something went wrong" },
	// Message structure
	{ type: "message_start", role: "assistant" },
	{
		type: "message_start",
		role: "assistant",
		parentToolUseId: "tool_abc",
	},
	// Content streaming
	{ type: "text_delta", text: "Hello " },
	{ type: "thinking_delta", text: "Let me consider..." },
	// Tool lifecycle
	{ type: "tool_start", toolCallId: "tc_1", toolName: "Bash" },
	{ type: "tool_input_delta", toolCallId: "tc_1", text: '{"command":' },
	{
		type: "tool_call",
		toolCallId: "tc_1",
		toolName: "Bash",
		input: { command: "ls -la" },
	},
	{
		type: "tool_result",
		toolCallId: "tc_1",
		result: "file1.ts\nfile2.ts",
	},
	{
		type: "tool_result",
		toolCallId: "tc_2",
		result: "error output",
		isError: true,
	},
	// Human-in-the-loop: permissions
	{
		type: "permission_request",
		id: "perm_1",
		toolName: "Bash",
		input: { command: "rm -rf /" },
	},
	{ type: "permission_resolved", id: "perm_1", behavior: "deny" },
	{ type: "permission_resolved", id: "perm_2", behavior: "allow" },
	// Human-in-the-loop: questions
	{
		type: "user_question",
		id: "q_1",
		question: "Which approach?",
		options: [
			{ label: "Option A", description: "First approach" },
			{ label: "Option B", description: "Second approach" },
		],
	},
	{ type: "user_question_answered", id: "q_1", answer: "Option A" },
];

describe("encodeEvent", () => {
	it("produces SSE data line for each event type", () => {
		for (const event of allEvents) {
			const encoded = encodeEvent(event);
			expect(encoded).toBe(`data: ${JSON.stringify(event)}\n\n`);
		}
	});
});

describe("encodeDone", () => {
	it("produces terminal SSE marker", () => {
		expect(encodeDone()).toBe("data: [DONE]\n\n");
	});
});

describe("decodeEvent", () => {
	it("parses each event type from SSE data line", () => {
		for (const event of allEvents) {
			const line = `data: ${JSON.stringify(event)}`;
			const decoded = decodeEvent(line);
			expect(decoded).toEqual(event);
		}
	});

	it("handles data line with trailing newlines stripped", () => {
		const event: AgentEvent = { type: "text_delta", text: "hi" };
		const decoded = decodeEvent(`data: ${JSON.stringify(event)}`);
		expect(decoded).toEqual(event);
	});

	it("returns null for [DONE] marker", () => {
		expect(decodeEvent("data: [DONE]")).toBeNull();
	});

	it("throws on malformed input without data: prefix", () => {
		expect(() => decodeEvent("not a data line")).toThrow();
	});

	it("throws on invalid JSON after data: prefix", () => {
		expect(() => decodeEvent("data: {not json")).toThrow();
	});
});

describe("roundtrip", () => {
	it("decode(encode(event)) deep-equals original for every variant", () => {
		for (const event of allEvents) {
			const encoded = encodeEvent(event);
			// Strip trailing \n\n for decode (SSE lines come without trailing newlines)
			const line = encoded.trimEnd();
			const decoded = decodeEvent(line);
			expect(decoded).toEqual(event);
		}
	});
});
