/**
 * Declarative test DSL for pi coding-agent.
 *
 * Wraps the suite harness with a fluent, declarative API:
 *
 *   const t = await createTestHarness({
 *     extensions: [myExtension],
 *     systemPrompt: "You are a test agent",
 *   });
 *
 *   await t.run(
 *     when("List files", [
 *       calls("bash", { command: "ls" }),
 *       says("Found files: a.txt, b.txt"),
 *     ]),
 *   );
 *
 *   expect(t.events.toolCalls).toHaveLength(1);
 *   expect(t.events.lastMessage).toContain("Found files");
 */

import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage, AgentTool } from "@dyyz1993/pi-agent-core";
import { Agent } from "@dyyz1993/pi-agent-core";
import type { FauxResponseStep, Model } from "@dyyz1993/pi-ai";
import { fauxAssistantMessage, fauxText, fauxThinking, fauxToolCall, registerFauxProvider } from "@dyyz1993/pi-ai";
import { AgentSession, type AgentSessionEvent } from "../src/core/agent-session.ts";
import { AuthStorage } from "../src/core/auth-storage.ts";
import type { ExtensionRunner } from "../src/core/extensions/index.ts";
import { convertToLlm } from "../src/core/messages.ts";
import { ModelRegistry } from "../src/core/model-registry.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import type { Settings } from "../src/core/settings-manager.ts";
import { SettingsManager } from "../src/core/settings-manager.ts";
import type { ExtensionFactory, ResourceLoader } from "../src/index.ts";
import {
	type CreateTestExtensionsResultInput,
	createTestExtensionsResult,
	createTestResourceLoader,
} from "./utilities.ts";

// ─── Step Builders ────────────────────────────────────────────

export type Step =
	| { kind: "calls"; name: string; args: Record<string, unknown> }
	| { kind: "says"; text: string }
	| { kind: "thinks"; text: string }
	| { kind: "errors"; message: string };

export function calls(name: string, args: Record<string, unknown> = {}): Step {
	return { kind: "calls", name, args };
}

export function says(text: string): Step {
	return { kind: "says", text };
}

export function thinks(text: string): Step {
	return { kind: "thinks", text };
}

export function errors(message: string): Step {
	return { kind: "errors", message };
}

export interface TurnSpec {
	prompt: string;
	steps: Step[];
}

export function when(prompt: string, steps: Step[]): TurnSpec {
	return { prompt, steps };
}

// ─── Convert Steps to Faux Responses ─────────────────────────

function stepsToResponses(steps: Step[]): FauxResponseStep[] {
	return steps.map((step): FauxResponseStep => {
		switch (step.kind) {
			case "calls":
				return fauxAssistantMessage(fauxToolCall(step.name, step.args), { stopReason: "toolUse" });
			case "says":
				return fauxAssistantMessage(fauxText(step.text), { stopReason: "stop" });
			case "thinks":
				return fauxAssistantMessage([fauxThinking(step.text), fauxText(step.text)], {
					stopReason: "stop",
				});
			case "errors":
				return fauxAssistantMessage(fauxText(""), { errorMessage: step.message, stopReason: "error" });
			default:
				return fauxAssistantMessage(fauxText(""), { stopReason: "stop" });
		}
	});
}

// ─── Event Extractors ────────────────────────────────────────

export interface ToolCallRecord {
	name: string;
	args: Record<string, unknown>;
	result: unknown;
	isError: boolean;
	durationMs: number;
}

export interface MessageRecord {
	role: string;
	text: string;
}

function extractToolCalls(events: AgentSessionEvent[]): ToolCallRecord[] {
	return events
		.filter((e): e is Extract<AgentSessionEvent, { type: "tool_execution_end" }> => e.type === "tool_execution_end")
		.map((e) => ({
			name: e.toolName,
			args: (e as { args?: Record<string, unknown> }).args ?? {},
			result: e.result,
			isError: e.isError,
			durationMs: e.durationMs,
		}));
}

function extractMessages(messages: AgentMessage[]): MessageRecord[] {
	return messages.map((m) => ({
		role: m.role,
		text: getMessageText(m),
	}));
}

function getMessageText(message: unknown): string {
	if (!message || typeof message !== "object" || !("content" in message)) {
		return "";
	}
	const content = (message as { content?: string | Array<{ type: string; text?: string }> }).content;
	if (content === undefined) {
		return "";
	}
	if (typeof content === "string") {
		return content;
	}
	return content
		.filter((part): part is { type: "text"; text: string } => part.type === "text")
		.map((part) => part.text)
		.join("\n");
}

// ─── File Helper ──────────────────────────────────────────────

export class FileHelper {
	private dir: string;

	constructor(dir: string) {
		this.dir = dir;
	}

	write(path: string, content: string): void {
		const full = join(this.dir, path);
		const parent = full.substring(0, full.lastIndexOf("/"));
		if (parent && !existsSync(parent)) mkdirSync(parent, { recursive: true });
		writeFileSync(full, content);
	}

	read(path: string): string {
		return readFileSync(join(this.dir, path), "utf-8");
	}

	exists(path: string): boolean {
		return existsSync(join(this.dir, path));
	}

	delete(path: string): void {
		unlinkSync(join(this.dir, path));
	}

