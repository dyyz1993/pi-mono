import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCoordinatorHandler, type ProcessManagerApi, TaskStore } from "../../extensions/coordinator/handler.js";
import type { CoordinatorChannelContract } from "../../extensions/coordinator/types.js";
import { ServerChannel } from "../../src/core/extensions/server-channel.js";

class MockChannel {
	name = "coordinator";
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
		const msg = data as Record<string, unknown>;
		return new Promise((resolve) => {
			const interval = setInterval(() => {
				const response = this.sentMessages.find(
					(m) => (m as Record<string, unknown>)?.invokeId === msg.invokeId && m !== msg,
				);
				if (response) {
					clearInterval(interval);
					resolve(response);
				}
			}, 10);
		});
	}

	emit(eventData: unknown): void {
		for (const handler of this.handlers) {
			handler(eventData);
		}
	}
}

function setup(pm: ProcessManagerApi) {
	const tempDir = join(tmpdir(), `test-coord-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(tempDir, { recursive: true });
	const mockChannel = new MockChannel();
	const serverChannel = new ServerChannel<CoordinatorChannelContract>(mockChannel);
	const store = new TaskStore(tempDir);

	createCoordinatorHandler(
		serverChannel,
		pm,
		() => "parent-session",
		() => store,
	);

	return {
		tempDir,
		mockChannel,
		call: async <K extends keyof CoordinatorChannelContract["methods"]>(
			method: K,
			params: CoordinatorChannelContract["methods"][K]["params"],
		): Promise<CoordinatorChannelContract["methods"][K]["return"]> => {
			return new Promise((resolve, reject) => {
				const invokeId = `inv_${Date.now()}_${Math.random()}`;
				const timeout = setTimeout(() => reject(new Error("timeout")), 5000);

				const off = mockChannel.onReceive((data: unknown) => {
					const msg = data as Record<string, unknown>;
					if (msg.invokeId === invokeId && msg.__call === undefined) {
						clearTimeout(timeout);
						off();
						const { invokeId: _, ...result } = msg;
						resolve(result as CoordinatorChannelContract["methods"][K]["return"]);
					}
				});

				mockChannel.send({ __call: method, invokeId, ...params });
			});
		},
	};
}

function createFailingForkPM(): ProcessManagerApi {
	return {
		delegate: vi.fn(async () => ({ sessionId: "s-1", status: "started" as const })),
		delegate_send: vi.fn(async () => ({ delivered: true, targetStatus: "active" as const })),
		delegate_status: vi.fn(async () => ({ status: "idle" as const })),
		delegate_list: vi.fn(async () => []),
		delegate_stop: vi.fn(async () => true),
		delegate_fork: vi.fn(async () => {
			throw new Error("Fork failed: process crashed");
		}),
		delegate_compact_status: vi.fn(async () => ({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 128000, percent: null },
		})),
		delegate_remove: vi.fn(async () => true),
		delegate_clear_stopped: vi.fn(async () => 0),
		delegate_sync: vi.fn(async () => ({
			sessionId: "s-sync-1",
			status: "completed" as const,
			exitCode: 0,
			finalText: "done",
		})),
	};
}

function createSuccessForkPM(): ProcessManagerApi {
	return {
		delegate: vi.fn(async () => ({ sessionId: "s-1", status: "started" as const })),
		delegate_send: vi.fn(async () => ({ delivered: true, targetStatus: "active" as const })),
		delegate_status: vi.fn(async () => ({ status: "idle" as const })),
		delegate_list: vi.fn(async () => []),
		delegate_stop: vi.fn(async () => true),
		delegate_fork: vi.fn(async () => ({
			sessionId: "s-fork-ok",
			status: "started" as const,
		})),
		delegate_compact_status: vi.fn(async () => ({
			isCompacting: false,
			contextUsage: { tokens: null, contextWindow: 128000, percent: null },
		})),
		delegate_remove: vi.fn(async () => true),
		delegate_clear_stopped: vi.fn(async () => 0),
		delegate_sync: vi.fn(async () => ({
			sessionId: "s-sync-1",
			status: "completed" as const,
			exitCode: 0,
			finalText: "done",
		})),
	};
}

const toCleanup: string[] = [];

describe("coordinator delegate_fork error status", () => {
	afterEach(() => {
		while (toCleanup.length > 0) {
			const dir = toCleanup.pop()!;
			try {
				rmSync(dir, { recursive: true, force: true });
			} catch {
				/* ignore */
			}
		}
		vi.restoreAllMocks();
	});

	it("should return status 'error' when delegate_fork throws", async () => {
		const pm = createFailingForkPM();
		const { tempDir, call } = setup(pm);
		toCleanup.push(tempDir);

		const result = await call("session_delegate_fork", {
			sessionId: "source-1",
			task: "fork this task",
			title: "Forked Task",
			projectPath: "/tmp",
		});

		expect(result.status).toBe("error");
		expect(result.error).toContain("Fork failed");
	});

	it("should return status 'error' (not 'already_running') when delegate_fork throws", async () => {
		const pm = createFailingForkPM();
		const { tempDir, call } = setup(pm);
		toCleanup.push(tempDir);

		const result = await call("session_delegate_fork", {
			sessionId: "source-2",
			task: "fork task",
		});

		expect(result.status).not.toBe("already_running");
		expect(result.status).toBe("error");
	});

	it("should return status 'started' on successful fork", async () => {
		const pm = createSuccessForkPM();
		const { tempDir, call } = setup(pm);
		toCleanup.push(tempDir);

		const result = await call("session_delegate_fork", {
			sessionId: "source-3",
			task: "fork this",
			title: "Good Fork",
		});

		expect(result.status).toBe("started");
		expect(result.sessionId).toBe("s-fork-ok");
	});
});
