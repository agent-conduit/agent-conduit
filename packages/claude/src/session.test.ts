import type { AgentEvent } from "@agent-conduit/core";
import { describe, expect, it } from "vitest";
import { type SessionConfig, SessionManager } from "./session";

async function collectEvents(
	iter: AsyncIterable<AgentEvent>,
): Promise<AgentEvent[]> {
	const events: AgentEvent[] = [];
	for await (const event of iter) {
		events.push(event);
	}
	return events;
}

function makeConfig(messages: Record<string, unknown>[]): SessionConfig {
	return {
		queryFn: () => {
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

describe("SessionManager", () => {
	it("creates a session and returns its id", () => {
		const manager = new SessionManager(makeConfig([]));
		const session = manager.create("Hello");
		expect(session.id).toBeTruthy();
		expect(manager.get(session.id)).toBe(session);
	});

	it("translates SDK messages to AgentEvents via events()", async () => {
		const sdkMessages: Record<string, unknown>[] = [
			{ type: "system", subtype: "init", session_id: "sdk-1" },
			{ type: "stream_event", event: { type: "message_start" } },
			{
				type: "stream_event",
				event: {
					type: "content_block_delta",
					delta: { type: "text_delta", text: "Hello" },
				},
			},
			{
				type: "assistant",
				message: { content: [] },
			},
			{ type: "result", subtype: "success", num_turns: 1 },
		];

		const manager = new SessionManager(makeConfig(sdkMessages));
		const session = manager.create("Hi");
		const events = await collectEvents(session.events());

		expect(events).toEqual([
			{ type: "session_init", sessionId: "sdk-1" },
			{ type: "message_start", role: "assistant" },
			{ type: "text_delta", text: "Hello" },
			{ type: "result" },
		]);
	});

	it("supports pushMessage for follow-up turns", async () => {
		let pushCount = 0;
		const config: SessionConfig = {
			queryFn: ({ prompt }) => {
				const gen = (async function* () {
					// First turn
					yield {
						type: "stream_event",
						event: { type: "message_start" },
					};
					yield {
						type: "stream_event",
						event: {
							type: "content_block_delta",
							delta: { type: "text_delta", text: "First" },
						},
					};

					// Wait for follow-up message via prompt
					for await (const _msg of prompt) {
						pushCount++;
						yield {
							type: "stream_event",
							event: { type: "message_start" },
						};
						yield {
							type: "stream_event",
							event: {
								type: "content_block_delta",
								delta: { type: "text_delta", text: "Second" },
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

		const manager = new SessionManager(config);
		const session = manager.create("Hello");

		// Start consuming events
		const eventsPromise = collectEvents(session.events());

		// Push follow-up message after a tick
		await new Promise((r) => setTimeout(r, 10));
		session.pushMessage("Follow up");

		const events = await eventsPromise;
		expect(pushCount).toBe(1);
		expect(
			events.some((e) => e.type === "text_delta" && e.text === "Second"),
		).toBe(true);
	});

	it("get returns undefined for unknown session", () => {
		const manager = new SessionManager(makeConfig([]));
		expect(manager.get("nonexistent")).toBeUndefined();
	});

	it("delete removes session", () => {
		const manager = new SessionManager(makeConfig([]));
		const session = manager.create("Hello");
		manager.delete(session.id);
		expect(manager.get(session.id)).toBeUndefined();
	});

	it("abort stops event iteration", async () => {
		const config: SessionConfig = {
			queryFn: () => {
				const gen = (async function* () {
					yield {
						type: "stream_event",
						event: { type: "message_start" },
					};
					// Simulate long-running — just wait
					await new Promise<void>((r) => setTimeout(r, 5000));
					yield { type: "result", subtype: "success" };
				})();
				return {
					[Symbol.asyncIterator]: () => gen[Symbol.asyncIterator](),
					interrupt: async () => {},
					abort: () => {},
				};
			},
		};

		const manager = new SessionManager(config);
		const session = manager.create("Hello");

		const events: AgentEvent[] = [];
		const consuming = (async () => {
			for await (const event of session.events()) {
				events.push(event);
			}
		})();

		// Let it start, then abort
		await new Promise((r) => setTimeout(r, 20));
		session.abort();
		await consuming;

		expect(events.length).toBeGreaterThanOrEqual(1);
		expect(events[0]).toEqual({
			type: "message_start",
			role: "assistant",
		});
	});
});
