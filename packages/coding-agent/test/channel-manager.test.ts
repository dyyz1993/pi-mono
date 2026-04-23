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
});
