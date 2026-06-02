/**
 * Print mode (single-shot): Send prompts, output result, exit.
 *
 * Used for:
 * - `pi -p "prompt"` - text output
 * - `pi --mode json "prompt"` - JSON event stream
 */

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ImageContent } from "@earendil-works/pi-ai";
import type { TSchema } from "typebox";
import type { AgentSessionRuntime } from "../core/agent-session-runtime.ts";
import { flushRawStdout, writeRawStdout } from "../core/output-guard.ts";
import { killTrackedDetachedChildren } from "../utils/shell.ts";
import { validateStructuredOutput } from "../utils/structured-output.ts";

/**
 * Options for print mode.
 */
export interface PrintModeOptions {
	/** Output mode: "text" for final response only, "json" for all events */
	mode: "text" | "json";
	/** Array of additional prompts to send after initialMessage */
	messages?: string[];
	/** First message to send (may contain @file content) */
	initialMessage?: string;
	/** Images to attach to the initial message */
	initialImages?: ImageContent[];
	/** JSON schema for structured output validation */
	outputSchema?: TSchema;
}

const MAX_STRUCTURED_RETRIES = 3;

function getLastAssistantText(messages: AgentMessage[]): string {
	const lastMessage = messages[messages.length - 1];
	if (lastMessage?.role !== "assistant") return "";
	let text = "";
	for (const content of (lastMessage as AssistantMessage).content) {
		if (content.type === "text") {
			text += content.text;
		}
	}
	return text;
}

async function runStructuredOutput(
	session: {
		prompt: (text: string, options?: { images?: ImageContent[] }) => Promise<void>;
		state: { messages: AgentMessage[] };
	},
	schema: TSchema,
	initialMessage?: string,
	initialImages?: ImageContent[],
	messages?: string[],
): Promise<number> {
	const schemaPrompt = `\n\nYou must respond with valid JSON matching this schema:\n${JSON.stringify(schema)}\n\nRespond with JSON only, no markdown code blocks.`;
	await session.prompt(`${initialMessage ?? ""}${schemaPrompt}`, { images: initialImages });

	for (const message of messages ?? []) {
		await session.prompt(message);
	}

	for (let attempt = 0; attempt <= MAX_STRUCTURED_RETRIES; attempt++) {
		const raw = getLastAssistantText(session.state.messages);
		const result = validateStructuredOutput(raw, schema);
		if (result.success) {
			writeRawStdout(`${JSON.stringify(result.data)}\n`);
			return 0;
		}

		if (attempt < MAX_STRUCTURED_RETRIES) {
			await session.prompt(
				`Your previous response was invalid: ${result.error}. Please respond with valid JSON matching the schema.`,
			);
			continue;
		}

		console.error(
			`Structured output validation failed after ${MAX_STRUCTURED_RETRIES + 1} attempts: ${result.error}`,
		);
		return 1;
	}

	return 1;
}

/**
 * Run in print (single-shot) mode.
 * Sends prompts to the agent and outputs the result.
 */
export async function runPrintMode(runtimeHost: AgentSessionRuntime, options: PrintModeOptions): Promise<number> {
	const { mode, messages = [], initialMessage, initialImages, outputSchema } = options;
	let exitCode = 0;
	let session = runtimeHost.session;
	let unsubscribe: (() => void) | undefined;
	let disposed = false;
	const signalCleanupHandlers: Array<() => void> = [];

	const disposeRuntime = async (): Promise<void> => {
		if (disposed) return;
		disposed = true;
		unsubscribe?.();
		await runtimeHost.dispose();
	};

	const registerSignalHandlers = (): void => {
		const signals: NodeJS.Signals[] = ["SIGTERM"];
		if (process.platform !== "win32") {
			signals.push("SIGHUP");
		}

		for (const signal of signals) {
			const handler = () => {
				killTrackedDetachedChildren();
				void disposeRuntime().finally(() => {
					process.exit(signal === "SIGHUP" ? 129 : 143);
				});
			};
			process.on(signal, handler);
			signalCleanupHandlers.push(() => process.off(signal, handler));
		}
	};

	registerSignalHandlers();

	runtimeHost.setRebindSession(async () => {
		await rebindSession();
	});

	const rebindSession = async (): Promise<void> => {
		session = runtimeHost.session;
		await session.bindExtensions({
			mode: mode === "json" ? "json" : "print",
			commandContextActions: {
				waitForIdle: () => session.agent.waitForIdle(),
				newSession: async (newSessionOptions) => runtimeHost.newSession(newSessionOptions),
				fork: async (entryId, forkOptions) => {
					const result = await runtimeHost.fork(entryId, forkOptions);
					return { cancelled: result.cancelled };
				},
				navigateTree: async (targetId, navigateOptions) => {
					const result = await session.navigateTree(targetId, {
						summarize: navigateOptions?.summarize,
						customInstructions: navigateOptions?.customInstructions,
						replaceInstructions: navigateOptions?.replaceInstructions,
						label: navigateOptions?.label,
					});
					return { cancelled: result.cancelled };
				},
				switchSession: async (sessionPath, switchOptions) => {
					return runtimeHost.switchSession(sessionPath, switchOptions);
				},
				reload: async () => {
					await session.reload();
				},
			},
			onError: (err) => {
				console.error(`Extension error (${err.extensionPath}): ${err.error}`);
			},
		});

		unsubscribe?.();
		unsubscribe = session.subscribe((event) => {
			if (mode === "json") {
				writeRawStdout(`${JSON.stringify(event)}\n`);
			}
		});
	};

	try {
		if (mode === "json") {
			const header = session.sessionManager.getHeader();
			if (header) {
				writeRawStdout(`${JSON.stringify(header)}\n`);
			}
		}

		await rebindSession();

		if (outputSchema) {
			exitCode = await runStructuredOutput(session, outputSchema, initialMessage, initialImages, messages);
		} else {
			if (initialMessage) {
				await session.prompt(initialMessage, { images: initialImages });
			}

			for (const message of messages) {
				await session.prompt(message);
			}
		}

		if (mode === "text" && !outputSchema) {
			const state = session.state;
			const lastMessage = state.messages[state.messages.length - 1];

			if (lastMessage?.role === "assistant") {
				const assistantMsg = lastMessage as AssistantMessage;
				if (assistantMsg.stopReason === "error" || assistantMsg.stopReason === "aborted") {
					console.error(assistantMsg.errorMessage || `Request ${assistantMsg.stopReason}`);
					exitCode = 1;
				} else {
					for (const content of assistantMsg.content) {
						if (content.type === "text") {
							writeRawStdout(`${content.text}\n`);
						}
					}
				}
			}
		}

		return exitCode;
	} catch (error: unknown) {
		console.error(error instanceof Error ? error.message : String(error));
		return 1;
	} finally {
		for (const cleanup of signalCleanupHandlers) {
			cleanup();
		}
		await disposeRuntime();
		await flushRawStdout();
	}
}
