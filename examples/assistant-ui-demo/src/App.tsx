import type { AgentRuntimeExtras } from "@agent-conduit/react";
import { getPendingActions, useAgentRuntime } from "@agent-conduit/react";
import { AssistantRuntimeProvider, useThread } from "@assistant-ui/react";
import { Thread } from "@/components/assistant-ui/thread";
import { Button } from "@/components/ui/button";
import { TooltipProvider } from "@/components/ui/tooltip";

function PendingActions() {
	const extras = useThread((s) => s.extras) as AgentRuntimeExtras | undefined;
	const { permissions, questions, respondToPermission, respondToQuestion } =
		getPendingActions(extras);

	if (permissions.length === 0 && questions.length === 0) return null;

	return (
		<div className="mx-auto w-full max-w-2xl border-b bg-muted/50 p-3">
			{permissions.map((p) => (
				<div key={p.id} className="flex items-center gap-2 py-1">
					<span className="text-sm">
						Allow <strong>{p.toolName}</strong>?
					</span>
					<Button
						size="sm"
						variant="default"
						onClick={() => respondToPermission(p.id, "allow")}
					>
						Allow
					</Button>
					<Button
						size="sm"
						variant="outline"
						onClick={() => respondToPermission(p.id, "deny")}
					>
						Deny
					</Button>
				</div>
			))}
			{questions.map((q) => (
				<div key={q.id} className="py-1">
					<p className="mb-1 text-sm">{q.question}</p>
					<div className="flex gap-2">
						{q.options.map((opt) => (
							<Button
								size="sm"
								variant="outline"
								key={opt.label}
								onClick={() => respondToQuestion(q.id, opt.label)}
							>
								{opt.label}
							</Button>
						))}
					</div>
				</div>
			))}
		</div>
	);
}

export function App() {
	const runtime = useAgentRuntime({ baseUrl: "/api" });

	return (
		<TooltipProvider>
			<AssistantRuntimeProvider runtime={runtime}>
				<div className="flex h-dvh flex-col">
					<PendingActions />
					<Thread />
				</div>
			</AssistantRuntimeProvider>
		</TooltipProvider>
	);
}
