import { describe, expect, it } from "vitest";
import type {
	ConnectionStatus,
	DiscoveredTool,
	McpConnection,
	McpServerConfig,
	McpSettings,
	McpSseServerConfig,
	McpStdioServerConfig,
	McpStreamableHttpServerConfig,
} from "../../src/core/mcp/types.js";

describe("MCP config types", () => {
	describe("McpStdioServerConfig", () => {
		it("requires command with optional fields", () => {
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

		it("minimal config only requires command", () => {
			const config: McpStdioServerConfig = { command: "node" };
			expect(config.args).toBeUndefined();
			expect(config.env).toBeUndefined();
			expect(config.cwd).toBeUndefined();
			expect(config.disabled).toBeUndefined();
		});
	});

	describe("McpSseServerConfig", () => {
		it("requires type and url", () => {
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
	});

	describe("McpStreamableHttpServerConfig", () => {
		it("requires type streamable-http and url", () => {
			const config: McpStreamableHttpServerConfig = {
				type: "streamable-http",
				url: "http://localhost:8080/mcp",
				headers: { "X-Custom": "val" },
			};
			expect(config.type).toBe("streamable-http");
			expect(config.url).toBe("http://localhost:8080/mcp");
		});
	});

	describe("McpServerConfig union", () => {
		it("accepts stdio config", () => {
			const config: McpServerConfig = { command: "node" };
			expect("command" in config).toBe(true);
		});

		it("accepts sse config", () => {
			const config: McpServerConfig = { type: "sse", url: "http://host/sse" };
			expect(config.type).toBe("sse");
		});

		it("accepts streamable-http config", () => {
			const config: McpServerConfig = { type: "streamable-http", url: "http://host/mcp" };
			expect(config.type).toBe("streamable-http");
		});
	});

	describe("disabled filtering", () => {
		it("filters out disabled servers", () => {
			const servers: Record<string, McpServerConfig> = {
				active: { command: "echo" },
				inactive: { command: "echo", disabled: true },
				activeSse: { type: "sse", url: "http://host/sse" },
				inactiveSse: { type: "sse", url: "http://host/sse", disabled: true },
				activeHttp: { type: "streamable-http", url: "http://host/mcp" },
			};
			const enabled = Object.entries(servers).filter(([_, c]) => !c.disabled);
			expect(enabled).toHaveLength(3);
		});
	});

	describe("McpSettings", () => {
		it("contains servers Record", () => {
			const mcp: McpSettings = {
				servers: {
					stdio1: { command: "echo" },
					sse1: { type: "sse", url: "http://localhost/sse" },
					http1: { type: "streamable-http", url: "http://localhost/mcp" },
				},
			};
			expect(Object.keys(mcp.servers!)).toHaveLength(3);
		});

		it("servers is optional", () => {
			const mcp: McpSettings = {};
			expect(mcp.servers).toBeUndefined();
		});
	});

	describe("DiscoveredTool", () => {
		it("has all required fields", () => {
			const tool: DiscoveredTool = {
				serverName: "srv",
				originalName: "search",
				fullName: "mcp__srv__search",
				description: "Search things",
				inputSchema: { type: "object", properties: { q: { type: "string" } } },
			};
			expect(tool.fullName).toBe("mcp__srv__search");
		});
	});

	describe("ConnectionStatus", () => {
		it("accepts all valid status values", () => {
			const statuses: ConnectionStatus[] = ["connecting", "connected", "error", "disconnected"];
			expect(statuses).toHaveLength(4);
		});
	});

	describe("McpConnection", () => {
		it("has required and optional fields", () => {
			const conn: McpConnection = {
				name: "test",
				config: { command: "node" },
				status: "connected",
				tools: [],
			};
			expect(conn.error).toBeUndefined();
		});

		it("can have error field", () => {
			const conn: McpConnection = {
				name: "test",
				config: { command: "node" },
				status: "error",
				error: "connection refused",
				tools: [],
			};
			expect(conn.error).toBe("connection refused");
		});
	});
});