	get dirPath(): string {
		return this.dir;
	}
}

// ─── Test Events ──────────────────────────────────────────────

export interface TestEvents {
	toolCalls: ToolCallRecord[];
	messages: MessageRecord[];
	assistantTexts: string[];
	lastMessage: string;
	raw: AgentSessionEvent[];
}

// ─── Test Harness ─────────────────────────────────────────────

export interface TestHarnessOptions {
	extensions?: Array<ExtensionFactory | CreateTestExtensionsResultInput>;
	cwd?: string;
	systemPrompt?: string;
	tools?: AgentTool[];
	settings?: Partial<Settings>;
	initialActiveToolNames?: string[];
	allowedToolNames?: string[];
	excludedToolNames?: string[];
	resourceLoader?: ResourceLoader;
	withConfiguredAuth?: boolean;
}

export interface TestHarness {
	run(spec: TurnSpec): Promise<TestHarness>;
	events: TestEvents;
	files: FileHelper;
	session: AgentSession;
	sessionManager: SessionManager;
	settingsManager: SettingsManager;
	cleanup(): void;
}

function createTempDir(): string {
	const dir = join(tmpdir(), `pi-dsl-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	return dir;
}

export async function createTestHarness(options: TestHarnessOptions = {}): Promise<TestHarness> {
	const cwd = options.cwd ?? createTempDir();
	const ownTempDir = options.cwd === undefined;
	const fauxProvider = registerFauxProvider({});
	fauxProvider.setResponses([]);
	const model = fauxProvider.getModel();

	const toolMap = options.tools ? Object.fromEntries(options.tools.map((t) => [t.name, t])) : undefined;
	const withConfiguredAuth = options.withConfiguredAuth ?? true;

	const sessionManager = SessionManager.inMemory();
	const settingsManager = SettingsManager.inMemory(options.settings);

	const authStorage = AuthStorage.inMemory();
	if (withConfiguredAuth) {
		authStorage.setRuntimeApiKey(model.provider, "faux-key");
	}
	const modelRegistry = ModelRegistry.inMemory(authStorage);
	if (withConfiguredAuth) {
		modelRegistry.registerProvider(model.provider, {
			baseUrl: model.baseUrl,
			apiKey: "faux-key",
			api: fauxProvider.api,
			models: fauxProvider.models.map((m) => ({
				id: m.id,
				name: m.name,
				api: m.api,
				reasoning: m.reasoning,
				input: m.input,
				cost: m.cost,
				contextWindow: m.contextWindow,
				maxTokens: m.maxTokens,
				baseUrl: m.baseUrl,
			})),
		});
	}

	const extensionRunnerRef: { current?: ExtensionRunner } = {};

	const agent = new Agent({
		getApiKey: () => (withConfiguredAuth ? "faux-key" : undefined),
		initialState: {
			model,
			systemPrompt: options.systemPrompt ?? "You are a test assistant.",
			tools: [],
		},
		convertToLlm,
		onPayload: async (payload) => {
			const runner = extensionRunnerRef.current;
			if (!runner?.hasHandlers("before_provider_request")) return payload;
			return runner.emitBeforeProviderRequest(payload);
		},
		onResponse: async (response) => {
			const runner = extensionRunnerRef.current;
			if (!runner?.hasHandlers("after_provider_response")) return;
			await runner.emit({ type: "after_provider_response", status: response.status, headers: response.headers });
		},
		transformContext: async (messages: AgentMessage[]) => {
			const runner = extensionRunnerRef.current;
			if (!runner) return messages;
			return runner.emitContext(messages);
		},
	});

	const extensionsResult = options.extensions ? await createTestExtensionsResult(options.extensions, cwd) : undefined;

	const resourceLoader =
		options.resourceLoader ?? createTestResourceLoader(extensionsResult ? { extensionsResult } : undefined);

	const session = new AgentSession({
		agent,
		sessionManager,
		settingsManager,
		cwd,
		modelRegistry,
		resourceLoader,
		baseToolsOverride: toolMap,
		initialActiveToolNames: options.initialActiveToolNames,
		allowedToolNames: options.allowedToolNames,
		excludedToolNames: options.excludedToolNames,
		extensionRunnerRef,
	});

	const rawEvents: AgentSessionEvent[] = [];
	session.subscribe((e) => rawEvents.push(e));

	function refreshEvents(): TestEvents {
		const toolCalls = extractToolCalls(rawEvents);
		const messages = extractMessages(session.messages);
		const assistantTexts = messages.filter((m) => m.role === "assistant").map((m) => m.text);
		return {
			toolCalls,
			messages,
			assistantTexts,
			lastMessage: assistantTexts.at(-1) ?? "",
			raw: rawEvents,
		};
	}

	const files = new FileHelper(cwd);

	return {
		session,
		sessionManager,
		settingsManager,
		get events() {
			return refreshEvents();
		},
		files,
		async run(spec: TurnSpec): Promise<TestHarness> {
			const responses = stepsToResponses(spec.steps);
			fauxProvider.setResponses(responses);
			await session.prompt(spec.prompt);
			return this;
		},
		cleanup() {
			session.dispose();
			fauxProvider.unregister();
			if (ownTempDir && existsSync(cwd)) {
				rmSync(cwd, { recursive: true });
			}
		},
	};
}
