import type { McpServerConfig } from "@anthropic-ai/claude-agent-sdk";
import { query } from "@anthropic-ai/claude-agent-sdk";
import type { SessionConfig } from "./session";

export interface ClaudeAgentOptions {
	model?: string;
	systemPrompt?:
		| string
		| { type: "preset"; preset: "claude_code"; append?: string };
	maxTurns?: number;
	tools?: string[] | { type: "preset"; preset: "claude_code" };
	allowedTools?: string[];
	permissionMode?:
		| "default"
		| "acceptEdits"
		| "bypassPermissions"
		| "plan"
		| "dontAsk";
	allowDangerouslySkipPermissions?: boolean;
	mcpServers?: Record<string, McpServerConfig>;
	thinking?: { type: "enabled"; budgetTokens: number };
}

export function createClaudeConfig(
	options: ClaudeAgentOptions = {},
): SessionConfig {
	return {
		queryFn: ({ prompt, permissionHandler }) => {
			const abortController = new AbortController();
			const q = query({
				prompt,
				options: {
					...options,
					abortController,
					canUseTool: async (toolName, input, sdkOpts) =>
						permissionHandler(toolName, input, {
							toolUseId: sdkOpts.toolUseID,
							reason: sdkOpts.decisionReason,
						}),
					includePartialMessages: true,
				},
			});
			return {
				[Symbol.asyncIterator]: () => q[Symbol.asyncIterator](),
				interrupt: () => q.interrupt(),
				abort: () => abortController.abort(),
			};
		},
	};
}
