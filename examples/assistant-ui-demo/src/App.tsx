import type { AgentRuntimeExtras } from "@agent-conduit/react";
import { getPendingActions, useAgentRuntime } from "@agent-conduit/react";
import {
	AssistantRuntimeProvider,
	Thread,
	useThread,
} from "@assistant-ui/react";

function PendingActions() {
	const extras = useThread((s) => s.extras) as AgentRuntimeExtras | undefined;
	const { permissions, questions, respondToPermission, respondToQuestion } =
		getPendingActions(extras);

	if (permissions.length === 0 && questions.length === 0) return null;

	return (
		<div style={{ padding: "12px", border: "1px solid #e0e0e0", margin: 8 }}>
			{permissions.map((p) => (
				<div key={p.id} style={{ marginBottom: 8 }}>
					<p>
						Allow <strong>{p.toolName}</strong>?
					</p>
					<button
						type="button"
						onClick={() => respondToPermission(p.id, "allow")}
					>
						Allow
					</button>
					<button
						type="button"
						onClick={() => respondToPermission(p.id, "deny")}
						style={{ marginLeft: 4 }}
					>
						Deny
					</button>
				</div>
			))}
			{questions.map((q) => (
				<div key={q.id} style={{ marginBottom: 8 }}>
					<p>{q.question}</p>
					{q.options.map((opt) => (
						<button
							type="button"
							key={opt.label}
							onClick={() => respondToQuestion(q.id, opt.label)}
							style={{ marginRight: 4 }}
						>
							{opt.label}
						</button>
					))}
				</div>
			))}
		</div>
	);
}

export function App() {
	const runtime = useAgentRuntime({ baseUrl: "/api" });

	return (
		<AssistantRuntimeProvider runtime={runtime}>
			<div
				style={{
					height: "100vh",
					display: "flex",
					flexDirection: "column",
				}}
			>
				<PendingActions />
				<Thread />
			</div>
		</AssistantRuntimeProvider>
	);
}
