# agent-conduit

A streaming adapter layer between AI agent SDKs and [assistant-ui](https://github.com/assistant-ui/assistant-ui). Normalizes agent event protocols into a single typed SSE stream with first-class support for human-in-the-loop approval flows.

Currently supports the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk). Designed to generalize to Codex, Gemini, and future agent SDKs.

## Why

Every major coding agent follows the same pattern: a CLI binary spawned via an SDK, emitting streaming events over stdin/stdout. The SDKs all produce text, tool calls, tool results, and reasoning — but with wildly different event shapes and approval semantics.

assistant-ui is the best open-source chat component library for React. But wiring an agent SDK to assistant-ui means building session management, SSE streaming, state reduction, message conversion, and permission resolution from scratch. agent-conduit does that wiring once so you don't have to.

```
Browser                                         Server
┌────────────────────────────────┐              ┌──────────────────────────────┐
│  @agent-conduit/react          │    SSE       │  @agent-conduit/claude       │
│  useAgentRuntime() hook        │◄─────────────│  Hono router + session mgmt  │
│  → assistant-ui Thread         │              │                              │
│  → permission / question UI    │─────────────►│  Claude Agent SDK            │
│                                │   HTTP POST  │  (query, tools, approval)    │
│  @agent-conduit/core           │              │                              │
│  AgentClient, state reducer    │              │  @agent-conduit/core         │
│  message conversion            │              │  protocol types, encoding    │
└────────────────────────────────┘              └──────────────────────────────┘
```

## Packages

| Package | Description |
|---------|-------------|
| `@agent-conduit/core` | Protocol types, SSE encoding, client-side state reducer, `AgentClient`, message conversion. Zero dependencies. |
| `@agent-conduit/claude` | Server-side Claude Agent SDK adapter. Hono router, session manager, stream translator, permission gate. |
| `@agent-conduit/react` | React hook (`useAgentRuntime`) bridging `AgentClient` to assistant-ui's `ExternalStoreRuntime`. |

## Quick start

### Server

```typescript
import { createAgentRouter, createClaudeConfig } from "@agent-conduit/claude";
import { serve } from "@hono/node-server";

const config = createClaudeConfig({
  model: "claude-sonnet-4-5-20250929",
  systemPrompt: "You are a helpful assistant.",
  tools: ["Read", "Glob", "Grep", "WebSearch", "WebFetch", "AskUserQuestion"],
  permissionMode: "default",
  maxTurns: 50,
  thinking: { type: "enabled", budgetTokens: 6000 },
});

const app = createAgentRouter({ config });

serve({ fetch: app.fetch, port: 3001 });
```

### Client

```tsx
import { useAgentRuntime, getPendingActions } from "@agent-conduit/react";
import type { AgentRuntimeExtras } from "@agent-conduit/react";
import { AssistantRuntimeProvider, useThread } from "@assistant-ui/react";
import { Thread } from "@assistant-ui/react";

function App() {
  const runtime = useAgentRuntime({ baseUrl: "/api" });

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <PendingActions />
      <Thread />
    </AssistantRuntimeProvider>
  );
}

function PendingActions() {
  const extras = useThread((s) => s.extras) as AgentRuntimeExtras | undefined;
  const { permissions, questions, respondToPermission, respondToQuestion } =
    getPendingActions(extras);

  if (permissions.length === 0 && questions.length === 0) return null;

  return (
    <div>
      {permissions.map((p) => (
        <div key={p.id}>
          Allow <strong>{p.toolName}</strong>?
          <button onClick={() => respondToPermission(p.id, "allow")}>Allow</button>
          <button onClick={() => respondToPermission(p.id, "deny")}>Deny</button>
        </div>
      ))}
      {questions.map((q) => (
        <div key={q.id}>
          <p>{q.question}</p>
          {q.options.map((opt) => (
            <button key={opt.label} onClick={() => respondToQuestion(q.id, opt.label)}>
              {opt.label}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
```

## SSE protocol

The wire format is Server-Sent Events. Each event is `data: ${JSON.stringify(event)}\n\n`, terminated by `data: [DONE]\n\n`.

