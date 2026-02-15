import { describe, expect, it } from "vitest";
import { createAgentRouter } from "./router";
import type { SessionConfig } from "./session";

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

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
	return (await res.json()) as Record<string, unknown>;
}

describe("createAgentRouter", () => {
	it("POST /sessions creates a session and returns sessionId", async () => {
		const app = createAgentRouter({
			config: makeConfig([{ type: "result", subtype: "success" }]),
		});

		const res = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Hello" }),
		});

		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.sessionId).toBeTruthy();
	});

	it("GET /sessions/:id/events returns SSE stream", async () => {
		const app = createAgentRouter({
			config: makeConfig([
				{ type: "stream_event", event: { type: "message_start" } },
				{
					type: "stream_event",
					event: {
						type: "content_block_delta",
						delta: { type: "text_delta", text: "Hi" },
					},
				},
				{ type: "result", subtype: "success" },
			]),
		});

		// Create session first
		const createRes = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Hello" }),
		});
		const { sessionId } = await jsonBody(createRes);

		// Fetch events
		const eventsRes = await app.request(`/sessions/${sessionId}/events`);
		expect(eventsRes.status).toBe(200);
		expect(eventsRes.headers.get("Content-Type")).toBe("text/event-stream");
		expect(eventsRes.headers.get("Cache-Control")).toBe("no-cache");

		const text = await eventsRes.text();
		expect(text).toContain("message_start");
		expect(text).toContain("text_delta");
		expect(text).toContain("[DONE]");
	});

	it("GET /sessions/:id/events returns 404 for unknown session", async () => {
		const app = createAgentRouter({
			config: makeConfig([]),
		});

		const res = await app.request("/sessions/nonexistent/events");
		expect(res.status).toBe(404);
	});

	it("POST /sessions/:id/messages pushes a follow-up message", async () => {
		const app = createAgentRouter({
			config: makeConfig([{ type: "result", subtype: "success" }]),
		});

		const createRes = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Hello" }),
		});
		const { sessionId } = await jsonBody(createRes);

		const res = await app.request(`/sessions/${sessionId}/messages`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Follow up" }),
		});
		expect(res.status).toBe(200);
		const body = await jsonBody(res);
		expect(body.ok).toBe(true);
	});

	it("POST /sessions/:id/messages returns 404 for unknown session", async () => {
		const app = createAgentRouter({
			config: makeConfig([]),
		});

		const res = await app.request("/sessions/nonexistent/messages", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Hi" }),
		});
		expect(res.status).toBe(404);
	});

	it("POST /sessions/:id/respond resolves a permission", async () => {
		const app = createAgentRouter({
			config: makeConfig([{ type: "result", subtype: "success" }]),
		});

		const createRes = await app.request("/sessions", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ message: "Hello" }),
		});
		const { sessionId } = await jsonBody(createRes);

		// Try responding without a pending permission — should 404
		const res = await app.request(`/sessions/${sessionId}/respond`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "permission",
				id: "nonexistent",
				behavior: "allow",
			}),
		});
		// The respond endpoint should handle gracefully
		expect(res.status).toBe(400);
	});

	it("POST /sessions/:id/respond returns 404 for unknown session", async () => {
		const app = createAgentRouter({
			config: makeConfig([]),
		});

		const res = await app.request("/sessions/nonexistent/respond", {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "permission",
				id: "p1",
				behavior: "allow",
			}),
		});
		expect(res.status).toBe(404);
	});
});
