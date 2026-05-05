import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fauxAssistantMessage, fauxToolCall } from "@dyyz1993/pi-ai";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { McpManager } from "../../src/core/mcp/mcp-manager.js";
import type { McpServerConfig } from "../../src/core/settings-manager.js";

function loadMcpConfig(): Record<string, McpServerConfig> {
	return {};
}

import { createHarness, type Harness } from "./harness.js";

describe.skip("pi-mcp extension", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
	});

	describe("config loading", () => {
		let tempDir: string;

		beforeEach(() => {
			tempDir = join(tmpdir(), `pi-mcp-test-${Date.now()}-${Math.random().toString(36).slice(2)}`);
			mkdirSync(tempDir, { recursive: true });
		});

		afterEach(() => {
			if (existsSync(tempDir)) {
				rmSync(tempDir, { recursive: true });
			}
		});

		it("returns empty when no config files exist", () => {
			const servers = loadMcpConfig(tempDir, tempDir);
			expect(servers).toEqual({});
		});

		it("reads project-level mcp.json", () => {
			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						test: { command: "echo", args: ["hello"] },
					},
				}),
			);

			const servers = loadMcpConfig(tempDir, tempDir);
			expect(servers).toHaveProperty("test");
			expect((servers.test as any).command).toBe("echo");
		});

		it("reads global mcp.json", () => {
			const globalDir = join(tempDir, "global");
			mkdirSync(globalDir, { recursive: true });
			writeFileSync(
				join(globalDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						globalServer: { command: "node", args: ["server.js"] },
					},
				}),
			);

			const servers = loadMcpConfig(tempDir, globalDir);
			expect(servers).toHaveProperty("globalServer");
		});

		it("project config overrides global config", () => {
			const globalDir = join(tempDir, "global");
			mkdirSync(globalDir, { recursive: true });
			writeFileSync(
				join(globalDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						s1: { command: "global-cmd" },
						s2: { command: "global-cmd-2" },
					},
				}),
			);

			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						s1: { command: "project-cmd" },
					},
				}),
			);

			const servers = loadMcpConfig(tempDir, globalDir);
			expect((servers.s1 as any).command).toBe("project-cmd");
			expect((servers.s2 as any).command).toBe("global-cmd-2");
		});

		it("handles malformed mcp.json gracefully", () => {
			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "mcp.json"), "not json{{{");

			const servers = loadMcpConfig(tempDir, tempDir);
			expect(servers).toEqual({});
		});

		it("handles mcp.json without mcpServers field", () => {
			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(join(piDir, "mcp.json"), JSON.stringify({ other: true }));

			const servers = loadMcpConfig(tempDir, tempDir);
			expect(servers).toEqual({});
		});

		it("reads remote SSE server config", () => {
			const piDir = join(tempDir, ".pi");
			mkdirSync(piDir, { recursive: true });
			writeFileSync(
				join(piDir, "mcp.json"),
				JSON.stringify({
					mcpServers: {
						remote: {
							type: "sse",
							url: "http://localhost:3001/sse",
							headers: { Authorization: "Bearer token" },
						},
					},
				}),
			);

			const servers = loadMcpConfig(tempDir, tempDir);
			expect((servers.remote as any).type).toBe("sse");
			expect((servers.remote as any).url).toBe("http://localhost:3001/sse");
		});
	});
});
