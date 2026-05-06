import { EventEmitter } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";
import type { RpcResponse } from "../src/modes/rpc/rpc-types.js";

function createClient(): RpcClient {
	return new RpcClient({});
}

function feedLine(client: RpcClient, line: string): void {
	(client as any).handleLine(line);
}

function feedJson(client: RpcClient, obj: object): void {
	feedLine(client, JSON.stringify(obj));
}

function mockProcess(client: RpcClient): { written: string[]; lastWritten(): object } {
	const written: string[] = [];
	const fakeStdin = new EventEmitter() as any;
	fakeStdin.write = (data: string) => {
		written.push(data);
	};
	(client as any).process = { stdin: fakeStdin, stdout: new EventEmitter(), stderr: new EventEmitter() };
	return {
		written,
		lastWritten: () => JSON.parse(written[written.length - 1].trim()),
	};
}

describe("RpcClient internal message routing", () => {
	describe("handleLine - ready signal", () => {
		it("resolves start() when ready signal received", async () => {
			const client = createClient();
			const readyPromise = new Promise<void>((resolve) => {
				(client as any).readyResolve = resolve;
			});

			feedJson(client, { type: "ready" });

			await expect(readyPromise).resolves.toBeUndefined();
			expect((client as any).readyResolve).toBeNull();
		});
	});

	describe("handleLine - response correlation", () => {
		it("resolves pending request with matching response id", async () => {
			const client = createClient();
			let resolved = false;
			let resolvedValue: RpcResponse | undefined;

			(client as any).pendingRequests.set("req_1", {
				resolve: (resp: RpcResponse) => {
					resolved = true;
					resolvedValue = resp;
				},
				reject: (_err: Error) => {},
			});

			feedJson(client, {
				type: "response",
				id: "req_1",
				command: "get_state",
				success: true,
				data: { isStreaming: false },
			});

			expect(resolved).toBe(true);
			expect(resolvedValue!.success).toBe(true);
			expect((client as any).pendingRequests.has("req_1")).toBe(false);
		});

		it("does not resolve for mismatched id", () => {
			const client = createClient();
			let resolved = false;

			(client as any).pendingRequests.set("req_1", {
				resolve: () => {
					resolved = true;
				},
				reject: () => {},
			});

			feedJson(client, {
				type: "response",
				id: "req_999",
				command: "get_state",
				success: true,
			});

			expect(resolved).toBe(false);
			expect((client as any).pendingRequests.has("req_1")).toBe(true);
		});

		it("removes pending request after resolution", () => {
			const client = createClient();

			(client as any).pendingRequests.set("req_5", {
				resolve: () => {},
				reject: () => {},
			});

			feedJson(client, { type: "response", id: "req_5", command: "abort", success: true });

			expect((client as any).pendingRequests.size).toBe(0);
		});
	});

	describe("handleLine - event fan-out", () => {
		it("emits agent_start event to listeners", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			feedJson(client, { type: "agent_start" });

			expect(events).toHaveLength(1);
			expect(events[0].type).toBe("agent_start");
		});

		it("emits turn_start and turn_end events", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			feedJson(client, { type: "turn_start", turnIndex: 0 });
			feedJson(client, { type: "turn_end", turnIndex: 0 });

			expect(events).toHaveLength(2);
			expect(events[0].type).toBe("turn_start");
			expect(events[1].type).toBe("turn_end");
		});

		it("delivers events to multiple listeners", () => {
			const client = createClient();
			const events1: any[] = [];
			const events2: any[] = [];

			client.onEvent((e) => events1.push(e));
			client.onEvent((e) => events2.push(e));

			feedJson(client, { type: "text", text: "hello" });

			expect(events1).toHaveLength(1);
			expect(events2).toHaveLength(1);
		});

		it("stops delivering after unsubscribe", () => {
			const client = createClient();
			const events: any[] = [];
			const unsub = client.onEvent((e) => events.push(e));

			feedJson(client, { type: "text", text: "a" });
			unsub();
			feedJson(client, { type: "text", text: "b" });

			expect(events).toHaveLength(1);
		});

		it("does not emit events for response messages", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			(client as any).pendingRequests.set("req_1", { resolve: () => {}, reject: () => {} });
			feedJson(client, { type: "response", id: "req_1", command: "abort", success: true });

			expect(events).toHaveLength(0);
		});
	});

	describe("handleLine - channel data routing", () => {
		it("routes channel data to registered handler", () => {
			const client = createClient();
			const received: unknown[] = [];
			const ch = client.channel("test-ch");
			ch.onReceive((data) => received.push(data));

			feedJson(client, {
				type: "channel_data",
				name: "test-ch",
				data: { foo: "bar" },
			});

			expect(received).toHaveLength(1);
			expect(received[0]).toEqual({ foo: "bar" });
		});

		it("does not route to different channel", () => {
			const client = createClient();
			const received: unknown[] = [];
			client.channel("ch-a").onReceive((data) => received.push(data));

			feedJson(client, {
				type: "channel_data",
				name: "ch-b",
				data: { foo: "bar" },
			});

			expect(received).toHaveLength(0);
		});

		it("supports multiple handlers on same channel", () => {
			const client = createClient();
			const received1: unknown[] = [];
			const received2: unknown[] = [];

			client.channel("ch").onReceive((data) => received1.push(data));
			client.channel("ch").onReceive((data) => received2.push(data));

			feedJson(client, { type: "channel_data", name: "ch", data: 42 });

			expect(received1).toHaveLength(1);
			expect(received2).toHaveLength(1);
		});

		it("unsubscribe stops channel delivery", () => {
			const client = createClient();
			const received: unknown[] = [];
			const unsub = client.channel("ch").onReceive((data) => received.push(data));

			feedJson(client, { type: "channel_data", name: "ch", data: 1 });
			unsub();
			feedJson(client, { type: "channel_data", name: "ch", data: 2 });

			expect(received).toEqual([1]);
		});
	});

	describe("handleLine - remote tool call", () => {
		it("dispatches remote_tool_call to registered handler", () => {
			const client = createClient();
			const calls: any[] = [];
			client.onRemoteToolCall((call) => calls.push(call));

			feedJson(client, {
				type: "remote_tool_call",
				toolCallId: "tc_123",
				toolName: "my_tool",
				args: { x: 1 },
			});

			expect(calls).toHaveLength(1);
			expect(calls[0]).toEqual({
				toolCallId: "tc_123",
				toolName: "my_tool",
				args: { x: 1 },
			});
		});

		it("uses empty args when args is missing", () => {
			const client = createClient();
			const calls: any[] = [];
			client.onRemoteToolCall((call) => calls.push(call));

			feedJson(client, {
				type: "remote_tool_call",
				toolCallId: "tc_456",
				toolName: "my_tool",
			});

			expect(calls[0].args).toEqual({});
		});

		it("unsubscribes remote tool call handler", () => {
			const client = createClient();
			const calls: any[] = [];
			const unsub = client.onRemoteToolCall((call) => calls.push(call));

			feedJson(client, { type: "remote_tool_call", toolCallId: "tc_1", toolName: "t" });
			unsub();
			feedJson(client, { type: "remote_tool_call", toolCallId: "tc_2", toolName: "t" });

			expect(calls).toHaveLength(1);
		});
	});

	describe("handleLine - edge cases", () => {
		it("ignores non-JSON lines silently", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			expect(() => feedLine(client, "not json at all")).not.toThrow();
			expect(events).toHaveLength(0);
		});

		it("ignores empty lines", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			expect(() => feedLine(client, "")).not.toThrow();
			expect(events).toHaveLength(0);
		});

		it("processes response before checking event listeners", () => {
			const client = createClient();
			const events: any[] = [];
			client.onEvent((e) => events.push(e));

			(client as any).pendingRequests.set("req_1", { resolve: () => {}, reject: () => {} });
			feedJson(client, { type: "response", id: "req_1", command: "get_state", success: true, data: {} });

			expect(events).toHaveLength(0);
		});
	});

	describe("send() - writes to stdin and tracks pending request", () => {
		it("rejects if process not started", async () => {
			const client = createClient();
			await expect((client as any).send({ type: "get_state" })).rejects.toThrow("Client not started");
		});

		it("writes serialized command to stdin", async () => {
			const client = createClient();
			const { written } = mockProcess(client);

			const sendPromise = (client as any).send({ type: "abort" });

			expect(written).toHaveLength(1);
			const parsed = JSON.parse(written[0].trim());
			expect(parsed.type).toBe("abort");
			expect(parsed.id).toBe("req_1");

			feedJson(client, { type: "response", id: "req_1", command: "abort", success: true });
			await sendPromise;
		});

		it("increments request id for each call", async () => {
			const client = createClient();
			const { written } = mockProcess(client);

			const p1 = (client as any).send({ type: "abort" });
			const p2 = (client as any).send({ type: "abort" });

			const ids = written.map((w) => JSON.parse(w.trim()).id);
			expect(ids[0]).toBe("req_1");
			expect(ids[1]).toBe("req_2");

			feedJson(client, { type: "response", id: "req_1", command: "abort", success: true });
			feedJson(client, { type: "response", id: "req_2", command: "abort", success: true });
			await Promise.all([p1, p2]);
		});

		it("rejects on timeout", async () => {
			const client = createClient();
			mockProcess(client);

			vi.useFakeTimers();
			const p = (client as any).send({ type: "get_state" });

			vi.advanceTimersByTime(30_000);
			await expect(p).rejects.toThrow("Timeout");
			vi.useRealTimers();
		});
	});

	describe("getData() - response unwrapping", () => {
		it("returns data for successful response", () => {
			const client = createClient();
			const result = (client as any).getData({
				success: true,
				data: { isStreaming: false, messageCount: 5 },
			});
			expect(result).toEqual({ isStreaming: false, messageCount: 5 });
		});

		it("throws on error response", () => {
			const client = createClient();
			expect(() =>
				(client as any).getData({
					success: false,
					error: "Something went wrong",
				}),
			).toThrow("Something went wrong");
		});
	});

	describe("channel() proxy", () => {
		it("channel.send() writes channel_data command to stdin", () => {
			const client = createClient();
			const { written } = mockProcess(client);

			client.channel("my-ch").send({ action: "test" });

			expect(written).toHaveLength(1);
			const parsed = JSON.parse(written[0].trim());
			expect(parsed.type).toBe("channel_data");
			expect(parsed.name).toBe("my-ch");
			expect(parsed.data).toEqual({ action: "test" });
		});

		it("channel.onReceive() receives channel_data events", () => {
			const client = createClient();
			const received: unknown[] = [];
			client.channel("ch").onReceive((data) => received.push(data));

			feedJson(client, { type: "channel_data", name: "ch", data: { hello: true } });

			expect(received).toEqual([{ hello: true }]);
		});

		it("channel.invoke() sends and receives correlated response", async () => {
			const client = createClient();
			const { lastWritten } = mockProcess(client);

			const invokePromise = client.channel("ch").invoke({ method: "ping" }, 5000);

			const handlers = (client as any).channelHandlers.get("ch") as Set<(...args: never[]) => unknown>;
			expect(handlers).toBeDefined();
			expect(handlers.size).toBeGreaterThanOrEqual(1);

			const sent = lastWritten();
			expect(sent.type).toBe("channel_data");
			expect(sent.name).toBe("ch");

			feedJson(client, {
				type: "channel_data",
				name: "ch",
				data: { result: "pong", invokeId: sent.data.invokeId },
			});

			const result = await invokePromise;
			expect(result).toEqual({ result: "pong", invokeId: sent.data.invokeId });
		});

		it("channel.call() sends with __call field", async () => {
			const client = createClient();
			const { written } = mockProcess(client);

			const callPromise = client.channel("ch").call("myMethod", { x: 1 }, 5000);

			const parsed = JSON.parse(written[0].trim());
			expect(parsed.data.__call).toBe("myMethod");
			expect(parsed.data.x).toBe(1);

			const invokeId = parsed.data.invokeId;

			feedJson(client, {
				type: "channel_data",
				name: "ch",
				data: { result: "ok", invokeId },
			});

			const result = await callPromise;
			expect((result as any).result).toBe("ok");
		});

		it("channel.invoke() rejects on timeout", async () => {
			const client = createClient();
			mockProcess(client);

			vi.useFakeTimers();
			const p = client.channel("ch").invoke({ method: "slow" }, 1000);

			vi.advanceTimersByTime(1000);
			await expect(p).rejects.toThrow('Channel invoke "ch" timed out');
			vi.useRealTimers();
		});

		it("channel.invoke() cleans up handler after resolution", async () => {
			const client = createClient();
			const { lastWritten } = mockProcess(client);

			const invokePromise = client.channel("ch").invoke({ method: "ping" }, 5000);

			const handlersBefore = (client as any).channelHandlers.get("ch") as Set<(...args: never[]) => unknown>;
			const sizeBefore = handlersBefore.size;

			const sent = lastWritten();
			feedJson(client, {
				type: "channel_data",
				name: "ch",
				data: { ok: true, invokeId: sent.data.invokeId },
			});

			await invokePromise;

			const handlersAfter = (client as any).channelHandlers.get("ch") as Set<(...args: never[]) => unknown>;
			if (handlersAfter) {
				expect(handlersAfter.size).toBeLessThan(sizeBefore);
			}
		});
	});

	describe("writeLine() - process not started guard", () => {
		it("throws if process not started", () => {
			const client = createClient();
			expect(() => (client as any).writeLine({ type: "test" })).toThrow("Client not started");
		});
	});

	describe("stop() - cleanup", () => {
		it("clears pending requests", async () => {
			const client = createClient();

			(client as any).pendingRequests.set("req_1", { resolve: () => {}, reject: () => {} });
			(client as any).pendingRequests.set("req_2", { resolve: () => {}, reject: () => {} });

			const fakeProcess = new EventEmitter() as any;
			fakeProcess.kill = vi.fn();
			fakeProcess.stdin = { write: vi.fn() };
			(client as any).process = fakeProcess;

			await client.stop();

			expect((client as any).pendingRequests.size).toBe(0);
			expect((client as any).process).toBeNull();
		});

		it("is no-op if process is null", async () => {
			const client = createClient();
			(client as any).process = null;
			await expect(client.stop()).resolves.toBeUndefined();
		});
	});

	describe("waitForIdle() and collectEvents()", () => {
		it("waitForIdle resolves on agent_end event", async () => {
			const client = createClient();
			const idlePromise = client.waitForIdle(5000);

			feedJson(client, { type: "agent_start" });
			feedJson(client, { type: "agent_end" });

			await expect(idlePromise).resolves.toBeUndefined();
		});

		it("waitForIdle rejects on timeout", async () => {
			const client = createClient();

			vi.useFakeTimers();
			const p = client.waitForIdle(100);
			vi.advanceTimersByTime(100);

			await expect(p).rejects.toThrow("Timeout");
			vi.useRealTimers();
		});

		it("collectEvents accumulates events until agent_end", async () => {
			const client = createClient();
			const collectPromise = client.collectEvents(5000);

			feedJson(client, { type: "agent_start" });
			feedJson(client, { type: "text", text: "hi" });
			feedJson(client, { type: "agent_end" });

			const events = await collectPromise;
			expect(events).toHaveLength(3);
		});

		it("collectEvents unsubscribes after agent_end", async () => {
			const client = createClient();
			const collectPromise = client.collectEvents(5000);

			feedJson(client, { type: "agent_end" });
			await collectPromise;

			expect((client as any).eventListeners.length).toBe(0);
		});
	});

	describe("getStderr()", () => {
		it("returns collected stderr", () => {
			const client = createClient();
			(client as any).stderr = "some error output";
			expect(client.getStderr()).toBe("some error output");
		});
	});
});