```
POST   /sessions              → create session, start agent query
GET    /sessions/:id/events   → persistent SSE stream
POST   /sessions/:id/messages → send follow-up message
POST   /sessions/:id/respond  → resolve permission or answer question
```

### Event types

| Event | Purpose |
|-------|---------|
| `session_init` | Session created, returns `sessionId` |
| `message_start` | New assistant message (may include `parentToolUseId`) |
| `text_delta` | Streaming text chunk |
| `thinking_delta` | Streaming reasoning chunk |
| `tool_start` | Tool invocation begins |
| `tool_input_delta` | Streaming tool input JSON |
| `tool_call` | Complete tool call with parsed input |
| `tool_result` | Tool execution result |
| `permission_request` | Agent needs approval to use a tool |
| `permission_resolved` | User allowed or denied |
| `user_question` | Agent asks the user a structured question |
| `user_question_answered` | User responded to the question |
| `result` | Agent turn complete |
| `error` | Error occurred |

## Human-in-the-loop

The hardest thing to get right across agent SDKs is approval flows. agent-conduit treats them as first-class protocol events, not an afterthought.

**Permission requests** — When the Claude Agent SDK calls `canUseTool`, the adapter emits a `permission_request` event, stores a deferred Promise, and streams the event to the browser. The user clicks allow/deny, the client POSTs to `/respond`, and the server resolves the Promise so the SDK continues.

**User questions** — Claude's `AskUserQuestion` tool produces structured questions with selectable options. These flow as `user_question` events with the same deferred resolution pattern.

Both flows are exposed on the client via `getPendingActions()`, which returns the pending items and response handlers.

## `createClaudeConfig` options

```typescript
interface ClaudeAgentOptions {
  model?: string;
  systemPrompt?: string | { type: "preset"; preset: "claude_code"; append?: string };
  maxTurns?: number;
  tools?: string[] | { type: "preset"; preset: "claude_code" };
  allowedTools?: string[];
  permissionMode?: "default" | "acceptEdits" | "bypassPermissions" | "plan" | "dontAsk";
  mcpServers?: Record<string, McpServerConfig>;
  thinking?: { type: "enabled"; budgetTokens: number };
}
```

## Development

```bash
pnpm install
pnpm build
pnpm test        # 112 tests across core + claude packages
pnpm typecheck
```

### Run the example app

```bash
# Terminal 1 — agent server (requires Claude Agent SDK credentials)
npx tsx examples/assistant-ui-demo/server.ts

# Terminal 2 — Vite dev server
pnpm --filter assistant-ui-demo dev
```

Open `http://localhost:5173`. The Vite dev server proxies `/api/*` to the agent server on port 3001.

## Architecture

The state flows in one direction: SDK events are translated to `AgentEvent`s, streamed via SSE, reduced into `AgentState` on the client, then converted to assistant-ui's `ThreadMessageLike` format.

**Server side** — `createAgentRouter` creates a Hono app. Each session wraps a Claude SDK `query()` call. A `StreamTranslator` converts SDK messages to `AgentEvent`s. A `PermissionGate` bridges `canUseTool` callbacks to deferred Promises. A `PushChannel` (async iterable queue) handles both input (user messages) and output (event stream).

**Client side** — `AgentClient` manages an EventSource connection and HTTP POSTs. A pure `reduceEvent()` function accumulates events into `AgentState`. `convertMessages()` transforms state into UI-friendly message parts. `useAgentRuntime` wires this to assistant-ui's `useExternalStoreRuntime`.

## Vision

The `AgentEvent` protocol and `AgentClient` are provider-agnostic by design. The Claude adapter is the first implementation, but the same protocol can adapt any agent SDK that produces streaming text, tool calls, and approval requests.

Candidates for future adapters:
- **Codex SDK** (`@openai/codex-sdk`) — Thread-based API with JSON-RPC approval via `app-server` mode
- **Gemini CLI** — JSONL headless mode (`--output-format stream-json`), no programmatic approval yet

The ~80% of events overlap cleanly across SDKs (text, tool calls, tool results, reasoning). The ~20% that's hard — approval semantics, bidirectional RPC, structured questions — is exactly what this protocol is designed to normalize.

## License

MIT
