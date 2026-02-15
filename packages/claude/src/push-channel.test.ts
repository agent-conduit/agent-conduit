import { describe, expect, it } from "vitest";
import { PushChannel } from "./push-channel";

describe("PushChannel", () => {
	it("yields a pushed message via async iteration", async () => {
		const channel = new PushChannel<string>();
		channel.push("hello");
		channel.close();

		const results: string[] = [];
		for await (const msg of channel) {
			results.push(msg);
		}
		expect(results).toEqual(["hello"]);
	});

	it("yields multiple pushes in order", async () => {
		const channel = new PushChannel<string>();
		channel.push("a");
		channel.push("b");
		channel.push("c");
		channel.close();

		const results: string[] = [];
		for await (const msg of channel) {
			results.push(msg);
		}
		expect(results).toEqual(["a", "b", "c"]);
	});

	it("iterator waits for push (no busy-loop)", async () => {
		const channel = new PushChannel<string>();
		const results: string[] = [];

		const consumer = (async () => {
			for await (const msg of channel) {
				results.push(msg);
			}
		})();

		// Push after a tick — consumer should be waiting
		await new Promise((r) => setTimeout(r, 10));
		expect(results).toEqual([]);

		channel.push("delayed");
		await new Promise((r) => setTimeout(r, 10));
		expect(results).toEqual(["delayed"]);

		channel.close();
		await consumer;
	});

	it("close ends the iterator", async () => {
		const channel = new PushChannel<string>();

		const consumer = (async () => {
			const results: string[] = [];
			for await (const msg of channel) {
				results.push(msg);
			}
			return results;
		})();

		channel.push("one");
		channel.close();

		const results = await consumer;
		expect(results).toEqual(["one"]);
	});

	it("push after close is ignored", async () => {
		const channel = new PushChannel<string>();
		channel.push("before");
		channel.close();
		channel.push("after");

		const results: string[] = [];
		for await (const msg of channel) {
			results.push(msg);
		}
		expect(results).toEqual(["before"]);
	});

	it("works with non-string types", async () => {
		const channel = new PushChannel<{ text: string }>();
		channel.push({ text: "hello" });
		channel.close();

		const results: { text: string }[] = [];
		for await (const msg of channel) {
			results.push(msg);
		}
		expect(results).toEqual([{ text: "hello" }]);
	});
});
