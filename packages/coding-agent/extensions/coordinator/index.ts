import {
	ClientChannel,
	type ExtensionAPI,
	ServerChannel,
} from "@dyyz1993/pi-coding-agent";
import { Type } from "typebox";
import type { CoordinatorChannelContract } from "./types.js";
import { createCoordinatorHandler, TaskStore, type ProcessManagerApi } from "./handler.js";

const DelegateParams = Type.Object({
	task: Type.String({ description: "Task description to delegate to the background session" }),
	title: Type.Optional(Type.String({ description: "Short title for this delegated task" })),
});

const DelegateSendParams = Type.Object({
	targetSessionId: Type.String({ description: "Session ID to send the message to" }),
	message: Type.String({ description: "Message content to send" }),
});

const DelegateStatusParams = Type.Object({
	sessionId: Type.String({ description: "Session ID to check status for" }),
});

const DelegateStopParams = Type.Object({
	sessionId: Type.String({ description: "Session ID to stop" }),
});

const DelegateForkParams = Type.Object({
	sessionId: Type.String({ description: "Source session ID to fork from" }),
	task: Type.String({ description: "Task description for the forked session" }),
	title: Type.Optional(Type.String({ description: "Short title for the forked task" })),
});

export default function coordinatorExtension(pi: ExtensionAPI) {
	const rawChannel = pi.registerChannel("coordinator");

	const serverChannel = new ServerChannel<CoordinatorChannelContract>(rawChannel);
	const client = new ClientChannel<CoordinatorChannelContract>(rawChannel);

	let currentSessionId = "";
	let store: TaskStore | null = null;

	pi.on("session_start", (_event, ctx) => {
		currentSessionId = ctx.sessionManager.getSessionId();
		store = new TaskStore(ctx.sessionManager.getSessionDir());
	});

	const serverProxy: ProcessManagerApi = {
		async delegate(task, _projectPath) {
			return client.call("session_delegate", { task });
		},

		async delegate_send(fromSessionId, toSessionId, message) {
			return client.call("session_delegate_send", {
				targetSessionId: toSessionId,
				message,
			});
		},

		async delegate_status(sessionId) {
			try {
				const result = await client.call("session_delegate_status", { sessionId });
				return result.task ? { status: result.task.status } : { status: "stopped" as const };
			} catch {
				return { status: "stopped" as const };
			}
		},

		async delegate_list() {
			try {
				const result = await client.call("session_delegate_list", {}) as Record<string, unknown>;
				const sessions = (result.sessions ?? result.tasks ?? []) as Array<{ sessionId: string; status: import("./types.js").SessionStatus; projectPath: string }>;
				return sessions;
			} catch {
				return [];
			}
		},

		async delegate_stop(sessionId) {
			try {
				const result = await client.call("session_delegate_stop", { sessionId });
				return result.ok;
			} catch {
				return false;
			}
		},

		async delegate_fork(sessionId, task, title) {
			return client.call("session_delegate_fork", { sessionId, task, title });
		},

		async delegate_compact_status(sessionId: string) {
			try {
				const result = await client.call("session_delegate_status", { sessionId });
				return {
					isCompacting: result.isCompacting ?? false,
					contextUsage: result.contextUsage ?? { tokens: null as number | null, contextWindow: 0, percent: null as number | null },
				};
			} catch {
				return { isCompacting: false, contextUsage: { tokens: null as number | null, contextWindow: 0, percent: null as number | null } };
			}
		},
	};

	createCoordinatorHandler(
		serverChannel,
		serverProxy,
		() => currentSessionId,
		() => store ?? new TaskStore("/tmp/coordinator-fallback"),
	);

	pi.on("context", (event, _ctx) => {
		if (!store) return;
		const prompt = store.buildPrompt();
		if (prompt) {
			event.messages.push({
				role: "system",
				content: [{ type: "text", text: prompt }],
			});
		}
	});

	pi.registerTool({
		name: "session_delegate",
		label: "Session Delegate",
		description: [
			"Delegate a task to a background pi session.",
			"Returns a sessionId for communication via session_delegate_send.",
			"The delegated session can message back using its own coordinator channel.",
		].join(" "),
		parameters: DelegateParams,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const sid = currentSessionId || ctx.sessionManager.getSessionId();
			const result = await serverProxy.delegate(params.task, ctx.cwd);

			if (store) {
				store.add({
					sessionId: result.sessionId,
					title: params.title || params.task.slice(0, 60),
					task: params.task,
					projectPath: ctx.cwd,
					dispatchedAt: Date.now(),
					status: "idle",
				});
			}

			return {
				output: `Delegated task to session ${result.sessionId} (status: ${result.status}). Use session_delegate_send to communicate.`,
				result: { ...result, dispatchedBy: sid },
			};
		},
	});

	pi.registerTool({
		name: "session_delegate_send",
		label: "Session Delegate Send",
		description: [
			"Send a message to a delegated session by sessionId.",
			"If the target session is stopped, the server will attempt to restart it.",
			"The message is injected as a followUp into the target session.",
		].join(" "),
		parameters: DelegateSendParams,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const sid = currentSessionId || ctx.sessionManager.getSessionId();
			const result = await serverProxy.delegate_send(sid, params.targetSessionId, params.message);

			if (!result.delivered) {
				return { output: `Could not deliver message to ${params.targetSessionId}: session not found`, error: true };
			}

			return {
				output: `Message delivered to ${params.targetSessionId} (status: ${result.targetStatus})`,
				result,
			};
		},
	});

	pi.registerTool({
		name: "session_delegate_status",
		label: "Session Delegate Status",
		description: "Check the status of a delegated task session.",
		parameters: DelegateStatusParams,
		async execute(toolCallId, params) {
			const task = store?.get(params.sessionId);
			if (task) {
				const status = task.status === "completed" ? "DONE" : task.status.toUpperCase();
				return { output: `Task "${task.title}" (${params.sessionId}): ${status}`, result: { task } };
			}
			const remote = await serverProxy.delegate_status(params.sessionId);
			return { output: `Session ${params.sessionId} status: ${remote.status}`, result: { task: null } };
		},
	});

	pi.registerTool({
		name: "session_delegate_stop",
		label: "Session Delegate Stop",
		description: "Stop a delegated task session.",
		parameters: DelegateStopParams,
		async execute(toolCallId, params) {
			const ok = await serverProxy.delegate_stop(params.sessionId);
			if (ok && store) {
				store.update(params.sessionId, { status: "stopped" });
			}
			return {
				output: ok ? `Session ${params.sessionId} stopped.` : `Session ${params.sessionId} not found or already stopped.`,
				result: { ok },
			};
		},
	});

	pi.registerTool({
		name: "session_delegate_fork",
		label: "Session Delegate Fork",
		description: [
			"Fork an existing session and delegate a new task to the forked session.",
			"The forked session starts with a copy of the source session's conversation history.",
			"The original session continues running unchanged.",
		].join(" "),
		parameters: DelegateForkParams,
		async execute(toolCallId, params, _signal, _onUpdate, ctx) {
			const sid = currentSessionId || ctx.sessionManager.getSessionId();
			const result = await serverProxy.delegate_fork(params.sessionId, params.task, params.title);
			if (store) {
				store.add({
					sessionId: result.sessionId,
					title: params.title || params.task.slice(0, 60),
					task: params.task,
					projectPath: ctx.cwd,
					dispatchedAt: Date.now(),
					status: "idle",
				});
			}
			return {
				output: `Forked session ${params.sessionId} → ${result.sessionId} (status: ${result.status}). Task: ${params.task}`,
				result: { ...result, forkedFrom: params.sessionId, dispatchedBy: sid },
			};
		},
	});

	client.on("message_received", (data) => {
		pi.sendUserMessage(
			`[Coordinator] Message from session ${data.fromSessionId}:\n${data.message}`,
			{ deliverAs: "followUp" },
		);
	});
}
