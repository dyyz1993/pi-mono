import { describe, expect, it, vi } from "vitest";
import type {
	ChannelContract,
	EventKeys,
	MethodKeys,
	MethodParams,
	MethodReturn,
} from "../../src/core/extensions/server-channel.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";

interface TestContract extends ChannelContract {
	methods: {
		add: { params: { a: number; b: number }; return: { sum: number } };
		greet: { params: { name: string }; return: { greeting: string } };
	};
	events: {
		progress: { percent: number };
		done: { result: string };
	};
}

function createMockChannel() {
	const handlers = new Set<(data: unknown) => void>();
	return {
		name: "test",
		sentMessages: [] as unknown[],
		send(data: unknown) {
			this.sentMessages.push(data);
		},
		onReceive(handler: (data: unknown) => void) {
			handlers.add(handler);
			return () => handlers.delete(handler);
		},
		invoke(_data: unknown, _timeoutMs?: number) {
			return Promise.resolve({});
		},
		call(_method: string, _params: Record<string, unknown>, _timeoutMs?: number) {
			return Promise.resolve({});
		},
		deliverToHandlers(data: unknown) {
			for (const h of handlers) h(data);
		},
	};
}

type MockChannel = ReturnType<typeof createMockChannel>;

describe("ServerChannel", () => {
	describe("constructor", () => {
		it("should register an onReceive handler on the raw channel", () => {
			const raw = createMockChannel();
			new ServerChannel<TestContract>(raw);
			expect(raw.sentMessages).toHaveLength(0);
		});

		it("should ignore messages without __call", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("add", ({ a, b }) => ({ sum: a + b }));
			raw.deliverToHandlers({ someField: "value" });

			expect(raw.sentMessages).toHaveLength(0);
		});
	});

	describe("handle", () => {
		it("should register a handler and respond to calls", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("add", ({ a, b }) => ({ sum: a + b }));

			raw.deliverToHandlers({ __call: "add", a: 3, b: 5, invokeId: "inv_123" });

			expect(raw.sentMessages).toHaveLength(1);
			expect(raw.sentMessages[0]).toEqual({ sum: 8, invokeId: "inv_123" });
		});

		it("should handle greet method", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("greet", ({ name }) => ({ greeting: `Hello, ${name}!` }));

			raw.deliverToHandlers({ __call: "greet", name: "World", invokeId: "inv_abc" });

			expect(raw.sentMessages[0]).toEqual({ greeting: "Hello, World!", invokeId: "inv_abc" });
		});

		it("should not respond if no invokeId is present", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("add", ({ a, b }) => ({ sum: a + b }));

			raw.deliverToHandlers({ __call: "add", a: 1, b: 2 });

			expect(raw.sentMessages).toHaveLength(0);
		});

		it("should not respond if no handler registered for the method", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			raw.deliverToHandlers({ __call: "add", a: 1, b: 2, invokeId: "inv_x" });

			expect(raw.sentMessages).toHaveLength(0);
		});

		it("should handle async handlers", async () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("add", async ({ a, b }) => {
				await Promise.resolve();
				return { sum: a + b };
			});

			raw.deliverToHandlers({ __call: "add", a: 10, b: 20, invokeId: "inv_async" });

			await Promise.resolve();
			await Promise.resolve();

			expect(raw.sentMessages).toHaveLength(1);
			expect(raw.sentMessages[0]).toEqual({ sum: 30, invokeId: "inv_async" });
		});

		it("should overwrite handler when registered twice for same method", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("add", ({ a, b }) => ({ sum: a + b }));
			server.handle("add", ({ a, b }) => ({ sum: a * b }));

			raw.deliverToHandlers({ __call: "add", a: 3, b: 5, invokeId: "inv_overwrite" });

			expect(raw.sentMessages).toHaveLength(1);
			expect(raw.sentMessages[0]).toEqual({ sum: 15, invokeId: "inv_overwrite" });
		});

		it("should handle null/undefined result with invokeId", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.handle("greet", () => null as unknown as { greeting: string });

			raw.deliverToHandlers({ __call: "greet", name: "test", invokeId: "inv_null" });

			expect(raw.sentMessages).toHaveLength(1);
			expect(raw.sentMessages[0]).toEqual({ invokeId: "inv_null" });
		});
	});

	describe("emit", () => {
		it("should send event data through the raw channel", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.emit("progress", { percent: 50 });

			expect(raw.sentMessages).toHaveLength(1);
			expect(raw.sentMessages[0]).toEqual({ percent: 50 });
		});

		it("should emit done event", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.emit("done", { result: "success" });

			expect(raw.sentMessages[0]).toEqual({ result: "success" });
		});

		it("should emit multiple events", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			server.emit("progress", { percent: 25 });
			server.emit("progress", { percent: 50 });
			server.emit("done", { result: "complete" });

			expect(raw.sentMessages).toHaveLength(3);
		});
	});

	describe("raw_", () => {
		it("should return the raw channel", () => {
			const raw = createMockChannel();
			const server = new ServerChannel<TestContract>(raw);

			expect(server.raw_).toBe(raw);
		});
	});

	describe("type utilities", () => {
		it("MethodKeys should extract method names", () => {
			type Keys = MethodKeys<TestContract>;
			const keys: Keys[] = ["add", "greet"];
			expect(keys).toContain("add");
			expect(keys).toContain("greet");
		});

		it("MethodParams should extract params type", () => {
			type AddParams = MethodParams<TestContract, "add">;
			const params: AddParams = { a: 1, b: 2 };
			expect(params.a + params.b).toBe(3);
		});

		it("MethodReturn should extract return type", () => {
			type AddReturn = MethodReturn<TestContract, "add">;
			const result: AddReturn = { sum: 42 };
			expect(result.sum).toBe(42);
		});

		it("EventKeys should extract event names", () => {
			type Keys = EventKeys<TestContract>;
			const keys: Keys[] = ["progress", "done"];
			expect(keys).toContain("progress");
			expect(keys).toContain("done");
		});
	});
});
