/**
 * Shared test kit for extension harness tests.
 *
 * Provides a minimal fake `ExtensionAPI` + `ExtensionContext` that covers the
 * surface area used by the zero-test extensions (ask-tools, auto-approver,
 * auto-session-title, message-bridge, preview, rules-engine).
 *
 * Each fake records interactions so tests can assert on registrations, event
 * handler invocations, and tool/command executions.
 */

import { vi } from "vitest";
import type {
	ExtensionAPI,
	ExtensionContext,
	Channel,
} from "../../src/core/extensions/types.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Event handler registry: event name → registered handlers. */
export type HandlerRegistry = Record<string, Array<(event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>>>;

/** A registered tool definition (minimal shape for testing). */
export interface RegisteredTool {
	name: string;
	label?: string;
	description?: string;
	parameters?: unknown;
	promptSnippet?: string;
	execute?: (id: string, params: any, signal: AbortSignal | undefined, onUpdate: unknown, ctx: ExtensionContext) => Promise<unknown>;
	renderCall?: (...args: unknown[]) => unknown;
	renderResult?: (...args: unknown[]) => unknown;
}

/** A registered command. */
export interface RegisteredCommand {
	name: string;
	description?: string;
	handler: (args: string, ctx: ExtensionContext) => Promise<void> | void;
}

/** A captured channel message. */
export interface ChannelMessage {
	type: string;
	payload: unknown;
}

export interface FakeChannel extends Channel {
	name: string;
	sent: ChannelMessage[];
	handlers: Map<string, Array<(payload: unknown) => void>>;
}

export interface FakeUI {
	askUserQuestion: ReturnType<typeof vi.fn>;
	notify: ReturnType<typeof vi.fn>;
	select: ReturnType<typeof vi.fn>;
	confirm: ReturnType<typeof vi.fn>;
	input: ReturnType<typeof vi.fn>;
	setStatus: ReturnType<typeof vi.fn>;
}

export interface ExtensionTestRuntime {
	/** Fake pi with all methods mocked. */
	pi: ExtensionAPI;
	/** Event handler registry (for emitting events in tests). */
	handlers: HandlerRegistry;
	/** Registered tools (by name). */
	tools: Map<string, RegisteredTool>;
	/** Registered commands (by name). */
	commands: Map<string, RegisteredCommand>;
	/** Registered channels (by name). */
	channels: Map<string, FakeChannel>;
	/** Registered permission providers. */
	permissionProviders: unknown[];
	/** Fake UI context. */
	ui: FakeUI;
	/** Mock callLLM. */
	callLLM: ReturnType<typeof vi.fn>;
	/** Mock appendEntry. */
	appendEntry: ReturnType<typeof vi.fn>;
	/** Mock setSessionName. */
	setSessionName: ReturnType<typeof vi.fn>;
	/** Mock getSessionName return value. */
	getSessionNameReturn: string | undefined;
	/** Mock sendUserMessage. */
	sendUserMessage: ReturnType<typeof vi.fn>;
	/** Extension name (updated by pi.setName). */
	extensionName: string;
}

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

export function createFakeChannel(name: string): FakeChannel {
	return {
		name,
		sent: [],
		handlers: new Map(),
		send(type: string, payload: unknown) {
			this.sent.push({ type, payload });
		},
		onReceive(type: string, handler: (payload: unknown) => void) {
			const list = this.handlers.get(type) ?? [];
			list.push(handler);
			this.handlers.set(type, list);
			return () => {
				const arr = this.handlers.get(type);
				if (!arr) return;
				const idx = arr.indexOf(handler);
				if (idx >= 0) arr.splice(idx, 1);
			};
		},
		invoke: vi.fn(async () => ({})),
		call: vi.fn(async () => ({})),
	} as unknown as FakeChannel;
}

export function createFakeUI(): FakeUI {
	return {
		askUserQuestion: vi.fn(async () => undefined),
		notify: vi.fn(),
		select: vi.fn(async () => undefined),
		confirm: vi.fn(async () => false),
		input: vi.fn(async () => undefined),
		setStatus: vi.fn(),
	};
}

/**
 * Create a fake pi object pre-populated with sensible defaults.
 * The `runtime` parameter is mutated in-place so that getters (e.g.
 * `extensionName`) always read the latest values from the same reference.
 */
export function createFakePi(runtime: ExtensionTestRuntime): ExtensionAPI {
	const pi = {
		on: vi.fn((event: string, handler: (event: unknown, ctx: ExtensionContext) => unknown | Promise<unknown>) => {
			runtime.handlers[event] ??= [];
			runtime.handlers[event]!.push(handler);
		}),
		registerTool: vi.fn((tool: RegisteredTool) => {
			runtime.tools.set(tool.name, tool);
		}),
		registerCommand: vi.fn((name: string, options: Omit<RegisteredCommand, "name">) => {
			runtime.commands.set(name, { name, ...options });
		}),
		registerChannel: vi.fn((name: string): FakeChannel => {
			const ch = createFakeChannel(name);
			runtime.channels.set(name, ch);
			return ch;
		}),
		registerShortcut: vi.fn(),
		registerFlag: vi.fn(),
		getFlag: vi.fn(() => undefined),
		registerMessageRenderer: vi.fn(),
		sendMessage: vi.fn(),
		sendUserMessage: runtime.sendUserMessage,
		appendEntry: runtime.appendEntry,
		deleteEntries: vi.fn(),
		summarizeEntries: vi.fn(),
		setSessionName: runtime.setSessionName,
		getSessionName: () => runtime.getSessionNameReturn,
		setLabel: vi.fn(),
		setName: vi.fn((name: string) => {
			runtime.extensionName = name;
		}),
		get extensionName() {
			return runtime.extensionName;
		},
		exec: vi.fn(async () => ({ stdout: "", stderr: "", exitCode: 0 })),
		getActiveTools: vi.fn(() => []),
		getAllTools: vi.fn(() => []),
		setActiveTools: vi.fn(),
		setToolOperationsProvider: vi.fn(),
		callLLM: runtime.callLLM,
		callLLMSafe: runtime.callLLM,
		permissions: {
			registerProvider: vi.fn((provider: unknown) => {
				runtime.permissionProviders.push(provider);
			}),
		},
	} as unknown as ExtensionAPI;
	return pi;
}

/**
 * Create a fake ExtensionContext for event emission and tool execution.
 */
export function createFakeContext(overrides: Partial<ExtensionContext> = {}): ExtensionContext {
	return {
		cwd: process.cwd(),
		projectRoot: process.cwd(),
		sessionDataDir: "",
		projectDataDir: "",
		cwdDataDir: "",
		globalDataDir: "",
		ui: createFakeUI(),
		sessionManager: {
			getEntries: vi.fn(() => []),
		} as unknown as ExtensionContext["sessionManager"],
		respondUI: vi.fn(() => () => {}),
		getSettings: () => ({}) as never,
		...overrides,
	} as ExtensionContext;
}

/**
 * Create a complete test runtime: fake pi + handler registry + capturing fakes.
 *
 * IMPORTANT: The runtime object is mutated in-place (NOT spread) so that the
 * `pi` object's getters (e.g. `extensionName`) and the returned `runtime`
 * share the same reference. This ensures `runtime.extensionName` reflects
 * updates from `pi.setName()`.
 */
export function createTestRuntime(): ExtensionTestRuntime {
	const runtime = {
		handlers: {},
		tools: new Map(),
		commands: new Map(),
		channels: new Map(),
		permissionProviders: [],
		ui: createFakeUI(),
		callLLM: vi.fn(async () => ""),
		appendEntry: vi.fn(),
		setSessionName: vi.fn(),
		getSessionNameReturn: undefined as string | undefined,
		sendUserMessage: vi.fn(),
		extensionName: "",
		pi: undefined as unknown as ExtensionAPI,
	} as ExtensionTestRuntime;
	runtime.pi = createFakePi(runtime);
	return runtime;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Emit an event to all registered handlers for that event type.
 * Awaits all handlers (they may be async).
 */
export async function emit(
	runtime: ExtensionTestRuntime,
	event: string,
	payload: unknown,
	ctx?: ExtensionContext,
): Promise<unknown[]> {
	const fakeCtx = ctx ?? createFakeContext();
	const list = runtime.handlers[event] ?? [];
	return Promise.all(list.map((h) => h(payload, fakeCtx)));
}

/**
 * Call a registered tool's execute function with the given params.
 */
export async function callTool(
	runtime: ExtensionTestRuntime,
	toolName: string,
	params: Record<string, unknown> = {},
	ctx?: ExtensionContext,
): Promise<unknown> {
	const tool = runtime.tools.get(toolName);
	if (!tool) throw new Error(`Tool "${toolName}" not registered`);
	if (!tool.execute) throw new Error(`Tool "${toolName}" has no execute function`);
	return tool.execute("test-call-id", params, undefined, undefined, ctx ?? createFakeContext());
}

/**
 * Call a registered command's handler with the given args string.
 */
export async function callCommand(
	runtime: ExtensionTestRuntime,
	commandName: string,
	args: string = "",
	ctx?: ExtensionContext,
): Promise<void> {
	const cmd = runtime.commands.get(commandName);
	if (!cmd) throw new Error(`Command "${commandName}" not registered`);
	await cmd.handler(args, ctx ?? createFakeContext());
}

/**
 * Reset all mock call counts. Useful between subtests that share a runtime.
 */
export function resetMocks(runtime: ExtensionTestRuntime): void {
	for (const fn of [
		runtime.callLLM,
		runtime.appendEntry,
		runtime.setSessionName,
		runtime.sendUserMessage,
		runtime.ui.askUserQuestion,
		runtime.ui.notify,
		runtime.ui.setStatus,
	]) {
		(fn as unknown as { mockClear?: () => void }).mockClear?.();
	}
}
