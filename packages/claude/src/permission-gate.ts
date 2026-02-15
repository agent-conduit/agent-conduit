import type { AgentEvent } from "@agent-conduit/core";

type PermissionResult =
	| { behavior: "allow"; updatedInput: Record<string, unknown> }
	| { behavior: "deny"; message: string };

type EmitFn = (event: AgentEvent) => void;

interface Deferred<T> {
	resolve: (value: T) => void;
	promise: Promise<T>;
}

function deferred<T>(): Deferred<T> {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((res) => {
		resolve = res;
	});
	return { resolve, promise };
}

let nextId = 0;
function generateId(prefix: string): string {
	return `${prefix}_${++nextId}`;
}

export class PermissionGate {
	private emit: EmitFn;
	private pendingPermissions = new Map<
		string,
		{ deferred: Deferred<PermissionResult>; input: Record<string, unknown> }
	>();
	private pendingQuestions = new Map<string, Deferred<string>>();

	constructor(emit: EmitFn) {
		this.emit = emit;
	}

	request(
		toolName: string,
		input: Record<string, unknown>,
		context?: { toolUseId?: string; reason?: string },
	): Promise<PermissionResult> {
		const id = generateId("perm");
		const d = deferred<PermissionResult>();
		this.pendingPermissions.set(id, { deferred: d, input });

		this.emit({
			type: "permission_request",
			id,
			toolName,
			input,
			...(context?.toolUseId !== undefined && {
				toolUseId: context.toolUseId,
			}),
			...(context?.reason !== undefined && { reason: context.reason }),
		});

		return d.promise;
	}

	resolve(
		id: string,
		behavior: "allow" | "deny",
		updatedInput?: Record<string, unknown>,
	): void {
		const pending = this.pendingPermissions.get(id);
		if (!pending) {
			throw new Error(`No pending permission with id: ${id}`);
		}

		this.pendingPermissions.delete(id);

		this.emit({
			type: "permission_resolved",
			id,
			behavior,
		});

		if (behavior === "allow") {
			pending.deferred.resolve({
				behavior: "allow",
				updatedInput: updatedInput ?? pending.input,
			});
		} else {
			pending.deferred.resolve({
				behavior: "deny",
				message: "User denied",
			});
		}
	}

	askQuestion(
		question: string,
		options: { label: string; description: string }[],
	): Promise<string> {
		const id = generateId("question");
		const d = deferred<string>();
		this.pendingQuestions.set(id, d);

		this.emit({
			type: "user_question",
			id,
			question,
			options,
		});

		return d.promise;
	}

	answerQuestion(id: string, answer: string): void {
		const pending = this.pendingQuestions.get(id);
		if (!pending) {
			throw new Error(`No pending question with id: ${id}`);
		}

		this.pendingQuestions.delete(id);

		this.emit({
			type: "user_question_answered",
			id,
			answer,
		});

		pending.resolve(answer);
	}
}
