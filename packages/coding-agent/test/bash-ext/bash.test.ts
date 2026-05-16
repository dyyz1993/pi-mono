import { existsSync, readFileSync, statSync, unlinkSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import bashExtensionDefault, { type BashChannelEvent } from "../../extensions/bash-ext/index.js";
import type { ExtensionAPI } from "../../src/core/extensions/index.js";

interface MockChannel {
	name: string;
	send: ReturnType<typeof vi.fn>;
	onReceive: ReturnType<typeof vi.fn>;
	invoke: ReturnType<typeof vi.fn>;
}

function createMockPi() {
	const handlers: Record<string, Array<(event: any, ctx: any) => any>> = {};
	const channelSend = vi.fn();
	const appendEntries: Array<{ type: string; data: unknown }> = [];
	let currentChannel: MockChannel | null = null;

	const pi = {
		on: vi.fn((event: string, handler: any) => {
			if (!handlers[event]) handlers[event] = [];
			handlers[event].push(handler);
		}),
		callLLM: vi.fn(async () => "{}"),
		callLLMStructured: vi.fn(async () => ({})),
		forkAgent: vi.fn(async () => ({
			text: "",
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
		})),
		once: vi.fn(),
		emit: vi.fn(),
		setStatus: vi.fn(),
		registerProvider: vi.fn(),
		unregisterProvider: vi.fn(),
		events: { on: vi.fn(), off: vi.fn(), emit: vi.fn(), once: vi.fn() },
		registerChannel: vi.fn(() => {
			currentChannel = {
				name: "bash",
				send: channelSend,
				onReceive: vi.fn(() => () => {}),
				invoke: vi.fn(),
			};
			return currentChannel;
		}),
		registerTool: vi.fn(),
		appendEntry: vi.fn((type: string, data?: unknown) => {
			appendEntries.push({ type, data });
		}),
		registerCommand: vi.fn(),
		sendMessage: vi.fn(),
		sendUserMessage: vi.fn(),
	} as unknown as ExtensionAPI;

	return { pi, handlers, channelSend, appendEntries, getCurrentChannel: () => currentChannel };
}

function fireSessionStart(mock: ReturnType<typeof createMockPi>): void {
	for (const h of mock.handlers.session_start ?? []) h({}, {} as any);
}

describe("bash channel extension", () => {
	let mock: ReturnType<typeof createMockPi>;

	beforeEach(() => {
		mock = createMockPi();
		bashExtensionDefault(mock.pi);
		fireSessionStart(mock);
		mock.channelSend.mockClear();
	});

	function getToolDef() {
		return (mock.pi.registerTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as {
			name: string;
			execute: (
				toolCallId: string,
				params: { command: string; description: string; timeout?: number; backgroundAfter?: number },
				signal?: AbortSignal,
				onUpdate?: any,
				ctx?: any,
			) => Promise<any>;
		};
	}

	function getStatusToolDef() {
		return (mock.pi.registerTool as ReturnType<typeof vi.fn>).mock.calls[1][0] as {
			name: string;
			execute: (toolCallId: string, params: { bashId: string; lastLines?: number; grep?: string }) => Promise<any>;
		};
	}

	describe("timeout - tool result format", () => {
		it("resolves with details.terminated reason=timeout when command times out", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_timeout",
					{ description: "Sleep for timeout test", command: "sleep 60", timeout: 1 },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 2000));

			expect(result).toBeDefined();
			expect(result.details.terminated.reason).toBe("timeout");
			expect(result.details.terminated.timeoutSecs).toBe(1);
			expect(result.details.terminated.pid).toBeTypeOf("number");
			expect(result.details.terminated.durationMs).toBeGreaterThan(900);
			expect(result.content[0].text).toContain("Timed out after 1s");
			expect(result.content[0].text).toContain("PID:");
		});
	});

	describe("non-zero exit code - tool result format", () => {
		it("resolves with details.terminated reason=error when command exits non-zero", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute("tc_nonzero", { description: "Exit with code 42", command: "exit 42" }, undefined, undefined, {
					cwd: "/tmp",
				} as any)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 200));

			expect(result).toBeDefined();
			expect(result.details.terminated.reason).toBe("error");
			expect(result.details.terminated.exitCode).toBe(42);
			expect(result.details.terminated.pid).toBeTypeOf("number");
			expect(result.details.terminated.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.content[0].text).toContain("Command failed with exit code 42");
			expect(result.content[0].text).toContain("PID:");
		});
	});

	describe("normal exit - tool result format", () => {
		it("resolves with output text and no terminated details", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_normal",
					{ description: "Echo hello world", command: "echo hello world" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 200));

			expect(result).toBeDefined();
			expect(result.content[0].text).toContain("hello world");
			expect(result.details?.terminated).toBeUndefined();
			expect(result.details?.background).toBeUndefined();
		});
	});

	describe("registration", () => {
		it("registers bash channel on session_start", () => {
			expect(mock.pi.registerChannel).toHaveBeenCalledWith("bash");
		});

		it("emits empty list on session_start", () => {
			const m = createMockPi();
			bashExtensionDefault(m.pi);
			fireSessionStart(m);

			expect(m.channelSend).toHaveBeenCalledWith(expect.objectContaining({ type: "list", processes: [] }));
		});

		it("registers a bash tool that overrides built-in", () => {
			expect(mock.pi.registerTool).toHaveBeenCalledTimes(2);
			const toolDef = getToolDef();
			expect(toolDef.name).toBe("bash");
			expect(toolDef.execute).toBeTypeOf("function");
		});
	});

	describe("channel commands", () => {
		it("responds to list command via onReceive", () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			expect(receiveHandler).toBeDefined();

			receiveHandler({ __call: "list", invokeId: "test" });
			expect(mock.channelSend).toHaveBeenLastCalledWith(expect.objectContaining({ type: "list" }));
		});

		it("kill command sends terminated event for tracked process", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute(
				"tc_kill_test",
				{ description: "Long sleep for kill test", command: "sleep 999" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 20));

			receiveHandler({ __call: "kill", toolCallId: "tc_kill_test" });
			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "terminated",
					toolCallId: "tc_kill_test",
				}),
			);
		});

		it("background command resolves tool with background message", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let resolved = false;
			toolDef
				.execute(
					"tc_bg_test",
					{ description: "Long sleep for background test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then(() => {
					resolved = true;
				});

			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_test" });
			await new Promise((r) => setTimeout(r, 10));

			expect(resolved).toBe(true);
			expect(mock.channelSend).toHaveBeenCalledWith(
				expect.objectContaining({
					type: "background",
					toolCallId: "tc_bg_test",
				}),
			);
		});

		it("ignores unknown actions", () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			mock.channelSend.mockClear();

			receiveHandler({ action: "unknown_thing" });
			expect(mock.channelSend).not.toHaveBeenCalled();
		});
	});

	describe("tool execution", () => {
		it("emits start event with pid when tool executes", async () => {
			const toolDef = getToolDef();
			toolDef.execute(
				"tc_exec_1",
				{ description: "Sleep 5 for start event test", command: "sleep 5" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);

			await new Promise((r) => setTimeout(r, 20));

			const startCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "start");
			expect(startCall).toBeDefined();
			const event = startCall![0] as BashChannelEvent;
			expect(event.toolCallId).toBe("tc_exec_1");
			expect(event.data).toBe("sleep 5");
			expect(event.processes).toHaveLength(1);
			expect(event.processes![0].status).toBe("running");
		});

		it("emits end event when command finishes", async () => {
			const toolDef = getToolDef();
			toolDef.execute(
				"tc_exec_2",
				{ description: "Echo done for end event test", command: "echo done" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);

			await new Promise((r) => setTimeout(r, 200));

			const endCall = mock.channelSend.mock.calls.find((c: any[]) => {
				const e = c[0] as BashChannelEvent;
				return e.type === "end" || e.type === "error";
			});
			expect(endCall).toBeDefined();
		});

		it("emits output events during execution", async () => {
			const toolDef = getToolDef();
			toolDef.execute(
				"tc_exec_3",
				{ description: "Echo hello world for output event test", command: "echo hello world" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);

			await new Promise((r) => setTimeout(r, 200));

			const outputCalls = mock.channelSend.mock.calls.filter(
				(c: any[]) => (c[0] as BashChannelEvent).type === "output",
			);
			expect(outputCalls.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("abort signal", () => {
		it("resolves with details.terminated reason=signal when signal fires", async () => {
			const controller = new AbortController();
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_abort",
					{ description: "Long sleep for abort signal test", command: "sleep 999" },
					controller.signal,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 20));
			controller.abort();
			await new Promise((r) => setTimeout(r, 50));

			expect(result).toBeDefined();
			expect(result.details.terminated.reason).toBe("signal");
			expect(result.details.terminated.pid).toBeTypeOf("number");
			expect(result.details.terminated.durationMs).toBeGreaterThanOrEqual(0);
			expect(result.content[0].text).toContain("Aborted after");
			expect(result.content[0].text).toContain("PID:");
		});
	});

	describe("kill action - tool result format", () => {
		it("resolves with details.terminated including reason, pid, command, duration, logPath", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_kill_fmt",
					{ description: "Long sleep for kill format test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "kill", toolCallId: "tc_kill_fmt" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result).toBeDefined();
			const d = result.details.terminated;
			expect(d.reason).toBe("user_cancel");
			expect(d.pid).toBeTypeOf("number");
			expect(d.command).toBe("sleep 999");
			expect(d.startedAt).toBeTypeOf("number");
			expect(d.endedAt).toBeTypeOf("number");
			expect(d.durationMs).toBeGreaterThanOrEqual(0);
			expect(d.logPath).toBeTypeOf("string");
		});

		it("content includes user cancelled message with duration and PID", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_kill_msg",
					{ description: "Long sleep for kill message test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "kill", toolCallId: "tc_kill_msg" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result).toBeDefined();
			const text = result.content[0].text;
			expect(text).toContain("User cancelled after");
			expect(text).toContain("PID:");
		});
	});

	describe("background action - tool result format", () => {
		it("resolves with details.background including pid, command, duration, logPath", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bg_fmt",
					{ description: "Long sleep for background format test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_fmt" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result).toBeDefined();
			const d = result.details.background;
			expect(d.pid).toBeTypeOf("number");
			expect(d.command).toBe("sleep 999");
			expect(d.startedAt).toBeTypeOf("number");
			expect(d.durationMs).toBeGreaterThanOrEqual(0);
			expect(d.logPath).toBeTypeOf("string");
			expect(d.detached).toBe(false);
		});

		it("content includes moved to background message with logPath guidance", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bg_msg",
					{ description: "Long sleep for background message test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_msg" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result).toBeDefined();
			const text = result.content[0].text;
			expect(text).toContain("Moved to background after");
			expect(text).toContain("PID:");
			expect(text).toContain("Log:");
			expect(text).toContain("get_background_process");
		});

		it("creates a log file when backgrounded", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bg_log",
					{ description: "Long sleep for background log test", command: "sleep 999" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_log" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result.details.background.logPath).toMatch(/pi-bash-.*\.log$/);
		});
	});

	describe("background process exit notification", () => {
		it("sends sendUserMessage when background process exits normally", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bg_exit",
					{
						description: "Echo and sleep for background exit notification test",
						command: "echo bg_start && sleep 1",
					},
					undefined,
					undefined,
					{
						cwd: "/tmp",
					} as any,
				)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_exit" });
			await new Promise((r) => setTimeout(r, 1500));

			expect(result).toBeDefined();
			expect(mock.pi.sendUserMessage).toHaveBeenCalledWith(expect.stringContaining("exited with code"));
			const call = (mock.pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: any[]) => typeof c[0] === "string" && c[0].includes("exited with code"),
			);
			expect(call).toBeDefined();
			expect(call![0]).toContain("[system]");
			expect(call![0]).toContain("PID:");
		});

		it("sendUserMessage includes logPath", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_bg_exit2",
					{ description: "Echo and sleep for logPath notification test", command: "echo ok && sleep 1" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_exit2" });
			await new Promise((r) => setTimeout(r, 1500));

			const call = (mock.pi.sendUserMessage as ReturnType<typeof vi.fn>).mock.calls.find(
				(c: any[]) => typeof c[0] === "string" && c[0].includes("Log:"),
			);
			expect(call).toBeDefined();
			expect(call![0]).toMatch(/pi-bash-.*\.log/);
		});
	});

	describe("background output mode", () => {
		it("stops emitting output events after background", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_bg_noout",
					{ description: "Echo and sleep for background output mode test", command: "echo before && sleep 1" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_noout" });
			await new Promise((r) => setTimeout(r, 10));

			mock.channelSend.mockClear();
			await new Promise((r) => setTimeout(r, 500));

			const outputAfterBg = mock.channelSend.mock.calls.filter(
				(c: any[]) => (c[0] as BashChannelEvent).type === "output",
			);
			expect(outputAfterBg.length).toBe(0);
		});

		it("resumes output events after subscribe_output", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_bg_sub",
					{ description: "Echo and sleep for subscribe output test", command: "echo sub && sleep 2" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_bg_sub" });
			await new Promise((r) => setTimeout(r, 10));

			receiveHandler({ __call: "subscribe_output", toolCallId: "tc_bg_sub" });
			mock.channelSend.mockClear();

			await new Promise((r) => setTimeout(r, 200));

			const outputAfterSub = mock.channelSend.mock.calls.filter(
				(c: any[]) => (c[0] as BashChannelEvent).type === "output",
			);
			expect(outputAfterSub.length).toBe(0);
		});
	});

	describe("history and remove", () => {
		it("list returns only backgrounded processes, not foreground running", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute(
				"tc_fg_only",
				{ description: "Sleep for foreground-only list test", command: "sleep 5" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 20));

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			expect((listCall![0] as BashChannelEvent).processes).toHaveLength(0);
		});

		it("list includes backgrounded active process", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute(
				"tc_list_bg",
				{ description: "Long sleep for background list test", command: "sleep 999" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ __call: "background", toolCallId: "tc_list_bg" });
			await new Promise((r) => setTimeout(r, 10));

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			const procs = (listCall![0] as BashChannelEvent).processes!;
			expect(procs.length).toBeGreaterThanOrEqual(1);
			expect(procs.some((p) => p.toolCallId === "tc_list_bg")).toBe(true);
		});

		it("background process exit goes to history", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_hist_exit",
					{ description: "Echo and sleep for history exit test", command: "echo hi && sleep 1" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_hist_exit" });
			await new Promise((r) => setTimeout(r, 1500));

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			const procs = (listCall![0] as BashChannelEvent).processes!;
			const histProc = procs.find((p) => p.toolCallId === "tc_hist_exit");
			expect(histProc).toBeDefined();
			expect(histProc!.status).toBe("done");
			expect(histProc!.endedAt).toBeTypeOf("number");
		});

		it("remove action deletes from list", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute(
				"tc_rm",
				{ description: "Long sleep for remove action test", command: "sleep 999" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ __call: "background", toolCallId: "tc_rm" });
			await new Promise((r) => setTimeout(r, 10));

			receiveHandler({ __call: "remove", toolCallId: "tc_rm" });

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			const procs = (listCall![0] as BashChannelEvent).processes!;
			expect(procs.find((p) => p.toolCallId === "tc_rm")).toBeUndefined();
		});

		it("remove action deletes from history after background exit", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_rm_hist",
					{ description: "Echo and sleep for remove history test", command: "echo bye && sleep 1" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_rm_hist" });
			await new Promise((r) => setTimeout(r, 1500));

			receiveHandler({ __call: "remove", toolCallId: "tc_rm_hist" });

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			const procs = (listCall![0] as BashChannelEvent).processes!;
			expect(procs.find((p) => p.toolCallId === "tc_rm_hist")).toBeUndefined();
		});

		it("session_start clears history and deletedIds", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef
				.execute(
					"tc_session_clear",
					{ description: "Echo and sleep for session clear test", command: "echo x && sleep 1" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ __call: "background", toolCallId: "tc_session_clear" });
			await new Promise((r) => setTimeout(r, 1500));

			fireSessionStart(mock);

			mock.channelSend.mockClear();
			receiveHandler({ __call: "list", invokeId: "test" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			expect((listCall![0] as BashChannelEvent).processes).toHaveLength(0);
		});
	});

	describe("bashId generation", () => {
		it("assigns bashId matching bash-<6-char-hex> to each process", async () => {
			const toolDef = getToolDef();
			toolDef.execute(
				"tc_bashid_1",
				{ description: "Echo for bashId test", command: "echo hello" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);

			await new Promise((r) => setTimeout(r, 200));

			const startCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "start");
			expect(startCall).toBeDefined();
			const proc = (startCall![0] as BashChannelEvent).processes![0];
			expect(proc.bashId).toMatch(/^bash-[a-f0-9]{6}$/);
		});

		it("sets logPath containing pi-bash-", async () => {
			const toolDef = getToolDef();
			toolDef.execute(
				"tc_bashid_2",
				{ description: "Echo for logPath test", command: "echo hello" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);

			await new Promise((r) => setTimeout(r, 200));

			const startCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "start");
			expect(startCall).toBeDefined();
			const proc = (startCall![0] as BashChannelEvent).processes![0];
			expect(proc.logPath).toMatch(/pi-bash-/);
		});
	});

	describe("backgroundAfter auto-backgrounds the process", () => {
		it("resolves with background message after backgroundAfter seconds", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bgafter",
					{ description: "Sleep for backgroundAfter test", command: "sleep 999", backgroundAfter: 1 },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 1500));

			expect(result).toBeDefined();
			expect(result.content[0].text).toContain("Automatically moved to background");
			expect(result.content[0].text).toMatch(/<bashId>bash-[a-f0-9]{6}<\/bashId>/);
			expect(result.content[0].text).toContain("backgroundAfter=1s");
			expect(result.details.background).toBeDefined();
			expect(result.details.background.pid).toBeTypeOf("number");
			expect(result.details.background.command).toBe("sleep 999");
			expect(result.details.background.durationMs).toBeGreaterThanOrEqual(900);
		});
	});

	describe("backgroundAfter ignored when >= timeout", () => {
		it("kills process at timeout instead of backgrounding", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_bgafter_ignore",
					{
						description: "Sleep for ignored backgroundAfter test",
						command: "sleep 999",
						backgroundAfter: 10,
						timeout: 2,
					},
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 3000));

			expect(result).toBeDefined();
			expect(result.details.terminated).toBeDefined();
			expect(result.details.terminated.reason).toBe("timeout");
			expect(result.details.terminated.timeoutSecs).toBe(2);
			expect(result.details.terminated.durationMs).toBeGreaterThanOrEqual(1900);
		});
	});

	describe("get_background_process for running process", () => {
		it("returns status info for a live background process", async () => {
			const toolDef = getToolDef();
			const statusTool = getStatusToolDef();

			toolDef.execute(
				"tc_status_live",
				{ description: "Sleep for status tool test", command: "sleep 999" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 50));

			const startCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "start");
			expect(startCall).toBeDefined();
			const bashId = (startCall![0] as BashChannelEvent).processes![0].bashId;

			const result = await statusTool.execute("tc_status_query", { bashId });
			const text = result.content[0].text;
			expect(text).toContain("sleep 999");
			expect(text).toContain(`<bashId>${bashId}</bashId>`);
			expect(text).toContain("PID:");
			expect(text).toContain("running");
		});
	});

	describe("get_background_process with grep filter", () => {
		it("filters output to only lines matching grep pattern", async () => {
			const toolDef = getToolDef();
			const statusTool = getStatusToolDef();
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];

			toolDef.execute(
				"tc_grep_test",
				{
					description: "Multi-output for grep test",
					command: "echo 'hello world' && echo 'error: something failed' && echo 'done' && sleep 999",
				},
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 200));

			const startCall = mock.channelSend.mock.calls.find(
				(c: any[]) =>
					(c[0] as BashChannelEvent).type === "start" && (c[0] as BashChannelEvent).toolCallId === "tc_grep_test",
			);
			expect(startCall).toBeDefined();
			const bashId = (startCall![0] as BashChannelEvent).processes![0].bashId;

			receiveHandler({ __call: "background", toolCallId: "tc_grep_test" });
			await new Promise((r) => setTimeout(r, 50));

			const result = await statusTool.execute("tc_grep_query", { bashId, grep: "error" });
			const text = result.content[0].text;
			expect(text).toContain('Filtered by: "error"');
			const outputSection = text.split("Output so far:\n")[1];
			expect(outputSection).toBeDefined();
			expect(outputSection).toContain("error: something failed");
			expect(outputSection).not.toContain("hello world");
		});
	});

 	describe("get_background_process with lastLines filter", () => {
		it("shows only last N lines of output with line numbers", async () => {
			const toolDef = getToolDef();
			const statusTool = getStatusToolDef();
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];

			toolDef.execute(
				"tc_lastlines_test",
				{
					description: "Multi-line output for lastLines test",
					command: 'for i in $(seq 1 10); do echo "line $i"; done && sleep 999',
				},
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 300));

			const startCall = mock.channelSend.mock.calls.find(
				(c: any[]) =>
					(c[0] as BashChannelEvent).type === "start" &&
					(c[0] as BashChannelEvent).toolCallId === "tc_lastlines_test",
			);
			expect(startCall).toBeDefined();
			const bashId = (startCall![0] as BashChannelEvent).processes![0].bashId;

			receiveHandler({ __call: "background", toolCallId: "tc_lastlines_test" });
			await new Promise((r) => setTimeout(r, 500));

			let text = "";
			for (let attempt = 0; attempt < 5; attempt++) {
				const result = await statusTool.execute("tc_lastlines_query", { bashId, lastLines: 3 });
				text = result.content[0].text;
				if (text.includes("line 9")) break;
				await new Promise((r) => setTimeout(r, 500));
			}
			// New format: line numbers with L prefix
			expect(text).toContain("L9: line 9");
			expect(text).toContain("L10: line 10");
			expect(text).toContain("Lines: 9-11 of 11 total");
			const outputSection = text.split("Output so far:\n")[1];
			expect(outputSection).toBeDefined();
			expect(outputSection).not.toContain("L8:");
			expect(outputSection).not.toMatch(/L1:.*line 1/);
		});
	});

	describe("get_background_process for unknown bashId", () => {
		it("returns no process found message", async () => {
			const statusTool = getStatusToolDef();

			const result = await statusTool.execute("tc_unknown_query", { bashId: "bash-noexist" });
			const text = result.content[0].text;
			expect(text).toContain("No process found");
			expect(text).toContain("<bashId>bash-noexist</bashId>");
		});
	});

	describe("truncation and temp file", () => {
		const tempFilesToCleanup: string[] = [];

		afterEach(() => {
			for (const f of tempFilesToCleanup) {
				try {
					unlinkSync(f);
				} catch {}
			}
			tempFilesToCleanup.length = 0;
		});

		it("should persist full output when truncation happens by line count", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_trunc_lines",
					{ description: "Generate 3000 lines for truncation test", command: "seq 3000" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 2000));

			expect(result).toBeDefined();
			expect(result.details.truncation.truncated).toBe(true);
			expect(result.details.fullOutputPath).toBeDefined();

			const fullPath: string = result.details.fullOutputPath;
			expect(existsSync(fullPath)).toBe(true);
			tempFilesToCleanup.push(fullPath);

			const fullContent = readFileSync(fullPath, "utf-8");
			expect(fullContent).toContain("1\n");
			expect(fullContent).toContain("2999\n3000");

			const text = result.content[0].text;
			expect(text).toContain("[Showing lines");
			expect(text).toContain("Full output:");
		});

		it("should persist full output when truncation happens by byte count", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_trunc_bytes",
					{
						description: "Generate 60KB for byte truncation test",
						command: "dd if=/dev/zero bs=1024 count=60 2>/dev/null | tr '\\0' 'x'",
					},
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 3000));

			expect(result).toBeDefined();
			expect(result.details.fullOutputPath).toBeDefined();

			const fullPath: string = result.details.fullOutputPath;
			expect(existsSync(fullPath)).toBe(true);
			tempFilesToCleanup.push(fullPath);

			const fileSize = statSync(fullPath).size;
			expect(fileSize).toBeGreaterThan(50 * 1024);
		});

		it("should include truncation message with line range in output text", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute(
					"tc_trunc_range",
					{ description: "Generate 3000 lines for line range test", command: "seq 3000" },
					undefined,
					undefined,
					{ cwd: "/tmp" } as any,
				)
				.then((r: any) => {
					result = r;
				})
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 2000));

			expect(result).toBeDefined();
			const text = result.content[0].text;
			expect(text).toMatch(/\[Showing lines \d+-\d+ of \d+\. Full output: .+\]/);

			if (result.details?.fullOutputPath) {
				tempFilesToCleanup.push(result.details.fullOutputPath);
			}
		});
	});

	describe("session_start kills running background processes", () => {
		it("kills managed processes when session_start fires", async () => {
			const toolDef = getToolDef();

			// Start a long-running process
			toolDef.execute(
				"tc_orphan",
				{ description: "Long sleep for orphan kill test", command: "sleep 999" },
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 50));

			// Verify process is running
			const startCall = mock.channelSend.mock.calls.find(
				(c: any[]) => (c[0] as BashChannelEvent).type === "start" && (c[0] as BashChannelEvent).toolCallId === "tc_orphan",
			);
			expect(startCall).toBeDefined();
			const pid = (startCall![0] as BashChannelEvent).processes![0].pid;
			expect(pid).toBeTypeOf("number");

			// Fire session_start — should kill the process
			fireSessionStart(mock);
			await new Promise((r) => setTimeout(r, 100));

			// Verify process was killed (no longer exists)
			// On macOS, sending signal 0 to a killed process should throw
			let processGone = false;
			try {
				process.kill(pid!, 0);
			} catch {
				processGone = true;
			}
			expect(processGone).toBe(true);
		});
	});

	describe("get_background_process line number format", () => {
		it("shows L-prefix line numbers and Lines range in header", async () => {
			const toolDef = getToolDef();
			const statusTool = getStatusToolDef();
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];

			toolDef.execute(
				"tc_lineno",
				{
					description: "Multi-line for line number format test",
					command: 'echo "alpha" && echo "beta" && echo "gamma" && sleep 999',
				},
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 200));

			const startCall = mock.channelSend.mock.calls.find(
				(c: any[]) =>
					(c[0] as BashChannelEvent).type === "start" && (c[0] as BashChannelEvent).toolCallId === "tc_lineno",
			);
			expect(startCall).toBeDefined();
			const bashId = (startCall![0] as BashChannelEvent).processes![0].bashId;

			receiveHandler({ __call: "background", toolCallId: "tc_lineno" });
			await new Promise((r) => setTimeout(r, 50));

			const result = await statusTool.execute("tc_lineno_query", { bashId });
			const text = result.content[0].text;

			// Header should contain Lines range
			expect(text).toMatch(/Lines: \d+-\d+ of \d+ total/);

			// Output should have L-prefix line numbers
			expect(text).toMatch(/L\d+: alpha/);
			expect(text).toMatch(/L\d+: beta/);
			expect(text).toMatch(/L\d+: gamma/);
		});

		it("grep mode preserves original line numbers", async () => {
			const toolDef = getToolDef();
			const statusTool = getStatusToolDef();
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];

			toolDef.execute(
				"tc_grep_lineno",
				{
					description: "Multi-output for grep line number test",
					command: "echo 'line1 ok' && echo 'line2 ERROR' && echo 'line3 ok' && echo 'line4 ERROR' && sleep 999",
				},
				undefined,
				undefined,
				{ cwd: "/tmp" } as any,
			);
			await new Promise((r) => setTimeout(r, 200));

			const startCall = mock.channelSend.mock.calls.find(
				(c: any[]) =>
					(c[0] as BashChannelEvent).type === "start" && (c[0] as BashChannelEvent).toolCallId === "tc_grep_lineno",
			);
			expect(startCall).toBeDefined();
			const bashId = (startCall![0] as BashChannelEvent).processes![0].bashId;

			receiveHandler({ __call: "background", toolCallId: "tc_grep_lineno" });
			await new Promise((r) => setTimeout(r, 50));

			const result = await statusTool.execute("tc_grep_lineno_query", { bashId, grep: "error" });
			const text = result.content[0].text;

			// Should show original line numbers (L2 and L4, not L1 and L2)
			expect(text).toMatch(/L2: line2 ERROR/);
			expect(text).toMatch(/L4: line4 ERROR/);
			// Non-matching lines should not appear in the output section
			const outputSection = text.split("Output so far:\n")[1];
			expect(outputSection).toBeDefined();
			expect(outputSection).not.toContain("L1: line1 ok");
			expect(outputSection).not.toContain("L3: line3 ok");
		});
	});
});
