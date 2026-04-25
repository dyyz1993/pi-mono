import { existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { RpcClient } from "../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

describe.skipIf(!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_OAUTH_TOKEN)("RPC resource queries", () => {
	let client: RpcClient;
	let sessionDir: string;

	beforeEach(() => {
		sessionDir = join(tmpdir(), `pi-rpc-resources-test-${Date.now()}`);
		client = new RpcClient({
			cliPath: join(__dirname, "..", "dist", "cli.js"),
			cwd: join(__dirname, ".."),
			env: { PI_CODING_AGENT_DIR: sessionDir },
			provider: "anthropic",
			model: "claude-sonnet-4-5",
		});
	});

	afterEach(async () => {
		await client.stop();
		if (sessionDir && existsSync(sessionDir)) {
			rmSync(sessionDir, { recursive: true });
		}
	});

	test("get_skills returns array", async () => {
		await client.start();
		const skills = await client.getSkills();
		expect(Array.isArray(skills)).toBe(true);
		for (const skill of skills) {
			expect(skill).toHaveProperty("name");
			expect(skill).toHaveProperty("description");
			expect(skill).toHaveProperty("filePath");
			expect(skill).toHaveProperty("baseDir");
			expect(skill).toHaveProperty("sourceInfo");
			expect(skill).toHaveProperty("disableModelInvocation");
		}
	}, 30000);

	test("get_extensions returns array", async () => {
		await client.start();
		const extensions = await client.getExtensions();
		expect(Array.isArray(extensions)).toBe(true);
		for (const ext of extensions) {
			expect(ext).toHaveProperty("path");
			expect(ext).toHaveProperty("resolvedPath");
			expect(ext).toHaveProperty("sourceInfo");
			expect(ext).toHaveProperty("toolNames");
			expect(ext).toHaveProperty("commandNames");
			expect(Array.isArray(ext.toolNames)).toBe(true);
			expect(Array.isArray(ext.commandNames)).toBe(true);
		}
	}, 30000);

	test("get_tools returns array", async () => {
		await client.start();
		const tools = await client.getTools();
		expect(Array.isArray(tools)).toBe(true);
		for (const tool of tools) {
			expect(tool).toHaveProperty("name");
			expect(tool).toHaveProperty("label");
			expect(tool).toHaveProperty("description");
			expect(tool).toHaveProperty("sourceInfo");
		}
	}, 30000);
});
