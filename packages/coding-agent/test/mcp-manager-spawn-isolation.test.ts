/**
 * Tests: stdio MCP server spawn isolation (fix for issue #183).
 *
 * Bug: stdio MCP servers launched via `npx -y <pkg>` failed with
 *   `npm error code EOVERRIDE: Override for ... conflicts with direct dependency`
 * because `createTransport` spawned with the agent process's cwd (the consuming
 * project dir). npm walked up from that cwd, found the project's `package.json`
 * `overrides` field + `.yalc` link, and aborted the install.
 *
 * Fix: `buildStdioTransportOptions` now
 *   - defaults `cwd` to `os.tmpdir()` (npm's upward walk finds no overrides),
 *     honoring `config.cwd` when set;
 *   - scrubs `npm_config_*` / `NPM_CONFIG_*` env vars from the merged env.
 *
 * This test targets the pure options builder (no real spawn / no SDK mock).
 */
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { buildStdioTransportOptions } from "../src/core/mcp/mcp-manager.ts";
import type { McpStdioServerConfig } from "../src/core/mcp/types.ts";

describe("buildStdioTransportOptions — stdio MCP spawn isolation", () => {
	const originalEnv = { ...process.env };

	afterEach(() => {
		// Restore process.env so injected npm_config vars don't leak across tests.
		process.env = { ...originalEnv };
	});

	it("defaults cwd to os.tmpdir() when config.cwd is unset (root-cause fix for EOVERRIDE)", () => {
		const config: McpStdioServerConfig = {
			command: "npx",
			args: ["-y", "@z_ai/mcp-server"],
		};
		const opts = buildStdioTransportOptions(config);
		expect(opts.cwd).toBe(os.tmpdir());
		expect(opts.command).toBe("npx");
		expect(opts.args).toEqual(["-y", "@z_ai/mcp-server"]);
		expect(opts.stderr).toBe("pipe");
	});

	it("honors config.cwd when explicitly set (field is no longer dead)", () => {
		const config: McpStdioServerConfig = {
			command: "node",
			args: ["server.js"],
			cwd: "/custom/mcp/workdir",
		};
		const opts = buildStdioTransportOptions(config);
		expect(opts.cwd).toBe("/custom/mcp/workdir");
	});

	it("returns env=undefined when config.env is absent (lets SDK use its safe allowlist)", () => {
		const config: McpStdioServerConfig = { command: "npx", args: ["-y", "pkg"] };
		const opts = buildStdioTransportOptions(config);
		expect(opts.env).toBeUndefined();
	});

	it("scrubs npm_config_* / NPM_CONFIG_* from the merged env while preserving user env", () => {
		process.env.npm_config_override_foo = "should-be-stripped";
		process.env.NPM_CONFIG_REGISTRY = "https://should-be-stripped.example";
		process.env.Z_AI_API_KEY = "inherited-from-parent";

		const config: McpStdioServerConfig = {
			command: "npx",
			args: ["-y", "@z_ai/mcp-server"],
			env: {
				Z_AI_MODE: "ZHIPU",
				Z_AI_API_KEY: "from-config-wins",
			},
		};
		const opts = buildStdioTransportOptions(config);
		const env = opts.env as Record<string, string>;

		// npm config vars stripped (both casings)
		expect(env.npm_config_override_foo).toBeUndefined();
		expect(env.NPM_CONFIG_REGISTRY).toBeUndefined();

		// User's per-server env preserved, overriding inherited
		expect(env.Z_AI_MODE).toBe("ZHIPU");
		expect(env.Z_AI_API_KEY).toBe("from-config-wins");

		// Non-npm inherited env preserved
		expect(env.HOME).toBe(process.env.HOME);
	});
});
