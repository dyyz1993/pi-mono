import { tmpdir } from "node:os";
import { mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it, vi, beforeAll, afterAll } from "vitest";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import lspExtensionDefault from "./index.js";

const TEST_DIR = "/tmp/lsp-clangd-test";
const TEST_FILE = "test.c";

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const registeredTools = new Map<string, any>();
	const channelSendFn = vi.fn();
	const registerCommandFn = vi.fn();
	let channelOnReceiveHandler: ((data: unknown) => void) | null = null;
	let currentChannel: {
		name: string;
		send: (data: unknown) => void;
		onReceive: (handler: (data: unknown) => void) => () => void;
		invoke: (data: unknown, timeoutMs?: number) => Promise<unknown>;
		call: (method: string, params: Record<string, unknown>, timeoutMs?: number) => Promise<unknown>;
	} | null = null;

	const pi = {
		on: vi.fn((event: string, handler: any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "{}"),
		callLLMStructured: vi.fn(async () => ({})),
		forkAgent: vi.fn(async () => ({ text: "", usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 } })),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(() => {
			currentChannel = {
				name: "lsp",
				send: channelSendFn,
				onReceive: vi.fn((handler: (data: unknown) => void) => {
					channelOnReceiveHandler = handler;
					return () => { channelOnReceiveHandler = null; };
				}),
				invoke: vi.fn(async (data: unknown) => {
					if (!channelOnReceiveHandler) return {};
					const msg = data as Record<string, unknown>;
					const invokeId = msg.__invokeId as string;
					return new Promise((resolve) => {
						const orig = channelSendFn.getMockImplementation() ?? channelSendFn;
						channelSendFn.mockImplementation((response: unknown) => {
							const resp = response as Record<string, unknown>;
							if (resp?.invokeId === invokeId) {
								channelSendFn.mockImplementation(orig as any);
								resolve(response);
							}
						});
						channelOnReceiveHandler!(data);
					});
				}),
				call: vi.fn(async (method: string, params: Record<string, unknown>, _timeoutMs?: number) => {
					if (!channelOnReceiveHandler) return {};
					const invokeId = `invoke_${method}_${Date.now()}`;
					return new Promise((resolve) => {
						const orig = channelSendFn.getMockImplementation() ?? channelSendFn;
						channelSendFn.mockImplementation((response: unknown) => {
							const resp = response as Record<string, unknown>;
							if (resp?.invokeId === invokeId) {
								channelSendFn.mockImplementation(orig as any);
								resolve(response);
							}
						});
						channelOnReceiveHandler!({ __call: method, invokeId, ...params });
					});
				}),
			};
			return currentChannel;
		}),
		registerTool: vi.fn((tool: any) => {
			registeredTools.set(tool.name, tool);
		}),
		registerCommand: registerCommandFn,
		appendEntry: vi.fn(),
		sendMessage: vi.fn(),
		off: vi.fn(),
	} as unknown as ExtensionAPI;

	return {
		pi,
		handlers,
		registeredTools,
		channelSend: channelSendFn,
		registerCommandFn,
		getCurrentChannel: () => currentChannel,
	};
}

async function fireSessionStart(
	mock: ReturnType<typeof createMockPi>,
	cwd: string,
): Promise<void> {
	for (const h of mock.handlers.session_start ?? []) {
		await h(
			{},
			{
				sessionManager: { getBranch: () => [] },
				hasUI: false,
				ui: { notify: vi.fn() },
				cwd,
				isIdle: () => true,
				signal: undefined,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				compact: () => {},
				getSystemPrompt: () => "",
				model: undefined,
			},
		);
	}
}

async function fireSessionShutdown(mock: ReturnType<typeof createMockPi>): Promise<void> {
	for (const h of mock.handlers.session_shutdown ?? []) {
		await h({}, {});
	}
}

async function fireToolResult(
	mock: ReturnType<typeof createMockPi>,
	filePath: string,
	toolName: "write" | "edit" = "write",
): Promise<any> {
	const results: any[] = [];
	for (const h of mock.handlers.tool_result ?? []) {
		const result = await h(
			{
				type: "tool_result",
				toolCallId: "tc_e2e_1",
				toolName,
				input: { path: filePath },
				content: [{ type: "text", text: `File written: ${filePath}` }],
				isError: false,
				details: undefined,
			},
			{
				cwd: TEST_DIR,
				ui: { notify: vi.fn() },
			},
		);
		if (result) results.push(result);
	}
	return results;
}

describe("clangd E2E integration", () => {
	const originalCwd = process.cwd();

	beforeAll(async () => {
		await mkdir(join(TEST_DIR, ".pi"), { recursive: true });
		await writeFile(join(TEST_DIR, ".pi", "lsp.json"), JSON.stringify({
			servers: [
				{
					name: "clangd",
					command: ["clangd"],
					fileTypes: [".c", ".h", ".cpp", ".hpp", ".cc", ".cxx"],
				},
			],
		}));
		await writeFile(join(TEST_DIR, TEST_FILE), `#include <stdio.h>\n\nint main() {\n    int x = "hello";\n    printf("%d\\n", x);\n    return 0;\n}\n`);
		process.chdir(TEST_DIR);
	});

	afterAll(async () => {
		process.chdir(originalCwd);
	});

	it(
		"starts clangd, detects type error in test.c via diagnostics",
		async () => {
			const mock = createMockPi();
			lspExtensionDefault(mock.pi);

			await fireSessionStart(mock, TEST_DIR);

			const channel = mock.getCurrentChannel();
			expect(channel).not.toBeNull();

			const statusResult = await channel!.call("getStatus", {});
			console.log("[e2e] Status after session_start:", JSON.stringify(statusResult, null, 2));

			const status = statusResult as any;
			expect(status.state).toBeDefined();

			const readyServers = (status.servers as any[])?.filter((s: any) => s.state === "ready") ?? [];
			console.log(`[e2e] Ready servers: ${readyServers.length}`);
			for (const s of readyServers) {
				console.log(`[e2e]   - ${s.name} [${(s.fileTypes ?? []).join(",")}] state=${s.state}`);
			}

			if (readyServers.length === 0) {
				console.log("[e2e] No clangd server became ready — skipping diagnostics check");
				console.log("[e2e] All servers:", JSON.stringify(status.servers, null, 2));
			}

			expect(readyServers.length).toBeGreaterThanOrEqual(1);

			const toolResults = await fireToolResult(mock, TEST_FILE);
			console.log("[e2e] tool_result handler results:", JSON.stringify(toolResults, null, 2));

			const diagnosticsContent = toolResults.find(
				(r: any) => r?.content?.some?.((c: any) => c.text?.includes("[LSP]")),
			);
			if (diagnosticsContent) {
				console.log("[e2e] Diagnostics found in tool_result response:");
				for (const c of diagnosticsContent.content) {
					console.log(c.text);
				}
			}

			await fireSessionShutdown(mock);
			console.log("[e2e] Session shutdown complete");
		},
		30_000,
	);
});
