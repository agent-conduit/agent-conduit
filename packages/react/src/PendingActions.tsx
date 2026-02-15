import type { PendingPermission, PendingQuestion } from "@agent-conduit/core";
import type { AgentRuntimeExtras } from "./useAgentRuntime";

export type PendingActionsData = {
	permissions: PendingPermission[];
	questions: PendingQuestion[];
	respondToPermission: AgentRuntimeExtras["respondToPermission"];
	respondToQuestion: AgentRuntimeExtras["respondToQuestion"];
};

export function getPendingActions(
	extras: AgentRuntimeExtras | undefined,
): PendingActionsData {
	const state = extras?.snapshot.state;
	return {
		permissions: state ? [...state.pendingPermissions.values()] : [],
		questions: state ? [...state.pendingQuestions.values()] : [],
		respondToPermission: extras?.respondToPermission ?? (async () => {}),
		respondToQuestion: extras?.respondToQuestion ?? (async () => {}),
	};
}
