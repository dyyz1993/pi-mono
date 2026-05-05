import { beforeEach, describe, expect, it, vi } from "vitest";
import { ChannelManager } from "../src/core/extensions/channel-manager.js";

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
