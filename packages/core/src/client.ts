import type { ConvertedMessage } from "./convert";
import { convertMessages } from "./convert";
import type { AgentEvent } from "./protocol";
import type { AgentState } from "./state";
import { initialState, reduceEvent } from "./state";

export interface AgentClientConfig {
	baseUrl: string;
}

export interface AgentClientSnapshot {
	state: AgentState;
	messages: ConvertedMessage[];
	sessionId: string | null;
	isConnected: boolean;
}

export class AgentClient {
	private config: AgentClientConfig;
	private agentState: AgentState = initialState();
	private sessionId: string | null = null;
	private eventSource: EventSource | null = null;
	private subscribers = new Set<() => void>();
	private cachedSnapshot: AgentClientSnapshot | null = null;

	constructor(config: AgentClientConfig) {
		this.config = config;
	}

	getSnapshot(): AgentClientSnapshot {
		if (!this.cachedSnapshot) {
			this.cachedSnapshot = {
				state: this.agentState,
				messages: convertMessages(this.agentState),
				sessionId: this.sessionId,
				isConnected: this.eventSource !== null,
			};
		}
		return this.cachedSnapshot;
	}

	subscribe(listener: () => void): () => void {
		this.subscribers.add(listener);
		return () => {
			this.subscribers.delete(listener);
		};
	}

	async sendMessage(text: string): Promise<void> {
		if (!this.sessionId) {
			const res = await fetch(`${this.config.baseUrl}/sessions`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ message: text }),
			});
			const body = (await res.json()) as { sessionId: string };
			this.sessionId = body.sessionId;
			this.agentState = initialState();
			this.connectEventSource();
		} else {
			await fetch(
				`${this.config.baseUrl}/sessions/${this.sessionId}/messages`,
				{
					method: "POST",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify({ message: text }),
				},
			);
		}
	}

	async respondToPermission(
		id: string,
		behavior: "allow" | "deny",
		updatedInput?: Record<string, unknown>,
	): Promise<void> {
		if (!this.sessionId) return;
		await fetch(`${this.config.baseUrl}/sessions/${this.sessionId}/respond`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				kind: "permission",
				id,
				behavior,
				...(updatedInput && { updatedInput }),
			}),
		});
	}

	async respondToQuestion(id: string, answer: string): Promise<void> {
		if (!this.sessionId) return;
		await fetch(`${this.config.baseUrl}/sessions/${this.sessionId}/respond`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ kind: "question", id, answer }),
		});
	}

	destroy(): void {
		this.disconnect();
		this.subscribers.clear();
	}

	private connectEventSource(): void {
		const es = new EventSource(
			`${this.config.baseUrl}/sessions/${this.sessionId}/events`,
		);
		this.eventSource = es;

		es.onmessage = (event: MessageEvent) => {
			if (event.data === "[DONE]") {
				this.disconnect();
				return;
			}
			const agentEvent = JSON.parse(event.data as string) as AgentEvent;
			this.agentState = reduceEvent(this.agentState, agentEvent);
			this.notify();
		};

		es.onerror = () => {
			this.disconnect();
		};

		this.notify();
	}

	private disconnect(): void {
		if (this.eventSource) {
			this.eventSource.onmessage = null;
			this.eventSource.onerror = null;
			this.eventSource.close();
			this.eventSource = null;
			this.notify();
		}
	}

	private notify(): void {
		this.cachedSnapshot = null;
		for (const listener of this.subscribers) {
			listener();
		}
	}
}
