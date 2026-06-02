/**
 * Tests for ClientChannel and ServerChannel type safety and runtime behavior.
 */

import { describe, expect, it } from "vitest";
import { ClientChannel } from "../src/core/extensions/client-channel.ts";
import type { ChannelContract } from "../src/core/extensions/server-channel.ts";
import { ServerChannel } from "../src/core/extensions/server-channel.ts";

interface TestContract extends ChannelContract {
	methods: {
		add: { params: { a: number; b: number }; return: { result: number } };
		multiply: { params: { x: number; y: number }; return: { product: number } };
	};
	events: {
		progress: { percent: number; message: string };
		completed: { taskId: string; duration: number };
	};
}

class MockChannel {
	name = "test-channel";
	sentMessages: unknown[] = [];
	handlers = new Set<(data: unknown) => void>();

	send(data: unknown): void {
		this.sentMessages.push(data);
		for (const handler of this.handlers) {
			handler(data);
		}
	}

	onReceive(handler: (data: unknown) => void): () => void {
		this.handlers.add(handler);
		return () => {
			this.handlers.delete(handler);
		};
	}

	invoke(data: unknown, _timeoutMs?: number): Promise<unknown> {
		return new Promise((resolve) => {
			const msg = data as Record<string, unknown>;
			if (msg.__call === "add") {
				const params = msg as { a: number; b: number };
				resolve({ result: params.a + params.b });
			} else if (msg.__call === "multiply") {
				const params = msg as { x: number; y: number };
				resolve({ product: params.x * params.y });
			}
		});
	}

	call(method: string, params: Record<string, unknown>, _timeoutMs?: number): Promise<unknown> {
		const payload = { __call: method, ...params };
		this.send(payload);
		return this.invoke(payload);
	}

	emit(eventData: unknown): void {
		for (const handler of this.handlers) {
			handler(eventData);
		}
	}
}

describe("ClientChannel", () => {
	describe("type-safe method calls", () => {
		it("calls 'add' method with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			const result = await client.call("add", { a: 5, b: 3 });

			expect(result).toEqual({ result: 8 });
		});

		it("calls 'multiply' method with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			const result = await client.call("multiply", { x: 4, y: 7 });

			expect(result).toEqual({ product: 28 });
		});

		it("includes __call in the sent message", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			await client.call("add", { a: 1, b: 2 });

			expect(mockChannel.sentMessages).toHaveLength(1);
			const sent = mockChannel.sentMessages[0] as Record<string, unknown>;
			expect(sent.__call).toBe("add");
			expect(sent.a).toBe(1);
			expect(sent.b).toBe(2);
		});
	});

	describe("type-safe event subscription", () => {
		it("subscribes to 'progress' event with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let receivedProgress: TestContract["events"]["progress"] | null = null;

			client.on("progress", (data) => {
				receivedProgress = data;
			});

			mockChannel.emit({ percent: 50, message: "Half done" });

			expect(receivedProgress).toEqual({ percent: 50, message: "Half done" });
		});

		it("subscribes to 'completed' event with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let receivedCompleted: TestContract["events"]["completed"] | null = null;

			client.on("completed", (data) => {
				receivedCompleted = data;
			});

			mockChannel.emit({ taskId: "task-123", duration: 1234 });

			expect(receivedCompleted).toEqual({ taskId: "task-123", duration: 1234 });
		});

		it("returns unsubscribe function", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let callCount = 0;
			const unsub = client.on("progress", () => {
				callCount++;
			});

			mockChannel.emit({ percent: 10, message: "First" });
			mockChannel.emit({ percent: 20, message: "Second" });
			mockChannel.emit({ percent: 30, message: "Third" });

			expect(callCount).toBe(3);

			unsub();

			mockChannel.emit({ percent: 40, message: "Fourth" });
			mockChannel.emit({ percent: 50, message: "Fifth" });

			expect(callCount).toBe(3);
		});

		it("allows multiple handlers for the same event", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			const results: number[] = [];

			client.on("progress", () => results.push(1));
			client.on("progress", () => results.push(2));
			client.on("progress", () => results.push(3));

			mockChannel.emit({ percent: 100, message: "Done" });

			expect(results).toEqual([1, 2, 3]);
		});
	});

	describe("raw channel access", () => {
		it("provides access to underlying channel", () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			expect(client.raw_).toBe(mockChannel);
		});
	});
});

describe("ServerChannel + ClientChannel integration", () => {
	it("works together for RPC calls", async () => {
		const mockChannel = new MockChannel();
		const server = new ServerChannel<TestContract>(mockChannel);
		const client = new ClientChannel<TestContract>(mockChannel);

		server.handle("add", ({ a, b }) => {
			return { result: a + b };
		});

		server.handle("multiply", ({ x, y }) => {
			return { product: x * y };
		});

		const addResult = await client.call("add", { a: 10, b: 20 });
		expect(addResult).toEqual({ result: 30 });

		const mulResult = await client.call("multiply", { x: 3, y: 4 });
		expect(mulResult).toEqual({ product: 12 });
	});

	it("works together for events", async () => {
		const mockChannel = new MockChannel();
		const server = new ServerChannel<TestContract>(mockChannel);
		const client = new ClientChannel<TestContract>(mockChannel);

		let clientReceived: TestContract["events"]["progress"] | null = null;

		client.on("progress", (data) => {
			clientReceived = data;
		});

		server.emit("progress", { percent: 75, message: "Almost there" });

		expect(clientReceived).toEqual({ percent: 75, message: "Almost there" });
	});
});
