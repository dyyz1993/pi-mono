import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("RPC core commands", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-core-test-${Date.now()}`);
		client = new RpcClient({
			cliPath: join(__dirname, "..", "dist", "cli.js"),
			cwd: join(__dirname, ".."),
			env: { PI_CODING_AGENT_DIR: sessionDir },
		});
	});

	afterEach(async () => {
		await client.stop();
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	test("steer sends mid-stream message", async () => {
		await client.start();

		await client.steer("adjust direction");

		const state = await client.getState();
		expect(state).toBeDefined();
	}, 30000);

	test("abort stops current stream", async () => {
		await client.start();

		const stateBefore = await client.getState();
		expect(stateBefore.isStreaming).toBe(false);

		await client.abort();

		const stateAfter = await client.getState();
		expect(stateAfter.isStreaming).toBe(false);
	}, 30000);

	test("cycle_model switches to next model", async () => {
		await client.start();

		const initialState = await client.getState();
		expect(initialState.model).toBeDefined();

		const result = await client.cycleModel();

		if (result) {
			expect(result.model).toBeDefined();
			expect(result.model.provider).toBeDefined();
			expect(result.model.id).toBeDefined();
			expect(typeof result.thinkingLevel).toBe("string");
			expect(typeof result.isScoped).toBe("boolean");

			const newState = await client.getState();
			expect(newState.model?.id).toBe(result.model.id);
			expect(newState.model?.provider).toBe(result.model.provider);
		}
	}, 30000);
});
