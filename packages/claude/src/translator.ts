import type { AgentEvent } from "@agent-conduit/core";

type SDKMessage = Record<string, unknown>;

export class StreamTranslator {
	private toolNames = new Map<string, string>();
	private hadStreamThinking = false;

	translate(message: SDKMessage): AgentEvent[] {
		const events: AgentEvent[] = [];
		const type = message.type as string;

		switch (type) {
			case "stream_event": {
				if (!("event" in message)) break;
				const event = message.event as Record<string, unknown>;
				this.translateStreamEvent(event, events);
				break;
			}

			case "assistant": {
				const msg = (
					message as {
						message?: { content?: Array<Record<string, unknown>> };
					}
				).message;
				if (msg?.content) {
					this.translateAssistantMessage(msg.content, events);
				}
				break;
			}

			case "user": {
				const msg = (
					message as {
						message?: { role: string; content: unknown };
					}
				).message;
				if (Array.isArray(msg?.content)) {
					this.translateUserMessage(msg.content, events);
				}
				break;
			}

			case "system": {
				if (
					message.subtype === "init" &&
					typeof message.session_id === "string"
				) {
					events.push({
						type: "session_init",
						sessionId: message.session_id,
					});
				}
				break;
			}

			case "result": {
				if (message.subtype === "success") {
					events.push({ type: "result" });
				} else {
					events.push({
						type: "error",
						message: (message.subtype as string) ?? "unknown_error",
					});
				}
				break;
			}
		}

		return events;
	}

	private translateStreamEvent(
		event: Record<string, unknown>,
		events: AgentEvent[],
	): void {
		switch (event.type) {
			case "message_start": {
				this.hadStreamThinking = false;
				events.push({ type: "message_start", role: "assistant" });
				break;
			}

			case "content_block_start": {
				const block = event.content_block as Record<string, unknown>;
				if (block?.type === "tool_use" || block?.type === "server_tool_use") {
					const id = block.id as string;
					const name = block.name as string;
					this.toolNames.set(id, name);
					events.push({
						type: "tool_start",
						toolCallId: id,
						toolName: name,
					});
				}
				break;
			}

			case "content_block_delta": {
				const delta = event.delta as Record<string, unknown>;
				if (delta.type === "text_delta" && typeof delta.text === "string") {
					events.push({ type: "text_delta", text: delta.text });
				} else if (
					delta.type === "thinking_delta" &&
					typeof delta.thinking === "string"
				) {
					this.hadStreamThinking = true;
					events.push({
						type: "thinking_delta",
						text: delta.thinking,
					});
				} else if (
					delta.type === "input_json_delta" &&
					typeof delta.partial_json === "string"
				) {
					const id = this.lastToolId();
					if (id) {
						events.push({
							type: "tool_input_delta",
							toolCallId: id,
							text: delta.partial_json,
						});
					}
				}
				break;
			}
		}
	}

	private translateAssistantMessage(
		content: Array<Record<string, unknown>>,
		events: AgentEvent[],
	): void {
		for (const block of content) {
			switch (block.type) {
				case "thinking": {
					if (!this.hadStreamThinking && typeof block.thinking === "string") {
						events.push({
							type: "thinking_delta",
							text: block.thinking,
						});
					}
					break;
				}
				case "tool_use":
				case "server_tool_use": {
					const id = block.id as string;
					const name = block.name as string;
					this.toolNames.set(id, name);
					events.push({
						type: "tool_call",
						toolCallId: id,
						toolName: name,
						input: (block.input as Record<string, unknown>) ?? {},
					});
					break;
				}
			}
		}
	}

	private translateUserMessage(
		content: Array<Record<string, unknown>>,
		events: AgentEvent[],
	): void {
		for (const block of content) {
			if (block.type === "tool_result") {
				const toolCallId = block.tool_use_id as string;
				const result = extractToolResultText(block);
				events.push({
					type: "tool_result",
					toolCallId,
					result,
				});
			}
		}
	}

	private lastToolId(): string | undefined {
		const entries = [...this.toolNames.entries()];
		return entries.length > 0 ? entries[entries.length - 1]?.[0] : undefined;
	}
}

function extractToolResultText(block: Record<string, unknown>): string {
	const content = block.content;
	if (typeof content === "string") return content;
	if (Array.isArray(content)) {
		const textParts = content
			.filter(
				(p: Record<string, unknown>) =>
					p.type === "text" && typeof p.text === "string",
			)
			.map((p: Record<string, unknown>) => p.text as string);
		if (textParts.length > 0) return textParts.join("");
		return JSON.stringify(content);
	}
	return "";
}
