import { describe, expect, it } from "vitest";
import type {
	McpServerConfig,
	McpSettings,
	McpSseServerConfig,
	McpStdioServerConfig,
	Settings,
} from "../../src/core/settings-manager.js";

describe("MCP config types and settings integration", () => {
	it("Settings interface accepts mcp field", () => {
		const settings: Settings = {
			mcp: {
				servers: {
					myServer: { command: "node", args: ["server.js"] },
				},
			},
		};
		expect(settings.mcp?.servers).toBeDefined();
	});

	it("McpSettings contains servers Record", () => {
		const mcp: McpSettings = {
			servers: {
				stdio1: { command: "echo" },
				sse1: { type: "sse", url: "http://localhost/sse" },
			},
		};
		expect(Object.keys(mcp.servers!)).toHaveLength(2);
	});

	it("McpStdioServerConfig requires command", () => {
		const config: McpStdioServerConfig = {
			command: "npx",
			args: ["-y", "some-mcp-server"],
			env: { API_KEY: "test" },
			cwd: "/tmp",
			disabled: false,
		};
		expect(config.command).toBe("npx");
		expect(config.type).toBeUndefined();
	});

	it("McpSseServerConfig requires type and url", () => {
		const config: McpSseServerConfig = {
			type: "sse",
			url: "http://localhost:3001/sse",
			headers: { Authorization: "Bearer token" },
			disabled: true,
		};
		expect(config.type).toBe("sse");
		expect(config.url).toBe("http://localhost:3001/sse");
		expect(config.disabled).toBe(true);
	});

	it("McpServerConfig union accepts both types", () => {
		const stdioConfig: McpServerConfig = { command: "node" };
		const sseConfig: McpServerConfig = { type: "sse", url: "http://host/sse" };

		expect("command" in stdioConfig).toBe(true);
		expect("type" in sseConfig && sseConfig.type === "sse").toBe(true);
	});

	it("disabled server is identified correctly", () => {
		const servers: Record<string, McpServerConfig> = {
			active: { command: "echo" },
			inactive: { command: "echo", disabled: true },
			activeSse: { type: "sse", url: "http://host/sse" },
			inactiveSse: { type: "sse", url: "http://host/sse", disabled: true },
		};

		const enabledEntries = Object.entries(servers).filter(([_, c]) => !c.disabled);
		expect(enabledEntries).toHaveLength(2);
		expect(enabledEntries.map(([name]) => name)).toEqual(["active", "activeSse"]);
	});

	it("optional mcp field in Settings is undefined by default", () => {
		const settings: Settings = {};
		expect(settings.mcp).toBeUndefined();
	});
});
