/**
 * Tests for ClientChannel and ServerChannel type safety and runtime behavior.
 */

import { describe, expect, it } from "vitest";
import { ClientChannel } from "../src/core/extensions/client-channel.js";
import type { ChannelContract } from "../src/core/extensions/server-channel.js";
import { ServerChannel } from "../src/core/extensions/server-channel.js";

// Define a test contract
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

// Mock Channel for testing
class MockChannel {
	name = "test-channel";
	sentMessages: unknown[] = [];
	handlers = new Set<(data: unknown) => void>();

	send(data: unknown): void {
		this.sentMessages.push(data);
		// Also notify all handlers (simulating real channel behavior)
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
			// Simulate response after processing
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

	// Emit events to handlers
	emit(eventData: unknown): void {
		for (const handler of this.handlers) {
			handler(eventData);
		}
	}
}

describe("ClientChannel", () => {
	describe("type-safe method calls", () => {
		it("should call 'add' method with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			// This should compile with correct types
			const result = await client.call("add", { a: 5, b: 3 });

			// Type assertion
			expect(result).toEqual({ result: 8 });
		});

		it("should call 'multiply' method with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			const result = await client.call("multiply", { x: 4, y: 7 });

			expect(result).toEqual({ product: 28 });
		});

		it("should include __call in the sent message", async () => {
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
		it("should subscribe to 'progress' event with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let receivedProgress: TestContract["events"]["progress"] | null = null;

			client.on("progress", (data) => {
				receivedProgress = data;
			});

			// Simulate server sending a progress event
			mockChannel.emit({ percent: 50, message: "Half done" });

			expect(receivedProgress).toEqual({ percent: 50, message: "Half done" });
		});

		it("should subscribe to 'completed' event with correct types", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let receivedCompleted: TestContract["events"]["completed"] | null = null;

			client.on("completed", (data) => {
				receivedCompleted = data;
			});

			// Simulate server sending a completed event
			mockChannel.emit({ taskId: "task-123", duration: 1234 });

			expect(receivedCompleted).toEqual({ taskId: "task-123", duration: 1234 });
		});

		it("should return unsubscribe function", async () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			let callCount = 0;
			const unsub = client.on("progress", () => {
				callCount++;
			});

			// Emit 3 events
			mockChannel.emit({ percent: 10, message: "First" });
			mockChannel.emit({ percent: 20, message: "Second" });
			mockChannel.emit({ percent: 30, message: "Third" });

			expect(callCount).toBe(3);

			// Unsubscribe
			unsub();

			// Emit more events
			mockChannel.emit({ percent: 40, message: "Fourth" });
			mockChannel.emit({ percent: 50, message: "Fifth" });

			expect(callCount).toBe(3); // Should still be 3
		});

		it("should allow multiple handlers for the same event", async () => {
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
		it("should provide access to underlying channel", () => {
			const mockChannel = new MockChannel();
			const client = new ClientChannel<TestContract>(mockChannel);

			expect(client.raw_).toBe(mockChannel);
		});
	});
});

describe("ServerChannel + ClientChannel integration", () => {
	it("should work together for RPC calls", async () => {
		const mockChannel = new MockChannel();
		const server = new ServerChannel<TestContract>(mockChannel);
		const client = new ClientChannel<TestContract>(mockChannel);

		// Server-side handler
		server.handle("add", ({ a, b }) => {
			return { result: a + b };
		});

		server.handle("multiply", ({ x, y }) => {
			return { product: x * y };
		});

		// Client-side calls
		const addResult = await client.call("add", { a: 10, b: 20 });
		expect(addResult).toEqual({ result: 30 });

		const mulResult = await client.call("multiply", { x: 3, y: 4 });
		expect(mulResult).toEqual({ product: 12 });
	});

	it("should work together for events", async () => {
		const mockChannel = new MockChannel();
		const server = new ServerChannel<TestContract>(mockChannel);
		const client = new ClientChannel<TestContract>(mockChannel);

		let clientReceived: TestContract["events"]["progress"] | null = null;

		// Client subscribes
		client.on("progress", (data) => {
			clientReceived = data;
		});

		// Server emits
		server.emit("progress", { percent: 75, message: "Almost there" });

		expect(clientReceived).toEqual({ percent: 75, message: "Almost there" });
	});
});
