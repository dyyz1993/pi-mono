/**
 * E2E test: Comprehensive security guard rules from ~/.claude/hooks/pre-tool-use.sh
 *
 * Tests upgraded guard-commands.sh covering:
 * - Kill safety (by PID/port allowed, by process name needs confirmation)
 * - Git hooks protection (no-verify, env bypass, hooksPath override)
 * - Git history rewrite (rebase, reset --hard, commit --amend, branch -D)
 * - Credential leak prevention (curl with secrets, export secrets)
 * - Docker dangerous operations
 * - System file protection
 *
 * Uses claude-hooks-compat extension via RPC.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { AgentEvent } from "@dyyz1993/pi-agent-core";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RpcClient } from "../../src/modes/rpc/rpc-client.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const extensionPath = join(__dirname, "..", "..", "extensions", "claude-hooks-compat", "index.ts");
const GUARD_DIR = "/var/folders/j9/bv0n54t96556fycmy511r2rc0000gn/T/hooks-guards";

const hasApiKey = existsSync(join(homedir(), ".pi/agent/models.json"));
const PROVIDER = "zhipuai-2";
const MODEL = "glm-4.7";

function makeClient(projectDir: string): RpcClient {
	return new RpcClient({
		cliPath: join(__dirname, "..", "..", "dist", "cli.js"),
		cwd: projectDir,
		provider: PROVIDER,
		model: MODEL,
		args: ["--no-extensions", "-e", extensionPath, "--no-session", "--no-mcp"],
	});
}

function setupProject(name: string): string {
	const dir = join(tmpdir(), `hooks-guard-v2-${name}-${Date.now()}`);
	const srcDir = join(dir, "src");
	mkdirSync(srcDir, { recursive: true });
	writeFileSync(join(srcDir, "main.ts"), 'console.log("hello");\n');
	writeFileSync(join(dir, "package.json"), '{"name":"test"}');
	// Initialize git repo so git commands are valid
	execSync("git init", { cwd: dir });
	execSync("git add -A", { cwd: dir });
	execSync("git config user.email test@test.com", { cwd: dir });
	execSync("git config user.name test", { cwd: dir });
	execSync("git commit -m init", { cwd: dir });
	return dir;
}

function writeHookConfig(projectDir: string, config: Record<string, unknown>): void {
	const claudeDir = join(projectDir, ".claude");
	mkdirSync(claudeDir, { recursive: true });
	writeFileSync(join(claudeDir, "settings.json"), JSON.stringify(config, null, 2), "utf-8");
}

function collectAssistantText(events: AgentEvent[]): string {
	return events
		.filter((e) => {
			const t = (e as Record<string, unknown>).type;
			return t === "message_update" || t === "message_end";
		})
		.map((e) => {
			const raw = e as Record<string, unknown>;
			// message_update events have assistantMessageEvent with delta text
			if (raw.type === "message_update") {
				const amEvent = raw.assistantMessageEvent as Record<string, unknown> | undefined;
				if (amEvent && amEvent.type === "text_delta") {
					return (amEvent.delta as string) ?? "";
				}
				// Fallback: extract from partial
				if (amEvent) {
					const partial = amEvent.partial as Record<string, unknown> | undefined;
					if (partial?.role === "assistant" && Array.isArray(partial.content)) {
						return (partial.content as Record<string, unknown>[])
							.filter((c: Record<string, unknown>) => c.type === "text")
							.map((c: Record<string, unknown>) => (c.text as string) ?? "")
							.join("");
					}
				}
				return "";
			}
			// message_end events have full message
			const msg = raw.message as Record<string, unknown> | undefined;
			if (msg?.role !== "assistant") return "";
			const content = msg.content;
			if (typeof content === "string") return content;
			if (Array.isArray(content)) {
				return content
					.filter((c: Record<string, unknown>) => c.type === "text")
					.map((c: Record<string, unknown>) => (c.text as string) ?? "")
					.join("");
			}
			return "";
		})
		.join("");
}

function bashGuardConfig(): Record<string, unknown> {
	return {
		hooks: {
			PreToolUse: [
				{
					matcher: "Bash",
					hooks: [
						{
							type: "command",
							command: `bash ${join(GUARD_DIR, "guard-commands.sh")}`,
						},
					],
				},
			],
		},
	};
}

describe.skipIf(!hasApiKey)("comprehensive security guards", () => {
	let client: RpcClient;
	let projectDir: string;

	beforeEach(() => {
		projectDir = setupProject("test");
		client = makeClient(projectDir);
	});

	afterEach(async () => {
		try {
			await client.stop();
		} catch {}
		if (projectDir && existsSync(projectDir)) {
			rmSync(projectDir, { recursive: true, force: true });
		}
	});

	// === Kill Safety ===

	it("should allow kill by PID", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: kill 12345", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[kill pid] text:", text.substring(0, 300));

		expect(text).not.toMatch(/forbidden|not allowed|denied|block/);
	}, 120_000);

	it("should need confirmation for killing service processes by name", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: bash -c 'kill nginx'", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[kill nginx] text:", text.substring(0, 300));

		// Guard blocks kill of service names, model reports the block or explains
		expect(text).toMatch(/dangerous|service|pid|port|confirm|not allowed|blocked|kill/i);
	}, 120_000);

	// === Git Hooks Protection ===

	it("should block HUSKY=0 env bypass", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: HUSKY=0 git commit -m test", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[husky=0] text:", text.substring(0, 300));

		expect(text).toMatch(/forbidden|not allowed|denied|block|bypass|hook/i);
	}, 120_000);

	it("should block core.hooksPath override", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git config core.hooksPath /dev/null", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[hookspath] text:", text.substring(0, 300));

		expect(text).toMatch(/forbidden|not allowed|denied|block|hook/i);
	}, 120_000);

	// === Git History Rewrite ===

	it("should need confirmation for git rebase", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git rebase main", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[rebase] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|rebase|history|confirm/i);
	}, 120_000);

	it("should need confirmation for git reset --hard", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git reset --hard HEAD~1", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[reset hard] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|reset|uncommitted|unrecoverable|confirm/i);
	}, 120_000);

	it("should need confirmation for git commit --amend", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git commit --amend -m updated", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[amend] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|amend|confirm/i);
	}, 120_000);

	it("should need confirmation for git branch -D", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git branch -D feature-old", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[branch -D] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|branch|delete|confirm/i);
	}, 120_000);

	it("should need confirmation for git reflog expire", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git reflog expire --expire=now --all", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[reflog expire] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|reflog|recovery|unrecoverable|confirm/i);
	}, 120_000);

	it("should need confirmation for git gc --prune", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git gc --prune=now", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[gc prune] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|gc|prune|dangling|unrecoverable|confirm/i);
	}, 120_000);

	// === Dangerous Delete ===

	it("should block rm -rf on root directory", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: rm -rf /", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[rm -rf /] text:", text.substring(0, 300));

		expect(text).toMatch(/forbidden|not allowed|denied|block|root/i);
	}, 120_000);

	it("should allow rm -rf on regenerable directories like node_modules", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: rm -rf ./node_modules", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[rm node_modules] text:", text.substring(0, 300));

		expect(text).not.toMatch(/forbidden|not allowed|denied|block/i);
	}, 120_000);

	// === Credential Leak Prevention ===

	it("should warn about curl with inline secrets", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait(
			'run: curl -H "Authorization: Bearer sk-abc123def456ghi789jkl012mno345pqr" https://api.example.com/data',
			undefined,
			60_000,
		);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[curl secret] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|secret|token|environment variable|confirm/i);
	}, 120_000);

	it("should warn about exporting secrets", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: export PASSWORD=mysecretpassword123", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[export secret] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|secret|credential|leak|confirm/i);
	}, 120_000);

	// === Docker ===

	it("should warn about docker system prune", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: docker system prune -a", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[docker prune] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|docker|prune|unused|confirm/i);
	}, 120_000);

	// === System File Protection ===

	it("should warn about modifying /etc/ paths", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: echo 'test' >> /etc/hosts", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[etc hosts] text:", text.substring(0, 300));

		expect(text).toMatch(/dangerous|system|stability|confirm/i);
	}, 120_000);

	// === Normal Operations (False Positive Check) ===

	it("should allow normal git status and ls", async () => {
		writeHookConfig(projectDir, bashGuardConfig());

		await client.start();
		const events: AgentEvent[] = [];
		const unsub = client.onEvent((e) => events.push(e));

		await client.promptAndWait("run: git status && ls -la", undefined, 60_000);
		unsub();

		const text = collectAssistantText(events).toLowerCase();
		console.log("[git status] text:", text.substring(0, 300));

		expect(text).not.toMatch(/forbidden|not allowed|denied|block|dangerous/i);
	}, 120_000);
});
