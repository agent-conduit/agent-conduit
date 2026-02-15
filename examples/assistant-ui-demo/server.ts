import { createAgentRouter, createClaudeConfig } from "@agent-conduit/claude";
import { serve } from "@hono/node-server";

const config = createClaudeConfig({
	model: "claude-sonnet-4-5-20250929",
	systemPrompt:
		"You are a helpful assistant. You can perform glob, grep searches, read files and perform web searches and web fetches of specific websites.",
	mcpServers: {},
	tools: [
		// "Bash",
		// "Edit",
		"Glob",
		"Grep",
		// "NotebookEdit",
		"Read",
		// "TodoWrite",
		// "Write",
		"WebSearch",
		"WebFetch",
		"AskUserQuestion",
	],
	allowedTools: [
		// "mcp__weather__*",
		// "mcp__dice__*",
	],
	permissionMode: "default",
	maxTurns: 50,
	thinking: { type: "enabled", budgetTokens: 6000 },
});

const app = createAgentRouter({ config });

serve({ fetch: app.fetch, port: 3001 }, (info) => {
	console.log(`Agent server running on http://localhost:${info.port}`);
});
