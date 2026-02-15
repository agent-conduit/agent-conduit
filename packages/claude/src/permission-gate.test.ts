import type { AgentEvent } from "@agent-conduit/core";
import { describe, expect, it } from "vitest";
import { PermissionGate } from "./permission-gate";

describe("PermissionGate", () => {
	function setup() {
		const events: AgentEvent[] = [];
		const gate = new PermissionGate((event) => events.push(event));
		return { gate, events };
	}

	describe("permissions", () => {
		it("emits permission_request and returns a promise", () => {
			const { gate, events } = setup();
			const promise = gate.request("Bash", { command: "ls" });
			expect(promise).toBeInstanceOf(Promise);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				type: "permission_request",
				toolName: "Bash",
				input: { command: "ls" },
			});
		});

		it("resolve with allow returns { behavior: 'allow', updatedInput }", async () => {
			const { gate, events } = setup();
			const promise = gate.request("Bash", { command: "ls" });
			const id = (events[0] as { id: string }).id;

			gate.resolve(id, "allow");

			const result = await promise;
			expect(result).toEqual({
				behavior: "allow",
				updatedInput: { command: "ls" },
			});
		});

		it("resolve with deny returns { behavior: 'deny', message }", async () => {
			const { gate, events } = setup();
			const promise = gate.request("Bash", { command: "rm -rf /" });
			const id = (events[0] as { id: string }).id;

			gate.resolve(id, "deny");

			const result = await promise;
			expect(result).toEqual({
				behavior: "deny",
				message: "User denied",
			});
		});

		it("resolve with allow and modified input returns updated input", async () => {
			const { gate, events } = setup();
			const promise = gate.request("Bash", { command: "ls" });
			const id = (events[0] as { id: string }).id;

			gate.resolve(id, "allow", { command: "ls -la" });

			const result = await promise;
			expect(result).toEqual({
				behavior: "allow",
				updatedInput: { command: "ls -la" },
			});
		});

		it("emits permission_resolved after resolve", () => {
			const { gate, events } = setup();
			gate.request("Bash", { command: "ls" });
			const id = (events[0] as { id: string }).id;

			gate.resolve(id, "allow");

			expect(events).toHaveLength(2);
			expect(events[1]).toEqual({
				type: "permission_resolved",
				id,
				behavior: "allow",
			});
		});

		it("throws when resolving unknown id", () => {
			const { gate } = setup();
			expect(() => gate.resolve("unknown", "allow")).toThrow();
		});

		it("handles multiple concurrent requests independently", async () => {
			const { gate, events } = setup();
			const p1 = gate.request("Bash", { command: "ls" });
			const p2 = gate.request("Read", { file_path: "/tmp/x" });

			const id1 = (events[0] as { id: string }).id;
			const id2 = (events[1] as { id: string }).id;

			gate.resolve(id2, "deny");
			gate.resolve(id1, "allow");

			const [r1, r2] = await Promise.all([p1, p2]);
			expect(r1).toEqual({
				behavior: "allow",
				updatedInput: { command: "ls" },
			});
			expect(r2).toEqual({ behavior: "deny", message: "User denied" });
		});

		it("generates unique ids for each request", () => {
			const { gate, events } = setup();
			gate.request("Bash", { command: "a" });
			gate.request("Bash", { command: "b" });
			const id1 = (events[0] as { id: string }).id;
			const id2 = (events[1] as { id: string }).id;
			expect(id1).not.toBe(id2);
		});

		it("forwards context fields to emitted event", () => {
			const { gate, events } = setup();
			gate.request(
				"Bash",
				{ command: "rm -rf /" },
				{
					toolUseId: "tc-42",
					reason: "file outside allowed directories",
				},
			);
			expect(events[0]).toMatchObject({
				type: "permission_request",
				toolName: "Bash",
				toolUseId: "tc-42",
				reason: "file outside allowed directories",
			});
		});

		it("omits context fields when not provided", () => {
			const { gate, events } = setup();
			gate.request("Bash", { command: "ls" });
			const event = events[0] as Record<string, unknown>;
			expect(event).not.toHaveProperty("toolUseId");
			expect(event).not.toHaveProperty("reason");
		});
	});

	describe("questions", () => {
		it("emits user_question and returns a promise", () => {
			const { gate, events } = setup();
			const promise = gate.askQuestion("Which approach?", [
				{ label: "A", description: "First" },
				{ label: "B", description: "Second" },
			]);
			expect(promise).toBeInstanceOf(Promise);
			expect(events).toHaveLength(1);
			expect(events[0]).toMatchObject({
				type: "user_question",
				question: "Which approach?",
				options: [
					{ label: "A", description: "First" },
					{ label: "B", description: "Second" },
				],
			});
		});

		it("answerQuestion resolves the promise with the answer", async () => {
			const { gate, events } = setup();
			const promise = gate.askQuestion("Which?", [
				{ label: "A", description: "First" },
				{ label: "B", description: "Second" },
			]);
			const id = (events[0] as { id: string }).id;

			gate.answerQuestion(id, "A");

			const result = await promise;
			expect(result).toBe("A");
		});

		it("emits user_question_answered after answering", () => {
			const { gate, events } = setup();
			gate.askQuestion("Which?", [{ label: "A", description: "First" }]);
			const id = (events[0] as { id: string }).id;

			gate.answerQuestion(id, "A");

			expect(events).toHaveLength(2);
			expect(events[1]).toEqual({
				type: "user_question_answered",
				id,
				answer: "A",
			});
		});

		it("throws when answering unknown question id", () => {
			const { gate } = setup();
			expect(() => gate.answerQuestion("unknown", "A")).toThrow();
		});
	});
});
