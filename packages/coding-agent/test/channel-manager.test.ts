import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelManager } from "../src/core/extensions/channel-manager.ts";
import { ServerChannel } from "../src/core/extensions/server-channel.ts";

describe("ChannelManager", () => {
	let output: ReturnType<typeof vi.fn>;
	let cm: ChannelManager;

	beforeEach(() => {
		output = vi.fn();
		cm = new ChannelManager(output);
	});

	it("registers a channel and returns Channel interface", () => {
		const ch = cm.register("test");
		expect(ch.name).toBe("test");
		expect(typeof ch.send).toBe("function");
		expect(typeof ch.onReceive).toBe("function");
		expect(typeof ch.invoke).toBe("function");
		expect(typeof ch.call).toBe("function");
	});

	it("throws on duplicate channel name", () => {
		cm.register("test");
		expect(() => cm.register("test")).toThrow(/already registered/);
	});

	it("registerOrReplace replaces an existing channel without keeping stale handlers", () => {
		const first = cm.register("test");
		const staleHandler = vi.fn();
		first.onReceive(staleHandler);

		const second = cm.registerOrReplace("test");
		const freshHandler = vi.fn();
		second.onReceive(freshHandler);

		cm.handleInbound({ type: "channel_data", name: "test", data: "fresh" });
		expect(staleHandler).not.toHaveBeenCalled();
		expect(freshHandler).toHaveBeenCalledWith("fresh");
	});

	it("registerOrReplace rejects pending invokes from the replaced channel", async () => {
		const first = cm.register("test");
		const pending = first.invoke({ action: "before-replace" }, 5000);

		cm.registerOrReplace("test");

		await expect(pending).rejects.toThrow(/unregistered/);
	});

	it("registerOrReuse keeps existing server handlers attached", () => {
		const first = cm.register("coordinator");
		const server = new ServerChannel(first);
		server.handle("ping", () => ({ ok: true }));

		cm.registerOrReuse("coordinator");
		cm.handleInbound({
			type: "channel_data",
			name: "coordinator",
			data: { __call: "ping", invokeId: "inv_reuse" },
		});

		expect(output).toHaveBeenCalledWith({
			type: "channel_data",
			name: "coordinator",
			data: { ok: true, invokeId: "inv_reuse" },
		});
	});

	it("registerOrReuse preserves in-flight invokes", async () => {
		const first = cm.register("coordinator");
		const pending = first.call("session_delegate_list", { parentSessionId: "parent" }, 5000);
		const sent = output.mock.calls[0][0];

		cm.registerOrReuse("coordinator");
		cm.handleInbound({
			type: "channel_data",
			name: "coordinator",
			data: { invokeId: sent.data.invokeId, tasks: [] },
		});

		await expect(pending).resolves.toEqual({ invokeId: sent.data.invokeId, tasks: [] });
	});

	it("registerOrReuse survives repeated rebinds during concurrent calls", async () => {
		let clientManager: ChannelManager;
		let serverManager: ChannelManager;

		clientManager = new ChannelManager((msg) => setImmediate(() => serverManager.handleInbound(msg)));
		serverManager = new ChannelManager((msg) => setImmediate(() => clientManager.handleInbound(msg)));

		const serverRaw = serverManager.register("coordinator");
		const clientRaw = clientManager.register("coordinator");
		const server = new ServerChannel(serverRaw);

		let handled = 0;
		server.handle("session_delegate_sync", async (params) => {
			handled += 1;
			await new Promise((resolve) => setTimeout(resolve, handled % 3));
			return { status: "completed", exitCode: 0, finalText: String(params) };
		});

		const calls: Array<Promise<unknown>> = [];
		for (let i = 0; i < 40; i++) {
			if (i % 2 === 0) clientManager.registerOrReuse("coordinator");
			if (i % 3 === 0) serverManager.registerOrReuse("coordinator");
			calls.push(clientRaw.call("session_delegate_sync", { task: `task-${i}` }, 5000));
		}

		const results = await Promise.all(calls);
		expect(results).toHaveLength(40);
		expect(handled).toBe(40);
		expect(results.every((result) => (result as { exitCode?: number }).exitCode === 0)).toBe(true);
	});

	it("channel.send() emits channel_data message", () => {
		const ch = cm.register("test");
		ch.send({ action: "list" });
		expect(output).toHaveBeenCalledWith({ type: "channel_data", name: "test", data: { action: "list" } });
	});

	it("onReceive handler receives inbound data", () => {
		const ch = cm.register("test");
		const handler = vi.fn();
		ch.onReceive(handler);

		cm.handleInbound({ type: "channel_data", name: "test", data: { action: "steer", message: "hello" } });
		expect(handler).toHaveBeenCalledWith({ action: "steer", message: "hello" });
	});

	it("onReceive unsubscribe stops delivery", () => {
		const ch = cm.register("test");
		const handler = vi.fn();
		const unsub = ch.onReceive(handler);

		unsub();
		cm.handleInbound({ type: "channel_data", name: "test", data: "x" });
		expect(handler).not.toHaveBeenCalled();
	});

	it("inbound to unknown channel is ignored", () => {
		const handler = vi.fn();
		const ch = cm.register("test");
		ch.onReceive(handler);

		cm.handleInbound({ type: "channel_data", name: "nonexistent", data: "y" });
		expect(handler).not.toHaveBeenCalled();
	});

	it("invoke sends with invokeId and resolves on matching response", async () => {
		const ch = cm.register("test");
		const invokePromise = ch.invoke({ action: "list" }, 5000);

		expect(output).toHaveBeenCalledTimes(1);
		const sent = output.mock.calls[0][0];
		expect(sent.type).toBe("channel_data");
		expect(sent.name).toBe("test");
		expect(sent.data.invokeId).toMatch(/^inv_/);

		cm.handleInbound({
			type: "channel_data",
			name: "test",
			data: { invokeId: sent.data.invokeId, result: ["a", "b"] },
		});

		const result = await invokePromise;
		expect(result).toEqual({ invokeId: sent.data.invokeId, result: ["a", "b"] });
	});

	it("invoke rejects on timeout", async () => {
		vi.useFakeTimers();
		const ch = cm.register("test");
		const promise = ch.invoke({ action: "list" }, 100);

		vi.advanceTimersByTime(150);
		await expect(promise).rejects.toThrow(/timed out/);
		vi.useRealTimers();
	});

	it("unregister rejects pending invokes", async () => {
		const ch = cm.register("test");
		const promise = ch.invoke({ action: "list" }, 5000);
		cm.unregister("test");
		await expect(promise).rejects.toThrow(/unregistered/);
	});

	it("multiple channels are isolated", () => {
		const ch1 = cm.register("a");
		const ch2 = cm.register("b");
		const h1 = vi.fn();
		const h2 = vi.fn();
		ch1.onReceive(h1);
		ch2.onReceive(h2);

		cm.handleInbound({ type: "channel_data", name: "a", data: "for-a" });
		expect(h1).toHaveBeenCalledWith("for-a");
		expect(h2).not.toHaveBeenCalled();

		cm.handleInbound({ type: "channel_data", name: "b", data: "for-b" });
		expect(h2).toHaveBeenCalledWith("for-b");
	});

	describe("call()", () => {
		it("sends payload with __call field and resolves on response", async () => {
			const ch = cm.register("rpc");

			const callPromise = ch.call("config_list", { projectPath: "/foo" }, 5000);

			expect(output).toHaveBeenCalledTimes(1);
			const sent = output.mock.calls[0][0];
			expect(sent.type).toBe("channel_data");
			expect(sent.name).toBe("rpc");
			expect(sent.data.__call).toBe("config_list");
			expect(sent.data.projectPath).toBe("/foo");
			expect(sent.data.invokeId).toMatch(/^inv_/);

			cm.handleInbound({
				type: "channel_data",
				name: "rpc",
				data: { invokeId: sent.data.invokeId, projects: ["a", "b"] },
			});

			const result = await callPromise;
			expect(result).toEqual({ invokeId: sent.data.invokeId, projects: ["a", "b"] });
		});

		it("rejects on timeout", async () => {
			vi.useFakeTimers();
			const ch = cm.register("rpc");
			const promise = ch.call("config_list", {}, 100);

			vi.advanceTimersByTime(150);
			await expect(promise).rejects.toThrow(/timed out/);
			vi.useRealTimers();
		});

		it("uses default timeout when not specified", async () => {
			const ch = cm.register("rpc");
			ch.call("config_list", {});

			expect(output).toHaveBeenCalledTimes(1);
			const sent = output.mock.calls[0][0];
			expect(sent.data.__call).toBe("config_list");
		});
	});

	describe("invokeId format and uniqueness", () => {
		it("invokeId is exactly 12 characters (4 prefix + 8 hex chars)", async () => {
			const ch = cm.register("fmt");
			const promise = ch.invoke({ action: "check" }, 5000);

			const sent = output.mock.calls[0][0];
			expect(sent.data.invokeId).toHaveLength(12);

			cm.handleInbound({
				type: "channel_data",
				name: "fmt",
				data: { invokeId: sent.data.invokeId, ok: true },
			});

			await promise;
		});

		it("hex portion after inv_ contains only hex characters", async () => {
			const ch = cm.register("fmt");
			const promise = ch.invoke({ action: "check" }, 5000);

			const sent = output.mock.calls[0][0];
			expect(sent.data.invokeId).toMatch(/^inv_[0-9a-f]{8}$/);

			cm.handleInbound({
				type: "channel_data",
				name: "fmt",
				data: { invokeId: sent.data.invokeId, ok: true },
			});

			await promise;
		});

		it("consecutive invoke calls produce unique IDs", async () => {
			const ch = cm.register("fmt");
			const ids: string[] = [];

			for (let i = 0; i < 10; i++) {
				const promise = ch.invoke({ action: "check", i }, 5000);
				const sent = output.mock.calls[i][0];
				ids.push(sent.data.invokeId);

				cm.handleInbound({
					type: "channel_data",
					name: "fmt",
					data: { invokeId: sent.data.invokeId, ok: true },
				});

				await promise;
			}

			const uniqueIds = new Set(ids);
			expect(uniqueIds.size).toBe(10);
		});
	});
});
