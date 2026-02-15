import {
	type AgentState,
	type ConvertedMessage,
	convertMessages,
	decodeEvent,
	initialState,
	reduceEvent,
} from "@agent-conduit/core";
import { describe, expect, it } from "vitest";
import { createAgentRouter } from "./router";
import type { SessionConfig } from "./session";

// --- Helpers ---

function makeConfig(messages: Record<string, unknown>[]): SessionConfig {
	return {
		queryFn: (_opts) => {
			const gen = (async function* () {
				for (const msg of messages) {
					yield msg;
				}
			})();
			return {
				[Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
				interrupt: async () => {},
				abort: () => {},
			};
		},
	};
}

function parseSSE(text: string): AgentState {
	const lines = text.split("\n\n").filter((l) => l.trim().length > 0);
	let state = initialState();
	for (const line of lines) {
		const event = decodeEvent(line);
		if (event) {
			state = reduceEvent(state, event);
		}
	}
	return state;
}

async function createSession(
	app: ReturnType<typeof createAgentRouter>,
	message: string,
): Promise<string> {
	const res = await app.request("/sessions", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ message }),
	});
	const body = (await res.json()) as { sessionId: string };
	return body.sessionId;
}

async function fetchEvents(
	app: ReturnType<typeof createAgentRouter>,
	sessionId: string,
): Promise<{ state: AgentState; messages: ConvertedMessage[] }> {
	const res = await app.request(`/sessions/${sessionId}/events`);
	const text = await res.text();
	const state = parseSSE(text);
	return { state, messages: convertMessages(state) };
}

// --- Integration Tests ---

