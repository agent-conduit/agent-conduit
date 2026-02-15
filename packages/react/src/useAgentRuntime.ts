import type {
	AgentClientConfig,
	AgentClientSnapshot,
} from "@agent-conduit/core";
import { AgentClient } from "@agent-conduit/core";
import type { AssistantRuntime, ThreadMessageLike } from "@assistant-ui/react";
import { useExternalStoreRuntime } from "@assistant-ui/react";
import { useRef, useSyncExternalStore } from "react";

export type AgentRuntimeExtras = {
	client: AgentClient;
	snapshot: AgentClientSnapshot;
	respondToPermission: AgentClient["respondToPermission"];
	respondToQuestion: AgentClient["respondToQuestion"];
};

export function useAgentRuntime(config: AgentClientConfig): AssistantRuntime {
	const clientRef = useRef<AgentClient | null>(null);
	if (!clientRef.current) {
		clientRef.current = new AgentClient(config);
	}
	const client = clientRef.current;

	const snapshot = useSyncExternalStore(
		(cb) => client.subscribe(cb),
		() => client.getSnapshot(),
	);

	const runtime = useExternalStoreRuntime({
		isRunning: snapshot.state.isRunning,
		messages: snapshot.messages,
		convertMessage: (msg) => msg as unknown as ThreadMessageLike,
		onNew: async (message) => {
			const text = message.content
				.filter((p): p is { type: "text"; text: string } => p.type === "text")
				.map((p) => p.text)
				.join("");
			await client.sendMessage(text);
		},
		onCancel: async () => {
			client.destroy();
		},
		extras: {
			client,
			snapshot,
			respondToPermission: client.respondToPermission.bind(client),
			respondToQuestion: client.respondToQuestion.bind(client),
		} satisfies AgentRuntimeExtras,
	});

	return runtime;
}
