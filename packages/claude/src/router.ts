import { encodeDone, encodeEvent } from "@agent-conduit/core";
import { Hono } from "hono";
import { type SessionConfig, SessionManager } from "./session";

export function createAgentRouter(opts: {
	config: SessionConfig;
	basePath?: string;
}): Hono {
	const { config, basePath = "" } = opts;
	const sessions = new SessionManager(config);
	const app = new Hono();

	app.post(`${basePath}/sessions`, async (c) => {
		const body = await c.req.json<{ message: string }>();
		const session = sessions.create(body.message ?? "");
		return c.json({ sessionId: session.id });
	});

	app.get(`${basePath}/sessions/:id/events`, (c) => {
		const session = sessions.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		const stream = new ReadableStream({
			async start(controller) {
				const encoder = new TextEncoder();
				try {
					for await (const event of session.events()) {
						controller.enqueue(encoder.encode(encodeEvent(event)));
					}
				} catch (err) {
					const message = err instanceof Error ? err.message : "Unknown error";
					controller.enqueue(
						encoder.encode(encodeEvent({ type: "error", message })),
					);
				} finally {
					controller.enqueue(encoder.encode(encodeDone()));
					controller.close();
				}
			},
		});

		return new Response(stream, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	});

	app.post(`${basePath}/sessions/:id/messages`, async (c) => {
		const session = sessions.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		const body = await c.req.json<{ message: string }>();
		session.pushMessage(body.message ?? "");
		return c.json({ ok: true });
	});

	app.post(`${basePath}/sessions/:id/respond`, async (c) => {
		const session = sessions.get(c.req.param("id"));
		if (!session) return c.json({ error: "Session not found" }, 404);

		const body = await c.req.json<{
			kind: "permission" | "question";
			id: string;
			behavior?: "allow" | "deny";
			updatedInput?: Record<string, unknown>;
			answer?: string;
		}>();

		try {
			if (body.kind === "permission") {
				session.permissionGate.resolve(
					body.id,
					body.behavior ?? "deny",
					body.updatedInput,
				);
			} else if (body.kind === "question") {
				session.permissionGate.answerQuestion(body.id, body.answer ?? "");
			} else {
				return c.json({ error: "Invalid kind" }, 400);
			}
			return c.json({ ok: true });
		} catch {
			return c.json({ error: "No pending request with this ID" }, 400);
		}
	});

	return app;
}
