import { beforeEach, describe, expect, it, vi } from "vitest";
import { McpManager } from "../../src/core/mcp/mcp-manager.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	const connect = vi.fn().mockResolvedValue(undefined);
	const listTools = vi.fn().mockResolvedValue({ tools: [] });
	const callTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] });
	const close = vi.fn().mockResolvedValue(undefined);

	return {
		Client: vi.fn().mockImplementation(() => ({
			connect,
			listTools,
			callTool,
			close,
		})),
	};
});

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
	StdioClientTransport: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("@modelcontextprotocol/sdk/client/sse.js", () => ({
	SSEClientTransport: vi.fn().mockImplementation(() => ({})),
}));

describe("McpManager", () => {
	let manager: McpManager;

	beforeEach(() => {
		manager = new McpManager();
		vi.clearAllMocks();
	});

	describe("connectAll", () => {
		it("connects all non-disabled servers", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const mockClient = vi.mocked(Client);
			mockClient.mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				s1: { command: "echo" },
				s2: { command: "cat" },
			});

			expect(mockClient).toHaveBeenCalledTimes(2);
		});

		it("skips disabled servers", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const mockClient = vi.mocked(Client);
			mockClient.mockClear();

			await manager.connectAll({
				s1: { command: "echo" },
				s2: { command: "cat", disabled: true },
			});

			expect(mockClient).toHaveBeenCalledTimes(1);
		});

		it("single server failure does not affect others", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const mockClient = vi.mocked(Client);

			let callCount = 0;
			mockClient.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return {
						connect: vi.fn().mockRejectedValue(new Error("connection failed")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					} as any;
				}
				return {
					connect: vi.fn().mockResolvedValue(undefined),
					listTools: vi.fn().mockResolvedValue({ tools: [] }),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
				} as any;
			});

			await manager.connectAll({
				fail: { command: "bad-cmd" },
				ok: { command: "good-cmd" },
			});

			expect(mockClient).toHaveBeenCalledTimes(2);
			const tools = manager.getAllTools();
			expect(tools).toHaveLength(0);
		});

		it("returns normally when no servers configured", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const mockClient = vi.mocked(Client);
			mockClient.mockClear();

			await manager.connectAll({});
			expect(mockClient).not.toHaveBeenCalled();

			await manager.connectAll({
				disabled1: { command: "echo", disabled: true },
			});
			expect(mockClient).not.toHaveBeenCalled();
		});
	});

	describe("connectServer (stdio)", () => {
		it("creates StdioClientTransport and discovers tools", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");

			const mockClient = {
				connect: vi.fn().mockResolvedValue(undefined),
				listTools: vi
					.fn()
					.mockResolvedValue({ tools: [{ name: "tool1", description: "desc1", inputSchema: { type: "object" } }] }),
				callTool: vi.fn(),
				close: vi.fn().mockResolvedValue(undefined),
			};
			vi.mocked(Client).mockImplementation(() => mockClient as any);

			await manager.connectAll({
				myserver: { command: "node", args: ["server.js"] },
			});

			expect(StdioClientTransport).toHaveBeenCalledWith(
				expect.objectContaining({
					command: "node",
					args: ["server.js"],
				}),
			);
			expect(mockClient.connect).toHaveBeenCalled();
		});

		it("sets error status on connection failure", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockRejectedValue(new Error("spawn failed")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				broken: { command: "nonexistent" },
			});

			const tools = manager.getAllTools();
			expect(tools).toHaveLength(0);
		});
	});

	describe("connectServer (SSE)", () => {
		it("creates SSEClientTransport with URL", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");

			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				remote: { type: "sse", url: "http://localhost:3001/sse" },
			});

			expect(SSEClientTransport).toHaveBeenCalledTimes(1);
			const firstArg = vi.mocked(SSEClientTransport).mock.calls[0][0];
			const urlString = firstArg instanceof URL ? firstArg.href : String(firstArg);
			expect(urlString).toBe("http://localhost:3001/sse");
		});
	});

	describe("callTool", () => {
		it("routes to correct server client", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

			const mockCallTool = vi.fn().mockResolvedValue({
				content: [{ type: "text", text: "result" }],
			});
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi
							.fn()
							.mockResolvedValue({ tools: [{ name: "myTool", description: "", inputSchema: { type: "object" } }] }),
						callTool: mockCallTool,
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				srv: { command: "echo" },
			});

			await manager.callTool("mcp__srv__myTool", { key: "value" });

			expect(mockCallTool).toHaveBeenCalledWith({
				name: "myTool",
				arguments: { key: "value" },
			});
		});

		it("throws for unknown tool name", async () => {
			await expect(manager.callTool("mcp__unknown__tool", {})).rejects.toThrow("Unknown MCP tool: mcp__unknown__tool");
		});

		it("throws when server not connected", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockRejectedValue(new Error("fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				broken: { command: "fail" },
			});

			await expect(manager.callTool("mcp__broken__tool", {})).rejects.toThrow("Unknown MCP tool");
		});
	});

	describe("getAllTools", () => {
		it("returns tools from all connected servers", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({
							tools: [
								{ name: "toolA", description: "A", inputSchema: { type: "object" } },
								{ name: "toolB", description: "B", inputSchema: { type: "object" } },
							],
						}),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				srv1: { command: "echo" },
			});

			const tools = manager.getAllTools();
			expect(tools).toHaveLength(2);
			expect(tools[0].fullName).toBe("mcp__srv1__toolA");
			expect(tools[1].fullName).toBe("mcp__srv1__toolB");
		});

		it("tool names follow mcp__<server>__<tool> format", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "search", description: "Search things", inputSchema: { type: "object" } }],
						}),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				"my-server": { command: "echo" },
			});

			const tools = manager.getAllTools();
			expect(tools).toHaveLength(1);
			expect(tools[0].fullName).toBe("mcp__my-server__search");
			expect(tools[0].originalName).toBe("search");
			expect(tools[0].serverName).toBe("my-server");
		});
	});

	describe("disconnectAll", () => {
		it("closes all clients and clears state", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");

			const mockClose = vi.fn().mockResolvedValue(undefined);
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "tool1", description: "", inputSchema: {} }],
						}),
						callTool: vi.fn(),
						close: mockClose,
					}) as any,
			);

			await manager.connectAll({
				s1: { command: "echo" },
				s2: { command: "cat" },
			});

			expect(manager.getAllTools()).toHaveLength(2);

			await manager.disconnectAll();

			expect(mockClose).toHaveBeenCalledTimes(2);
			expect(manager.getAllTools()).toHaveLength(0);
		});

		it("clears tool map after disconnect", async () => {
			const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
			vi.mocked(Client).mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "myTool", description: "", inputSchema: {} }],
						}),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectAll({
				srv: { command: "echo" },
			});

			await manager.disconnectAll();

			await expect(manager.callTool("mcp__srv__myTool", {})).rejects.toThrow("Unknown MCP tool");
		});
	});
});
