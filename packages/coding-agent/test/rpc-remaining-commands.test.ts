import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe("RPC remaining commands", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-remaining-test-${Date.now()}`);
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

	test("abort_bash succeeds when no bash is running", async () => {
		await client.start();

		await expect(client.abortBash()).resolves.toBeUndefined();
	}, 30000);

	test("abort_bash kills a running bash process", async () => {
		await client.start();

		const bashPromise = client.bash("sleep 10");
		await new Promise((resolve) => setTimeout(resolve, 200));
		await client.abortBash();

		const result = await bashPromise;
		expect(result.cancelled).toBe(true);
	}, 30000);

	test("abort_retry succeeds when no retry is in progress", async () => {
		await client.start();

		await expect(client.abortRetry()).resolves.toBeUndefined();
	}, 30000);

	test("set_cwd does not throw", async () => {
		await client.start();

		await expect(client.setCwd(tmpdir())).resolves.toBeUndefined();
	}, 30000);

	test("set_flag updates extension flag value", async () => {
		await client.start();

		await client.setFlag("test-flag", true);

		const values = await client.getFlagValues();
		expect(values["test-flag"]).toBe(true);
	}, 30000);

	test("set_flag accepts string value", async () => {
		await client.start();

		await client.setFlag("test-flag-str", "hello");

		const values = await client.getFlagValues();
		expect(values["test-flag-str"]).toBe("hello");
	}, 30000);

	test("get_full_messages returns paginated messages", async () => {
		await client.start();

		const result = await client.getFullMessages();
		expect(Array.isArray(result.messages)).toBe(true);
		expect(typeof result.hasMore).toBe("boolean");
		expect(typeof result.totalCount).toBe("number");
		expect(result.nextCursor).toBeNull();
	}, 30000);

	test("get_full_messages supports limit pagination", async () => {
		await client.start();

		const result = await client.getFullMessages({ limit: 1 });
		expect(result.messages.length).toBeLessThanOrEqual(1);
		expect(typeof result.totalCount).toBe("number");
	}, 30000);

	test("get_full_messages with afterEntryId returns subset", async () => {
		await client.start();

		const all = await client.getFullMessages();
		if (all.messages.length === 0) {
			return;
		}

		const tree = await client.getTree();
		const firstEntry = tree.find((e) => e.type === "message");
		if (!firstEntry) return;

		const paged = await client.getFullMessages({
			afterEntryId: firstEntry.id,
			limit: 10,
		});
		expect(paged.messages.length).toBeLessThanOrEqual(all.messages.length);
	}, 30000);
});
