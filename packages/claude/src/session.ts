import type { AgentEvent } from "@agent-conduit/core";
import { PermissionGate } from "./permission-gate";
import { PushChannel } from "./push-channel";
import { StreamTranslator } from "./translator";

type SDKUserMessage = {
	type: "user";
	message: { role: "user"; content: string };
	parent_tool_use_id: null;
	session_id: string;
};

interface QueryInstance {
	[Symbol.asyncIterator](): AsyncIterator<Record<string, unknown>>;
	interrupt(): Promise<void>;
	abort(): void;
}

export interface SessionConfig {
	queryFn: (opts: { prompt: AsyncIterable<SDKUserMessage> }) => QueryInstance;
}

export interface Session {
	id: string;
	permissionGate: PermissionGate;
	events(): AsyncIterable<AgentEvent>;
	pushMessage(text: string): void;
	abort(): void;
}

function userMessage(content: string): SDKUserMessage {
	return {
		type: "user",
		message: { role: "user", content },
		parent_tool_use_id: null,
		session_id: "",
	};
}

export class SessionManager {
	private sessions = new Map<string, Session>();
	private config: SessionConfig;

	constructor(config: SessionConfig) {
		this.config = config;
	}

	create(initialPrompt: string): Session {
		const id = crypto.randomUUID();
		const inputChannel = new PushChannel<SDKUserMessage>();
		const outputChannel = new PushChannel<AgentEvent>();
		const translator = new StreamTranslator();
		const permissionGate = new PermissionGate((event) =>
			outputChannel.push(event),
		);
		let aborted = false;

		const queryInstance = this.config.queryFn({
			prompt: inputChannel,
		});

		// Drive SDK messages → translated events on output channel
		const drive = async () => {
			try {
				for await (const message of queryInstance) {
					if (aborted) break;
					const events = translator.translate(
						message as Record<string, unknown>,
					);
					for (const event of events) {
						outputChannel.push(event);
					}
				}
			} finally {
				outputChannel.close();
			}
		};

		// Start the initial prompt
		inputChannel.push(userMessage(initialPrompt));

		// Start driving in the background
		drive();

		const session: Session = {
			id,
			permissionGate,
			events() {
				return outputChannel;
			},
			pushMessage(text: string) {
				inputChannel.push(userMessage(text));
			},
			abort() {
				aborted = true;
				inputChannel.close();
				outputChannel.close();
			},
		};

		this.sessions.set(id, session);
		return session;
	}

	get(id: string): Session | undefined {
		return this.sessions.get(id);
	}

	delete(id: string): void {
		const session = this.sessions.get(id);
		if (session) {
			session.abort();
			this.sessions.delete(id);
		}
	}
}
