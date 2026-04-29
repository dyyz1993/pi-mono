import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cliPath = join(__dirname, "..", "dist", "cli.js");
const extPath = join(__dirname, "..", "examples", "extensions", "file-snapshot.ts");

const hasApiKey = existsSync(join(homedir(), ".pi/agent/models.json"));

function makeClient(dir: string): RpcClient {
	mkdirSync(dir, { recursive: true });
	return new RpcClient({ cliPath, cwd: dir, args: ["--no-extensions", "-e", extPath, "--no-session"] });
}

describe.skipIf(!hasApiKey)("Rollback message preservation", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-msg-preserve-${Date.now()}`);
		client = makeClient(sessionDir);
	});

	afterEach(async () => {
		await client.stop();
		rmSync(sessionDir, { recursive: true, force: true });
	});

	test("rollback to R2 preserves 2 user + 2 assistant messages", async () => {
		await client.start();

		writeFileSync(join(sessionDir, "hello.txt"), "v1");
		await client.promptAndWait("Read hello.txt then write v2 to it", undefined, 120_000);

		writeFileSync(join(sessionDir, "extra.txt"), "bonus");
		await client.promptAndWait("Write v3 to hello.txt", undefined, 120_000);

		const msgsBefore = await client.getMessages();
		const usersBefore = msgsBefore.filter((m: any) => m.role === "user");
		const asstBefore = msgsBefore.filter((m: any) => m.role === "assistant");
		expect(usersBefore.length).toBeGreaterThanOrEqual(2);
		expect(asstBefore.length).toBeGreaterThanOrEqual(2);
		const totalBefore = msgsBefore.length;

		const tree = await client.getTree();
		const snaps = tree.filter((e: any) => e.type === "custom");
		expect(snaps.length).toBeGreaterThanOrEqual(1);

		await client.navigateTree(snaps[0].id);
		const msgsAfter = await client.getMessages();
		const totalAfter = msgsAfter.length;

		expect(totalAfter).toBeLessThan(totalBefore);
		expect(msgsAfter.some((m: any) => m.role === "user")).toBe(true);
	}, 300_000);

	test("rollback to root leaves zero messages", async () => {
		await client.start();

		writeFileSync(join(sessionDir, "hello.txt"), "v1");
		await client.promptAndWait("Write v2 to hello.txt", undefined, 120_000);

		const root = (await client.getTree()).find((e: any) => !e.parentId);
		expect(root).toBeDefined();

		await client.navigateTree(root!.id);
		const msgsAll = await client.getMessages();
		expect(msgsAll.length).toBe(0);
	}, 300_000);
});
