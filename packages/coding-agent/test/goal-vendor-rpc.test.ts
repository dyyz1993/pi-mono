/**
 * Real-RPC integration test for the goal-vendor "goal" channel.
 *
 * Spawns a genuine `pi --mode rpc` subprocess (dist/cli.js) with
 * -ne (no auto-discovery) + -e goal-vendor, then exercises channel
 * methods over the JSONL channel_data transport. No API key needed —
 * channel handlers do not invoke the model.
 *
 * This validates the full path: extension load -> channel registration
 * -> session_start -> JSONL channel_data call -> handler -> response.
 */

import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const codingAgentDir = join(__dirname, "..");
const distCli = join(codingAgentDir, "dist", "cli.js");
const goalVendorPath = join(codingAgentDir, "extensions", "goal-vendor");

describe.skipIf(!existsSync(distCli))("goal-vendor RPC channel (real subprocess)", () => {
	let client: RpcClient;

	beforeAll(async () => {
		client = new RpcClient({
			cliPath: distCli,
			cwd: codingAgentDir,
			args: ["-ne", "-e", goalVendorPath, "--offline"],
		});
		await client.start();
	});

	afterAll(async () => {
		await client.stop();
	});

	test("getStatus returns idle when no goal is active", async () => {
		const status = (await client.channel("goal").call("getStatus", {}, 15000)) as Record<string, unknown>;
		expect(status.state).toBe("idle");
		expect(status.enabled).toBe(true);
		expect(status.rawStatus).toBe("none");
	});

	test("disable toggles enabled to false", async () => {
		const result = (await client.channel("goal").call("disable", {}, 10000)) as Record<string, unknown>;
		expect(result.disabled).toBe(true);

		const status = (await client.channel("goal").call("getStatus", {}, 10000)) as Record<string, unknown>;
		expect(status.enabled).toBe(false);
		expect(status.state).toBe("disabled");
	});

	test("enable restores enabled to true", async () => {
		await client.channel("goal").call("disable", {}, 10000);
		const result = (await client.channel("goal").call("enable", {}, 10000)) as Record<string, unknown>;
		expect(result.enabled).toBe(true);

		const status = (await client.channel("goal").call("getStatus", {}, 10000)) as Record<string, unknown>;
		expect(status.enabled).toBe(true);
	});

	test("getTaskReport returns empty array when no goal", async () => {
		const result = (await client.channel("goal").call("getTaskReport", {}, 10000)) as Record<string, unknown>;
		expect(result.tasks).toEqual([]);
	});

	test("getTriggerHistory returns empty array when no events", async () => {
		const result = (await client.channel("goal").call("getTriggerHistory", {}, 10000)) as Record<string, unknown>;
		expect(result.triggers).toEqual([]);
	});

	test("approveContract fails gracefully with no active goal", async () => {
		const result = (await client.channel("goal").call("approveContract", {}, 10000)) as Record<string, unknown>;
		expect(result.approved).toBe(false);
		expect(result.error).toBeDefined();
	});

	test("clearGoal returns cleared=false with no goal", async () => {
		const result = (await client.channel("goal").call("clearGoal", {}, 10000)) as Record<string, unknown>;
		expect(result.cleared).toBe(false);
	});

	test("forceContinue returns triggered=false with no active goal", async () => {
		const result = (await client.channel("goal").call("forceContinue", {}, 10000)) as Record<string, unknown>;
		expect(result.triggered).toBe(false);
	});
});
