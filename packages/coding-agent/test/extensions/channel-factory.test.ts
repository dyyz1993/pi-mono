import { describe, expect, it } from "vitest";
import { createTypedChannel, defineChannel } from "../../src/core/extensions/channel-factory.js";
import type { Channel } from "../../src/core/extensions/channel-types.js";
import { ClientChannel } from "../../src/core/extensions/client-channel.js";
import type { ChannelContract } from "../../src/core/extensions/server-channel.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";

interface TestContract extends ChannelContract {
	methods: {
		echo: { params: { msg: string }; return: { echo: string } };
	};
	events: {
		notify: { text: string };
	};
}

function createMockChannel(): Channel {
	return {
		name: "test",
		send: () => {},
		onReceive: () => () => {},
		invoke: () => Promise.resolve({}),
		call: () => Promise.resolve({}),
	};
}

describe("defineChannel", () => {
	it("should return a create function", () => {
		const factory = defineChannel<TestContract>();
		expect(typeof factory.create).toBe("function");
	});

	it("should create a typed channel with server and client", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typed.server).toBeInstanceOf(ServerChannel);
		expect(typed.client).toBeInstanceOf(ClientChannel);
	});

	it("server should have handle method", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typeof typed.server.handle).toBe("function");
	});

	it("server should have emit method", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typeof typed.server.emit).toBe("function");
	});

	it("client should have call method", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typeof typed.client.call).toBe("function");
	});

	it("client should have on method", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typeof typed.client.on).toBe("function");
	});

	it("server should expose raw channel", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typed.server.raw_).toBe(raw);
	});

	it("client should expose raw channel", () => {
		const { create } = defineChannel<TestContract>();
		const raw = createMockChannel();
		const typed = create(raw);

		expect(typed.client.raw_).toBe(raw);
	});

	it("each create call should produce independent instances", () => {
		const { create } = defineChannel<TestContract>();
		const raw1 = createMockChannel();
		const raw2 = createMockChannel();
		const typed1 = create(raw1);
		const typed2 = create(raw2);

		expect(typed1.server).not.toBe(typed2.server);
		expect(typed1.client).not.toBe(typed2.client);
	});
});

describe("createTypedChannel", () => {
	it("should return a typed channel with server and client", () => {
		const raw = createMockChannel();
		const typed = createTypedChannel<TestContract>(raw);

		expect(typed.server).toBeInstanceOf(ServerChannel);
		expect(typed.client).toBeInstanceOf(ClientChannel);
	});

	it("should share the same raw channel between server and client", () => {
		const raw = createMockChannel();
		const typed = createTypedChannel<TestContract>(raw);

		expect(typed.server.raw_).toBe(raw);
		expect(typed.client.raw_).toBe(raw);
	});

	it("should produce equivalent output to defineChannel().create()", () => {
		const raw = createMockChannel();
		const viaFactory = defineChannel<TestContract>().create(raw);
		const viaDirect = createTypedChannel<TestContract>(raw);

		expect(viaFactory.server).toBeInstanceOf(ServerChannel);
		expect(viaDirect.server).toBeInstanceOf(ServerChannel);
		expect(viaFactory.client).toBeInstanceOf(ClientChannel);
		expect(viaDirect.client).toBeInstanceOf(ClientChannel);
	});
});