describe("integration: full protocol pipeline", () => {
	it("text streaming produces correct converted messages", async () => {
		const app = createAgentRouter({
			config: makeConfig([
				{ type: "system", subtype: "init", session_id: "int-1" },
				{ type: "stream_event", event: { type: "message_start" } },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hello " },
					},
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "world!" },
					},
				},
				{ type: "assistant", message: { content: [] } },
				{ type: "result", subtype: "success" },
			]),
		});

		const sessionId = await createSession(app, "Hi");
		const { state, messages } = await fetchEvents(app, sessionId);

		expect(state.sessionId).toBe("int-1");
		expect(state.isRunning).toBe(false);
		expect(messages).toHaveLength(1);
		expect(messages[0]?.role).toBe("assistant");
		expect(messages[0]?.content).toEqual([
			{ type: "text", text: "Hello world!" },
		]);
		expect(messages[0]?.status).toEqual({ type: "complete" });
	});

	it("tool call lifecycle produces tool-call and tool-result parts", async () => {
		const app = createAgentRouter({
			config: makeConfig([
				{ type: "system", subtype: "init", session_id: "int-2" },
				{ type: "stream_event", event: { type: "message_start" } },
				{
					type: "stream_event",
					event: {
						type: "content_block_start",
						content_block: {
							type: "tool_use",
							id: "tc-1",
							name: "Read",
						},
					},
				},
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: {
							type: "input_json_delta",
							partial_json: '{"file_path":"/tmp/test.ts"}',
						},
					},
				},
				{
					type: "assistant",
					message: {
						content: [
							{
								type: "tool_use",
								id: "tc-1",
								name: "Read",
								input: { file_path: "/tmp/test.ts" },
							},
						],
					},
				},
				{
					type: "user",
					message: {
						role: "user",
						content: [
							{
								type: "tool_result",
								tool_use_id: "tc-1",
								content: "const x = 42;",
							},
						],
					},
				},
				{ type: "stream_event", event: { type: "message_start" } },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "The file contains x = 42" },
					},
				},
				{ type: "assistant", message: { content: [] } },
				{ type: "result", subtype: "success" },
			]),
		});

		const sessionId = await createSession(app, "Read the file");
		const { messages } = await fetchEvents(app, sessionId);

		// First message: tool call
		expect(messages).toHaveLength(2);
		const toolMsg = messages[0];
		expect(toolMsg?.content).toEqual([
			{
				type: "tool-call",
				toolCallId: "tc-1",
				toolName: "Read",
				args: { file_path: "/tmp/test.ts" },
				argsText: JSON.stringify({ file_path: "/tmp/test.ts" }),
				result: "const x = 42;",
			},
		]);

		// Second message: text response
		const textMsg = messages[1];
		expect(textMsg?.content).toEqual([
			{ type: "text", text: "The file contains x = 42" },
		]);
	});

	it("multi-turn messaging produces events from both turns", async () => {
		let turnCount = 0;
		const config: SessionConfig = {
			queryFn: ({ prompt, permissionHandler: _ph }) => {
				const gen = (async function* () {
					yield { type: "system", subtype: "init", session_id: "int-3" };
					yield {
						type: "stream_event",
						event: { type: "message_start" },
					};
					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							delta: { type: "text_delta", text: "First response" },
						},
					};

					// Wait for follow-up
					for await (const _msg of prompt) {
						turnCount++;
						yield {
							type: "stream_event",
							event: { type: "message_start" },
						};
						yield {
							type: "stream_event",
							event: {
								type: "content_block_delta",
								delta: { type: "text_delta", text: "Second response" },
							},
						};
						yield { type: "result", subtype: "success" };
						break;
					}
				})();
				return {
					[Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
					interrupt: async () => {},
					abort: () => {},
				};
			},
		};

		const app = createAgentRouter({ config });
		const sessionId = await createSession(app, "Hello");

		// Start consuming events in the background
		const eventsPromise = app.request(`/sessions/${sessionId}/events`);

		// Wait for first turn, then send follow-up
		await new Promise((r) => setTimeout(r, 20));
		await app.request(`/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Follow up" }),
		});

		const res = await eventsPromise;
		const text = await res.text();
		const state = parseSSE(text);
		const messages = convertMessages(state);

		expect(turnCount).toBe(1);
		expect(messages).toHaveLength(2);
		expect(messages[0]?.content).toEqual([
			{ type: "text", text: "First response" },
		]);
		expect(messages[1]?.content).toEqual([
			{ type: "text", text: "Second response" },
		]);
	});

	it("permission round-trip: SSE pauses, POST respond unblocks, stream continues", async () => {
		const config: SessionConfig = {
			queryFn: ({ permissionHandler }) => {
				const gen = (async function* () {
					yield { type: "system", subtype: "init", session_id: "int-perm" };
					yield {
						type: "stream_event",
						event: { type: "message_start" },
					};
					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							delta: { type: "text_delta", text: "Checking..." },
						},
					};

					// Block until permission resolved
					const result = await permissionHandler(
						"Bash",
						{ command: "rm -rf /" },
						{ toolUseId: "tc-perm", reason: "dangerous" },
					);

					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							delta: {
								type: "text_delta",
								text: result.behavior === "allow" ? " Allowed." : " Denied.",
							},
						},
					};
					yield { type: "result", subtype: "success" };
				})();
				return {
					[Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
					interrupt: async () => {},
					abort: () => {},
				};
			},
		};

		const app = createAgentRouter({ config });
		const sessionId = await createSession(app, "Do something dangerous");

		// Read the SSE stream incrementally to extract the permission ID
		const res = await app.request(`/sessions/${sessionId}/events`);
		const reader = res.body?.getReader();
		expect(reader).toBeDefined();

		const decoder = new TextDecoder();
		let accumulated = "";
		let permId = "";

		// Read chunks until we see a permission_request event
		while (reader) {
			const { value, done } = await reader.read();
			if (done) break;
			accumulated += decoder.decode(value, { stream: true });
			const match = accumulated.match(
				/"type":"permission_request"[^}]*"id":"([^"]+)"/,
			);
			if (match?.[1]) {
				permId = match[1];
				break;
			}
		}

		expect(permId).toBeTruthy();

		// POST respond to allow the permission
		const respondRes = await app.request(`/sessions/${sessionId}/respond`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "permission",
				id: permId,
				behavior: "allow",
			}),
		});
		expect(respondRes.status).toBe(200);

		// Read the rest of the stream
		while (reader) {
			const { value, done } = await reader.read();
			if (done) break;
			accumulated += decoder.decode(value, { stream: true });
		}

		const state = parseSSE(accumulated);

		expect(state.isRunning).toBe(false);
		expect(accumulated).toContain("Checking...");
		expect(accumulated).toContain("Allowed.");
		expect(accumulated).toContain("permission_request");
		expect(accumulated).toContain("permission_resolved");
	});

	it("session lifecycle: stream ends with [DONE] and result sets isRunning false", async () => {
		const app = createAgentRouter({
			config: makeConfig([
				{ type: "system", subtype: "init", session_id: "int-4" },
				{ type: "stream_event", event: { type: "message_start" } },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Done" },
					},
				},
				{ type: "result", subtype: "success" },
			]),
		});

		const sessionId = await createSession(app, "Hello");
		const res = await app.request(`/sessions/${sessionId}/events`);
		const text = await res.text();

		// Verify [DONE] marker is present in raw SSE
		expect(text).toContain("[DONE]");

		// Verify state
		const state = parseSSE(text);
		expect(state.isRunning).toBe(false);
	});
});
