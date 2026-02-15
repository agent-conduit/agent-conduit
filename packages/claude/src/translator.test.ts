import { describe, expect, it } from "vitest";
import { StreamTranslator } from "./translator";

describe("StreamTranslator", () => {
	it("emits message_start on stream_event/message_start", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "stream_event",
			event: { type: "message_start" },
		});
		expect(events).toEqual([{ type: "message_start", role: "assistant" }]);
	});

	it("emits tool_start on content_block_start with tool_use", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "stream_event",
			event: {
				type: "content_block_start",
				content_block: { type: "tool_use", id: "tool-1", name: "Read" },
			},
		});
		expect(events).toEqual([
			{ type: "tool_start", toolCallId: "tool-1", toolName: "Read" },
		]);
	});

	it("emits tool_start on content_block_start with server_tool_use", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "stream_event",
			event: {
				type: "content_block_start",
				content_block: {
					type: "server_tool_use",
					id: "tool-s1",
					name: "WebSearch",
				},
			},
		});
		expect(events).toEqual([
			{ type: "tool_start", toolCallId: "tool-s1", toolName: "WebSearch" },
		]);
	});

	it("emits text_delta on content_block_delta with text_delta", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "text_delta", text: "hello" },
			},
		});
		expect(events).toEqual([{ type: "text_delta", text: "hello" }]);
	});

	it("emits thinking_delta on content_block_delta with thinking_delta", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "Let me analyze..." },
			},
		});
		expect(events).toEqual([
			{ type: "thinking_delta", text: "Let me analyze..." },
		]);
	});

	it("emits tool_input_delta on content_block_delta with input_json_delta", () => {
		const t = new StreamTranslator();
		// Register a tool first so lastToolId works
		t.translate({
			type: "stream_event",
			event: {
				type: "content_block_start",
				content_block: { type: "tool_use", id: "tool-2", name: "Bash" },
			},
		});
		const events = t.translate({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "input_json_delta", partial_json: '{"command":' },
			},
		});
		expect(events).toEqual([
			{
				type: "tool_input_delta",
				toolCallId: "tool-2",
				text: '{"command":',
			},
		]);
	});

	it("emits tool_call on assistant message with tool_use blocks", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "assistant",
			message: {
				content: [
					{
						type: "tool_use",
						id: "t-1",
						name: "Read",
						input: { file_path: "/tmp/x" },
					},
				],
			},
		});
		expect(events).toEqual([
			{
				type: "tool_call",
				toolCallId: "t-1",
				toolName: "Read",
				input: { file_path: "/tmp/x" },
			},
		]);
	});

	it("emits tool_call for server_tool_use in assistant message", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "assistant",
			message: {
				content: [
					{
						type: "server_tool_use",
						id: "st-1",
						name: "WebSearch",
						input: { query: "test" },
					},
				],
			},
		});
		expect(events).toEqual([
			{
				type: "tool_call",
				toolCallId: "st-1",
				toolName: "WebSearch",
				input: { query: "test" },
			},
		]);
	});

	it("emits tool_result on user message with tool_result blocks", () => {
		const t = new StreamTranslator();
		// Register tool name first
		t.translate({
			type: "assistant",
			message: {
				content: [{ type: "tool_use", id: "t-2", name: "Bash", input: {} }],
			},
		});
		const events = t.translate({
			type: "user",
			message: {
				role: "user",
				content: [
					{ type: "tool_result", tool_use_id: "t-2", content: "output" },
				],
			},
		});
		expect(events).toEqual([
			{ type: "tool_result", toolCallId: "t-2", result: "output" },
		]);
	});

	it("extracts text from array content in tool_result", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "user",
			message: {
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "t-3",
						content: [
							{ type: "text", text: "part1" },
							{ type: "text", text: "part2" },
						],
					},
				],
			},
		});
		expect(events).toEqual([
			{ type: "tool_result", toolCallId: "t-3", result: "part1part2" },
		]);
	});

	it("emits result on success", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "result",
			subtype: "success",
			num_turns: 3,
			total_cost_usd: 0.05,
		});
		expect(events).toEqual([{ type: "result" }]);
	});

	it("emits error on non-success result", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "result",
			subtype: "max_turns",
		});
		expect(events).toEqual([{ type: "error", message: "max_turns" }]);
	});

	it("emits thinking_delta from assistant thinking block when no prior stream", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "assistant",
			message: {
				content: [{ type: "thinking", thinking: "I need to consider..." }],
			},
		});
		expect(events).toEqual([
			{ type: "thinking_delta", text: "I need to consider..." },
		]);
	});

	it("skips assistant thinking when stream thinking already emitted (dedup)", () => {
		const t = new StreamTranslator();
		// Simulate stream: message_start → thinking_delta
		t.translate({
			type: "stream_event",
			event: { type: "message_start" },
		});
		t.translate({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "stream thought" },
			},
		});
		// Now the assistant message arrives with the full thinking block
		const events = t.translate({
			type: "assistant",
			message: {
				content: [
					{ type: "thinking", thinking: "stream thought" },
					{ type: "text", text: "response" },
				],
			},
		});
		// Should NOT emit thinking_delta again — text blocks from assistant are also not emitted
		expect(events).toEqual([]);
	});

	it("resets hadStreamThinking on new message_start", () => {
		const t = new StreamTranslator();
		// First turn: stream thinking
		t.translate({
			type: "stream_event",
			event: { type: "message_start" },
		});
		t.translate({
			type: "stream_event",
			event: {
				type: "content_block_delta",
				delta: { type: "thinking_delta", thinking: "first" },
			},
		});
		// New turn: message_start resets the flag
		t.translate({
			type: "stream_event",
			event: { type: "message_start" },
		});
		// Assistant message with thinking should emit (no stream thinking this turn)
		const events = t.translate({
			type: "assistant",
			message: {
				content: [{ type: "thinking", thinking: "second turn thought" }],
			},
		});
		expect(events).toEqual([
			{ type: "thinking_delta", text: "second turn thought" },
		]);
	});

	it("returns empty array for unknown message types", () => {
		const t = new StreamTranslator();
		const events = t.translate({ type: "unknown_type" });
		expect(events).toEqual([]);
	});

	it("stores session_id from system/init message", () => {
		const t = new StreamTranslator();
		const events = t.translate({
			type: "system",
			subtype: "init",
			session_id: "sdk-sess-123",
		});
		expect(events).toEqual([
			{ type: "session_init", sessionId: "sdk-sess-123" },
		]);
	});

	it("handles full multi-turn sequence", () => {
		const t = new StreamTranslator();
		const all: ReturnType<typeof t.translate>[] = [];

		// System init
		all.push(
			t.translate({
				type: "system",
				subtype: "init",
				session_id: "s1",
			}),
		);
		// Message start
		all.push(
			t.translate({
				type: "stream_event",
				event: { type: "message_start" },
			}),
		);
		// Thinking
		all.push(
			t.translate({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: { type: "thinking_delta", thinking: "hmm" },
				},
			}),
		);
		// Text
		all.push(
			t.translate({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "Let me check" },
				},
			}),
		);
		// Tool start
		all.push(
			t.translate({
				type: "stream_event",
				event: {
					type: "content_block_start",
					content_block: { type: "tool_use", id: "tc1", name: "Read" },
				},
			}),
		);
		// Tool input delta
		all.push(
			t.translate({
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: {
						type: "input_json_delta",
						partial_json: '{"file":"a.ts"}',
					},
				},
			}),
		);
		// Assistant message (final)
		all.push(
			t.translate({
				type: "assistant",
				message: {
					content: [
						{ type: "thinking", thinking: "hmm" },
						{
							type: "tool_use",
							id: "tc1",
							name: "Read",
							input: { file: "a.ts" },
						},
					],
				},
			}),
		);
		// Tool result
		all.push(
			t.translate({
				type: "user",
				message: {
					role: "user",
					content: [
						{
							type: "tool_result",
							tool_use_id: "tc1",
							content: "file contents",
						},
					],
				},
			}),
		);
		// Result
		all.push(
			t.translate({
				type: "result",
				subtype: "success",
				num_turns: 1,
				total_cost_usd: 0.01,
			}),
		);

		const flat = all.flat();
		expect(flat).toEqual([
			{ type: "session_init", sessionId: "s1" },
			{ type: "message_start", role: "assistant" },
			{ type: "thinking_delta", text: "hmm" },
			{ type: "text_delta", text: "Let me check" },
			{ type: "tool_start", toolCallId: "tc1", toolName: "Read" },
			{
				type: "tool_input_delta",
				toolCallId: "tc1",
				text: '{"file":"a.ts"}',
			},
			{
				type: "tool_call",
				toolCallId: "tc1",
				toolName: "Read",
				input: { file: "a.ts" },
			},
			{ type: "tool_result", toolCallId: "tc1", result: "file contents" },
			{ type: "result" },
		]);
	});
});
