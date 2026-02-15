import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClaudeConfig } from "./config";

// Mock the SDK's query function
vi.mock("@anthropic-ai/claude-agent-sdk", () => ({
	query: vi.fn(),
}));

import { query } from "@anthropic-ai/claude-agent-sdk";

const mockQuery = vi.mocked(query);

beforeEach(() => {
	mockQuery.mockClear();
});

// Real SDK message shapes — captured from actual SDK v0.2.42
const realMessages = [
	{
		type: "system",
		subtype: "init",
		cwd: "/tmp",
		session_id: "c6685102-6e55-4c96-9802-6bf2f009355e",
		tools: ["AskUserQuestion", "mcp__dice__roll"],
		model: "claude-sonnet-4-5-20250929",
		permissionMode: "default",
	},
	{
		type: "stream_event",
		event: {
			type: "message_start",
			message: {
				model: "claude-sonnet-4-5-20250929",
				id: "msg_01DkMtbUBeLsGZ2M9WsS82gs",
				type: "message",
				role: "assistant",
				content: [],
				stop_reason: null,
			},
		},
		session_id: "c6685102-6e55-4c96-9802-6bf2f009355e",
		parent_tool_use_id: null,
	},
	{
		type: "stream_event",
		event: {
			type: "content_block_delta",
			index: 0,
			delta: { type: "text_delta", text: "Hello" },
		},
		session_id: "c6685102-6e55-4c96-9802-6bf2f009355e",
		parent_tool_use_id: null,
	},
	{
		type: "result",
		subtype: "success",
		is_error: false,
		num_turns: 1,
		result: "Hello",
		session_id: "c6685102-6e55-4c96-9802-6bf2f009355e",
	},
];

function makeFakeQuery(messages = realMessages) {
	const interruptFn = vi.fn().mockResolvedValue(undefined);

	// Build a proper AsyncGenerator-like object that the SDK returns
	const makeInstance = () => {
		const gen = (async function* () {
			for (const msg of messages) yield msg;
		})();

		return Object.assign(gen, {
			interrupt: interruptFn,
			setPermissionMode: vi.fn(),
			setModel: vi.fn(),
			setMaxThinkingTokens: vi.fn(),
			supportedCommands: vi.fn(),
			supportedModels: vi.fn(),
			mcpServerStatus: vi.fn(),
			accountInfo: vi.fn(),
			rewindFiles: vi.fn(),
			setMcpServers: vi.fn(),
			streamInput: vi.fn(),
		}) as ReturnType<typeof query>;
	};

	return { makeInstance, interruptFn };
}

describe("createClaudeConfig", () => {
	it("returns a SessionConfig with queryFn", () => {
		const config = createClaudeConfig();
		expect(config.queryFn).toBeTypeOf("function");
	});

	it("passes prompt and options through to SDK query", () => {
		const { makeInstance } = makeFakeQuery();
		mockQuery.mockReturnValue(makeInstance());

		const config = createClaudeConfig({
			model: "claude-sonnet-4-5-20250929",
			maxTurns: 3,
			permissionMode: "default",
		});

		const prompt = (async function* () {})();
		const permissionHandler = vi.fn();
		config.queryFn({ prompt, permissionHandler });

		expect(mockQuery).toHaveBeenCalledOnce();
		const call = mockQuery.mock.calls[0]?.[0];
		expect(call?.prompt).toBe(prompt);
		expect(call?.options).toMatchObject({
			model: "claude-sonnet-4-5-20250929",
			maxTurns: 3,
			permissionMode: "default",
			includePartialMessages: true,
		});
		expect(call?.options?.canUseTool).toBeTypeOf("function");
		expect(call?.options?.abortController).toBeInstanceOf(AbortController);
	});

	it("maps SDK canUseTool (toolUseID, decisionReason) to permissionHandler (toolUseId, reason)", async () => {
		const { makeInstance } = makeFakeQuery();
		mockQuery.mockReturnValue(makeInstance());

		const permissionHandler = vi.fn().mockResolvedValue({
			behavior: "allow",
			updatedInput: { command: "ls" },
		});

		const config = createClaudeConfig();
		config.queryFn({
			prompt: (async function* () {})(),
			permissionHandler,
		});

		const canUseTool = mockQuery.mock.calls[0]?.[0]?.options?.canUseTool;
		expect(canUseTool).toBeDefined();

		// Call with SDK-shaped args (real field names from runtimeTypes.d.ts)
		const result = await canUseTool?.(
			"Bash",
			{ command: "ls" },
			{
				signal: new AbortController().signal,
				toolUseID: "toolu_01PQjhRfyZ9GSnNJxs8LeADY",
				decisionReason: "needs approval",
			},
		);

		expect(permissionHandler).toHaveBeenCalledWith(
			"Bash",
			{ command: "ls" },
			{
				toolUseId: "toolu_01PQjhRfyZ9GSnNJxs8LeADY",
				reason: "needs approval",
			},
		);
		expect(result).toEqual({
			behavior: "allow",
			updatedInput: { command: "ls" },
		});
	});

	it("abort() triggers the abortController passed to SDK", () => {
		const { makeInstance } = makeFakeQuery();
		mockQuery.mockReturnValue(makeInstance());

		const config = createClaudeConfig();
		const queryInstance = config.queryFn({
			prompt: (async function* () {})(),
			permissionHandler: vi.fn(),
		});

		const ac = mockQuery.mock.calls[0]?.[0]?.options
			?.abortController as AbortController;
		expect(ac.signal.aborted).toBe(false);

		queryInstance.abort();
		expect(ac.signal.aborted).toBe(true);
	});

	it("interrupt() delegates to SDK query.interrupt()", async () => {
		const { makeInstance, interruptFn } = makeFakeQuery();
		mockQuery.mockReturnValue(makeInstance());

		const config = createClaudeConfig();
		const queryInstance = config.queryFn({
			prompt: (async function* () {})(),
			permissionHandler: vi.fn(),
		});

		await queryInstance.interrupt();
		expect(interruptFn).toHaveBeenCalledOnce();
	});

	it("async iteration yields real SDK message shapes", async () => {
		const { makeInstance } = makeFakeQuery();
		mockQuery.mockReturnValue(makeInstance());

		const config = createClaudeConfig();
		const queryInstance = config.queryFn({
			prompt: (async function* () {})(),
			permissionHandler: vi.fn(),
		});

		const messages: Record<string, unknown>[] = [];
		for await (const msg of queryInstance) {
			messages.push(msg as Record<string, unknown>);
		}

		expect(messages).toHaveLength(4);
		expect(messages[0]).toMatchObject({
			type: "system",
			subtype: "init",
			session_id: "c6685102-6e55-4c96-9802-6bf2f009355e",
		});
		expect(messages[3]).toMatchObject({
			type: "result",
			subtype: "success",
		});
	});
});
