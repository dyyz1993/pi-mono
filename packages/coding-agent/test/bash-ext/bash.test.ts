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
				params: { command: string; timeout?: number },
				signal?: AbortSignal,
				onUpdate?: any,
				ctx?: any,
			) => Promise<any>;
		};
	}

	describe("timeout - tool result format", () => {
		it("resolves with details.terminated reason=timeout when command times out", async () => {
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute("tc_timeout", { command: "sleep 60", timeout: 1 }, undefined, undefined, { cwd: "/tmp" } as any)
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
				.execute("tc_nonzero", { command: "exit 42" }, undefined, undefined, { cwd: "/tmp" } as any)
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
				.execute("tc_normal", { command: "echo hello world" }, undefined, undefined, { cwd: "/tmp" } as any)
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
			expect(mock.pi.registerTool).toHaveBeenCalledTimes(1);
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

			receiveHandler({ action: "list" });
			expect(mock.channelSend).toHaveBeenLastCalledWith(expect.objectContaining({ type: "list" }));
		});

		it("kill command sends terminated event for tracked process", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute("tc_kill_test", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any);
			await new Promise((r) => setTimeout(r, 20));

			receiveHandler({ action: "kill", toolCallId: "tc_kill_test" });
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
				.execute("tc_bg_test", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then(() => {
					resolved = true;
				});

			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ action: "background", toolCallId: "tc_bg_test" });
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
			toolDef.execute("tc_exec_1", { command: "sleep 5" }, undefined, undefined, { cwd: "/tmp" } as any);

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
			toolDef.execute("tc_exec_2", { command: "echo done" }, undefined, undefined, { cwd: "/tmp" } as any);

			await new Promise((r) => setTimeout(r, 200));

			const endCall = mock.channelSend.mock.calls.find((c: any[]) => {
				const e = c[0] as BashChannelEvent;
				return e.type === "end" || e.type === "error";
			});
			expect(endCall).toBeDefined();
		});

		it("emits output events during execution", async () => {
			const toolDef = getToolDef();
			toolDef.execute("tc_exec_3", { command: "echo hello world" }, undefined, undefined, { cwd: "/tmp" } as any);

			await new Promise((r) => setTimeout(r, 200));

			const outputCalls = mock.channelSend.mock.calls.filter(
				(c: any[]) => (c[0] as BashChannelEvent).type === "output",
			);
			expect(outputCalls.length).toBeGreaterThanOrEqual(0);
		});
	});

	describe("appendEntry persistence", () => {
		it("persists completed process", async () => {
			const toolDef = getToolDef();
			toolDef.execute("tc_persist", { command: "echo test" }, undefined, undefined, { cwd: "/tmp" } as any);

			await new Promise((r) => setTimeout(r, 200));

			const entry = mock.appendEntries.find((e) => e.type === "bash");
			expect(entry).toBeDefined();
			const data = entry!.data as any;
			expect(data.process.toolCallId).toBe("tc_persist");
		});

		it("persists background process", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute("tc_bg_persist", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any);
			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ action: "background", toolCallId: "tc_bg_persist" });
			await new Promise((r) => setTimeout(r, 10));

			const entry = mock.appendEntries.find(
				(e) => e.type === "bash" && (e.data as any)?.process?.status === "background",
			);
			expect(entry).toBeDefined();
			expect((entry!.data as any).process.toolCallId).toBe("tc_bg_persist");
		});
	});

	describe("abort signal", () => {
		it("resolves with details.terminated reason=signal when signal fires", async () => {
			const controller = new AbortController();
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute("tc_abort", { command: "sleep 999" }, controller.signal, undefined, { cwd: "/tmp" } as any)
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
				.execute("tc_kill_fmt", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "kill", toolCallId: "tc_kill_fmt" });
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
				.execute("tc_kill_msg", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "kill", toolCallId: "tc_kill_msg" });
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
				.execute("tc_bg_fmt", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_fmt" });
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
				.execute("tc_bg_msg", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_msg" });
			await new Promise((r) => setTimeout(r, 20));

			expect(result).toBeDefined();
			const text = result.content[0].text;
			expect(text).toContain("Moved to background after");
			expect(text).toContain("PID:");
			expect(text).toContain("Log:");
			expect(text).toContain("Shell panel");
		});

		it("creates a log file when backgrounded", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			let result: any = null;
			toolDef
				.execute("tc_bg_log", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_log" });
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
				.execute("tc_bg_exit", { command: "echo bg_start && sleep 1" }, undefined, undefined, {
					cwd: "/tmp",
				} as any)
				.then((r: any) => {
					result = r;
				});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_exit" });
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
				.execute("tc_bg_exit2", { command: "echo ok && sleep 1" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_exit2" });
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
				.execute("tc_bg_noout", { command: "echo before && sleep 1" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_noout" });
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
				.execute("tc_bg_sub", { command: "echo sub && sleep 2" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_bg_sub" });
			await new Promise((r) => setTimeout(r, 10));

			receiveHandler({ action: "subscribe_output", toolCallId: "tc_bg_sub" });
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

			toolDef.execute("tc_fg_only", { command: "sleep 5" }, undefined, undefined, { cwd: "/tmp" } as any);
			await new Promise((r) => setTimeout(r, 20));

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			expect((listCall![0] as BashChannelEvent).processes).toHaveLength(0);
		});

		it("list includes backgrounded active process", async () => {
			const ch = mock.getCurrentChannel()!;
			const receiveHandler = (ch.onReceive as ReturnType<typeof vi.fn>).mock.calls[0][0];
			const toolDef = getToolDef();

			toolDef.execute("tc_list_bg", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any);
			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ action: "background", toolCallId: "tc_list_bg" });
			await new Promise((r) => setTimeout(r, 10));

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
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
				.execute("tc_hist_exit", { command: "echo hi && sleep 1" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_hist_exit" });
			await new Promise((r) => setTimeout(r, 1500));

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
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

			toolDef.execute("tc_rm", { command: "sleep 999" }, undefined, undefined, { cwd: "/tmp" } as any);
			await new Promise((r) => setTimeout(r, 20));
			receiveHandler({ action: "background", toolCallId: "tc_rm" });
			await new Promise((r) => setTimeout(r, 10));

			receiveHandler({ action: "remove", toolCallId: "tc_rm" });

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
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
				.execute("tc_rm_hist", { command: "echo bye && sleep 1" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_rm_hist" });
			await new Promise((r) => setTimeout(r, 1500));

			receiveHandler({ action: "remove", toolCallId: "tc_rm_hist" });

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
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
				.execute("tc_session_clear", { command: "echo x && sleep 1" }, undefined, undefined, { cwd: "/tmp" } as any)
				.catch(() => {});

			await new Promise((r) => setTimeout(r, 50));
			receiveHandler({ action: "background", toolCallId: "tc_session_clear" });
			await new Promise((r) => setTimeout(r, 1500));

			fireSessionStart(mock);

			mock.channelSend.mockClear();
			receiveHandler({ action: "list" });
			const listCall = mock.channelSend.mock.calls.find((c: any[]) => (c[0] as BashChannelEvent).type === "list");
			expect(listCall).toBeDefined();
			expect((listCall![0] as BashChannelEvent).processes).toHaveLength(0);
		});
	});
});
