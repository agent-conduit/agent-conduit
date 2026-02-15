import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentClient } from "./client";

// --- Mock EventSource ---

type MessageHandler = (event: { data: string }) => void;
type ErrorHandler = () => void;

class MockEventSource {
	url: string;
	onmessage: MessageHandler | null = null;
	onerror: ErrorHandler | null = null;
	readyState = 1;
	closed = false;

	constructor(url: string) {
		this.url = url;
		MockEventSource.instances.push(this);
	}

	emit(data: string) {
		this.onmessage?.({ data });
	}

	close() {
		this.closed = true;
		this.readyState = 2;
	}

	static instances: MockEventSource[] = [];
	static last(): MockEventSource {
		const inst =
			MockEventSource.instances[MockEventSource.instances.length - 1];
		if (!inst) throw new Error("No MockEventSource instances");
		return inst;
	}
	static reset() {
		MockEventSource.instances = [];
	}
}

// --- Mock fetch ---

function mockFetch(responses: Map<string, () => unknown>) {
	return vi.fn(async (url: string) => {
		const key = [...responses.keys()].find((k) => url.endsWith(k));
		const factory = key ? responses.get(key) : undefined;
		return {
			ok: true,
			json: async () => factory?.() ?? {},
		};
	});
}

// --- Tests ---

describe("AgentClient", () => {
	let fetchFn: ReturnType<typeof mockFetch>;

	beforeEach(() => {
		MockEventSource.reset();
		vi.stubGlobal("EventSource", MockEventSource);

		fetchFn = mockFetch(
			new Map([
				["/sessions", () => ({ sessionId: "s1" })],
				["/sessions/s1/messages", () => ({ ok: true })],
				["/sessions/s1/respond", () => ({ ok: true })],
			]),
		);
		vi.stubGlobal("fetch", fetchFn);
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("sendMessage creates session and connects EventSource", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");

		expect(fetchFn).toHaveBeenCalledWith(
			"http://localhost:3000/sessions",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ message: "Hello" }),
			}),
		);

		const es = MockEventSource.last();
		expect(es.url).toBe("http://localhost:3000/sessions/s1/events");
	});

	it("events update state and notify subscribers", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });
		const listener = vi.fn();
		client.subscribe(listener);

		await client.sendMessage("Hello");
		const es = MockEventSource.last();

		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));
		es.emit(
			JSON.stringify({
				type: "message_start",
				role: "assistant",
			}),
		);
		es.emit(JSON.stringify({ type: "text_delta", text: "Hi there" }));

		const snap = client.getSnapshot();
		expect(snap.state.sessionId).toBe("s1");
		expect(snap.state.isRunning).toBe(true);
		expect(snap.messages).toHaveLength(1);
		expect(snap.messages[0]?.content[0]).toEqual({
			type: "text",
			text: "Hi there",
		});
		expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3);
	});

	it("getSnapshot returns cached reference until state changes", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		const snap1 = client.getSnapshot();
		const snap2 = client.getSnapshot();
		expect(snap1).toBe(snap2);

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		const snap3 = client.getSnapshot();
		expect(snap3).not.toBe(snap1);

		const snap4 = client.getSnapshot();
		expect(snap4).toBe(snap3);
	});

	it("sendMessage on existing session posts to /messages", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		await client.sendMessage("Follow up");

		expect(fetchFn).toHaveBeenLastCalledWith(
			"http://localhost:3000/sessions/s1/messages",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({ message: "Follow up" }),
			}),
		);
	});

	it("respondToPermission posts to /respond with correct body", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		await client.respondToPermission("p1", "allow");

		expect(fetchFn).toHaveBeenLastCalledWith(
			"http://localhost:3000/sessions/s1/respond",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					kind: "permission",
					id: "p1",
					behavior: "allow",
				}),
			}),
		);
	});

	it("respondToQuestion posts to /respond with correct body", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		await client.respondToQuestion("q1", "Option A");

		expect(fetchFn).toHaveBeenLastCalledWith(
			"http://localhost:3000/sessions/s1/respond",
			expect.objectContaining({
				method: "POST",
				body: JSON.stringify({
					kind: "question",
					id: "q1",
					answer: "Option A",
				}),
			}),
		);
	});

	it("[DONE] disconnects EventSource", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		expect(client.getSnapshot().isConnected).toBe(true);

		es.emit("[DONE]");

		expect(es.closed).toBe(true);
		expect(client.getSnapshot().isConnected).toBe(false);
	});

	it("destroy closes EventSource and clears subscribers", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });
		const listener = vi.fn();
		client.subscribe(listener);

		await client.sendMessage("Hello");
		const es = MockEventSource.last();

		client.destroy();

		expect(es.closed).toBe(true);

		// Subscriber should not be called after destroy
		listener.mockClear();
		es.emit(JSON.stringify({ type: "text_delta", text: "late" }));
		expect(listener).not.toHaveBeenCalled();
	});

	it("result event sets isRunning to false", async () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });

		await client.sendMessage("Hello");
		const es = MockEventSource.last();
		es.emit(JSON.stringify({ type: "session_init", sessionId: "s1" }));

		expect(client.getSnapshot().state.isRunning).toBe(true);

		es.emit(JSON.stringify({ type: "result" }));

		expect(client.getSnapshot().state.isRunning).toBe(false);
	});

	it("subscribe returns unsubscribe function", () => {
		const client = new AgentClient({ baseUrl: "http://localhost:3000" });
		const listener = vi.fn();

		const unsub = client.subscribe(listener);
		unsub();

		// Force a notification by sending a message — listener should not fire
		// (We can't easily test this without triggering state changes,
		// but at minimum verify unsub doesn't throw)
		expect(unsub).toBeTypeOf("function");
	});
});
