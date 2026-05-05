import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "../../src/core/mcp/mcp-manager.js";
import type { McpServerConfig } from "../../src/core/settings-manager.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({ tools: [] }),
			callTool: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		})),
	};
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe("MCP settings-driven configuration", () => {
	let manager: McpManager;

	beforeEach(() => {
		manager = new McpManager();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await manager.disconnectAll();
	});

	it("does nothing when settings has no mcp config", async () => {
		const settings = {};
		const servers = (settings as any).mcp?.servers ?? {};

		await manager.connectAll(servers);

		const tools = manager.getAllTools();
		expect(tools).toHaveLength(0);
	});

	it("reads mcp.servers from settings", async () => {
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
		const mockClient = vi.mocked(Client);

		mockClient.mockImplementation(
			() =>
				({
					connect: vi.fn().mockResolvedValue(undefined),
					listTools: vi.fn().mockResolvedValue({ tools: [{ name: "tool1", description: "t", inputSchema: {} }] }),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
				}) as any,
		);

		const servers: Record<string, McpServerConfig> = {
			myServer: { command: "npx", args: ["-y", "my-mcp"] },
		};

		await manager.connectAll(servers);

		const tools = manager.getAllTools();
		expect(tools).toHaveLength(1);
		expect(tools[0].fullName).toBe("mcp__myServer__tool1");
	});

	it("handles mixed stdio and SSE configurations", async () => {
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
		const mockClient = vi.mocked(Client);

		mockClient.mockImplementation(
			() =>
				({
					connect: vi.fn().mockResolvedValue(undefined),
					listTools: vi.fn().mockResolvedValue({ tools: [{ name: "t", description: "", inputSchema: {} }] }),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
				}) as any,
		);

		const servers: Record<string, McpServerConfig> = {
			local: { command: "node", args: ["local-server.js"] },
			remote: { type: "sse", url: "http://localhost:3001/sse" },
		};

		await manager.connectAll(servers);

		expect(mockClient).toHaveBeenCalledTimes(2);
		const tools = manager.getAllTools();
		expect(tools).toHaveLength(2);
	});

	it("skips disabled servers in settings", async () => {
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
		const mockClient = vi.mocked(Client);
		mockClient.mockClear();

		const servers: Record<string, McpServerConfig> = {
			active: { command: "echo" },
			disabled1: { command: "echo", disabled: true },
			disabled2: { type: "sse", url: "http://host/sse", disabled: true },
		};

		await manager.connectAll(servers);

		expect(mockClient).toHaveBeenCalledTimes(1);
	});
});
