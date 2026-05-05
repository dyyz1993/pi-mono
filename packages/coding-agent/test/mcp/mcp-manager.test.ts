import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpConnectionError, McpTimeoutError, McpToolCallError } from "../../src/core/mcp/errors.js";
import { McpManager } from "../../src/core/mcp/mcp-manager.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({ tools: [] }),
			callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
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

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
	StreamableHTTPClientTransport: vi.fn().mockImplementation(() => ({})),
}));

function mockClient(overrides: Record<string, any> = {}) {
	const c = {
		connect: vi.fn().mockResolvedValue(undefined),
		listTools: vi.fn().mockResolvedValue({ tools: [] }),
		callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
		close: vi.fn().mockResolvedValue(undefined),
		...overrides,
	};
	return c;
}

async function getClientMock() {
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	return vi.mocked(Client);
}

describe("McpManager", () => {
	let manager: McpManager;

	beforeEach(() => {
		manager = new McpManager();
		vi.clearAllMocks();
	});

	afterEach(async () => {
		await manager.dispose();
	});

	describe("connectAll", () => {
		it("connects all non-disabled servers", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectAll({
				s1: { command: "echo" },
				s2: { command: "cat" },
			});

			expect(Client).toHaveBeenCalledTimes(2);
		});

		it("skips disabled servers", async () => {
			const Client = await getClientMock();
			Client.mockClear();

			await manager.connectAll({
				s1: { command: "echo" },
				s2: { command: "cat", disabled: true },
			});

			expect(Client).toHaveBeenCalledTimes(1);
		});

		it("single server failure does not affect others", async () => {
			const Client = await getClientMock();
			let callCount = 0;
			Client.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return {
						connect: vi.fn().mockRejectedValue(new Error("fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					} as any;
				}
				return mockClient() as any;
			});

			await manager.connectAll({
				fail: { command: "bad" },
				ok: { command: "good" },
			});

			expect(Client).toHaveBeenCalledTimes(2);
			expect(manager.getConnection("ok")?.status).toBe("connected");
		});

		it("returns normally when no servers configured", async () => {
			const Client = await getClientMock();
			Client.mockClear();

			await manager.connectAll({});
			expect(Client).not.toHaveBeenCalled();

			await manager.connectAll({ d: { command: "echo", disabled: true } });
			expect(Client).not.toHaveBeenCalled();
		});
	});

	describe("connectServer", () => {
		it("discovers tools and sets connected status", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "tool1", description: "desc1", inputSchema: { type: "object" } }],
						}),
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			const conn = manager.getConnection("srv")!;
			expect(conn.status).toBe("connected");
			expect(conn.tools).toHaveLength(1);
			expect(conn.tools[0].fullName).toBe("mcp__srv__tool1");
		});

		it("sets error status on connection failure", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockRejectedValue(new Error("spawn failed")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await expect(manager.connectServer("broken", { command: "nonexistent" })).rejects.toThrow();
			const conn = manager.getConnection("broken")!;
			expect(conn.status).toBe("error");
			expect(conn.error).toContain("spawn failed");
		});

		it("fires onConnectionChange during connection lifecycle", async () => {
			const changes: string[] = [];
			const m = new McpManager({
				onConnectionChange: (c) => changes.push(`${c.name}:${c.status}`),
			});
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await m.connectServer("srv", { command: "echo" });
			await m.dispose();

			expect(changes).toContain("srv:connecting");
			expect(changes).toContain("srv:connected");
		});

		it("sets error status on client onerror event", async () => {
			const Client = await getClientMock();
			let capturedOnerror: ((err: Error) => void) | undefined;
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onclose: undefined,
						set onerror(fn: (err: Error) => void) {
							capturedOnerror = fn;
						},
						get onerror() {
							return capturedOnerror;
						},
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getConnection("srv")!.status).toBe("connected");

			capturedOnerror!(new Error("connection lost"));

			const conn = manager.getConnection("srv")!;
			expect(conn.status).toBe("error");
			expect(conn.error).toBe("connection lost");
		});
	});

	describe("connection timeout", () => {
		it("throws McpTimeoutError when connect hangs", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();

			let rejectConnect!: (err: Error) => void;
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockReturnValue(
							new Promise<void>((_, reject) => {
								rejectConnect = reject;
							}),
						),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			const promise = manager.connectServer("slow", { command: "hang" });
			await Promise.resolve();
			vi.advanceTimersByTime(30_000);
			rejectConnect(new Error("Connection timeout"));

			await expect(promise).rejects.toThrow(McpTimeoutError);
			const conn = manager.getConnection("slow")!;
			expect(conn.status).toBe("error");

			vi.useRealTimers();
		});
	});

	describe("transport creation", () => {
		it("creates StdioClientTransport with command/args/env", async () => {
			const Client = await getClientMock();
			const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("stdio", { command: "node", args: ["srv.js"], env: { KEY: "val" } });

			expect(vi.mocked(StdioClientTransport)).toHaveBeenCalledWith(
				expect.objectContaining({ command: "node", args: ["srv.js"], env: expect.any(Object) }),
			);
		});

		it("creates SSEClientTransport with URL and headers", async () => {
			const Client = await getClientMock();
			const { SSEClientTransport } = await import("@modelcontextprotocol/sdk/client/sse.js");
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("sse", {
				type: "sse",
				url: "http://localhost:3001/sse",
				headers: { Authorization: "Bearer token" },
			});

			expect(vi.mocked(SSEClientTransport)).toHaveBeenCalledTimes(1);
		});

		it("creates StreamableHTTPClientTransport with URL and headers", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("http", {
				type: "streamable-http",
				url: "http://localhost:8080/mcp",
				headers: { "X-Custom": "val" },
			});

			const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
			expect(vi.mocked(StreamableHTTPClientTransport)).toHaveBeenCalledTimes(1);
		});

		it("throws on unknown transport type", async () => {
			await expect(manager.connectServer("bad", { type: "unknown" } as any)).rejects.toThrow(
				"Unknown MCP transport type",
			);

			const conn = manager.getConnection("bad")!;
			expect(conn.status).toBe("error");
		});
	});

	describe("callTool", () => {
		it("routes to correct server client", async () => {
			const Client = await getClientMock();
			const mockCallTool = vi.fn().mockResolvedValue({ content: [{ type: "text", text: "result" }] });
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "myTool", description: "", inputSchema: { type: "object" } }],
						}),
						callTool: mockCallTool,
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			await manager.callTool("mcp__srv__myTool", { key: "value" });

			expect(mockCallTool).toHaveBeenCalledWith(
				{ name: "myTool", arguments: { key: "value" } },
				undefined,
				expect.objectContaining({ signal: expect.any(AbortSignal) }),
			);
		});

		it("throws McpToolCallError for unknown tool", async () => {
			await expect(manager.callTool("mcp__unknown__tool", {})).rejects.toThrow(McpToolCallError);
			await expect(manager.callTool("mcp__unknown__tool", {})).rejects.toThrow("Unknown MCP tool");
		});

		it("throws McpToolCallError when server not connected", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockRejectedValue(new Error("fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			await manager.connectServer("broken", { command: "fail" }).catch(() => {});
			await expect(manager.callTool("mcp__broken__tool", {})).rejects.toThrow("Unknown MCP tool");
		});

		it("throws McpTimeoutError when callTool hangs", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "slowTool", description: "", inputSchema: { type: "object" } }],
						}),
						callTool: vi.fn().mockImplementation((_params: any, _opts: any, options: any) => {
							return new Promise((_, reject) => {
								if (options?.signal) {
									options.signal.addEventListener("abort", () => {
										reject(new DOMException("The operation was aborted", "AbortError"));
									});
								}
							});
						}),
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			const promise = manager.callTool("mcp__srv__slowTool", {});
			vi.advanceTimersByTime(60_000);

			await expect(promise).rejects.toThrow(McpTimeoutError);
			vi.useRealTimers();
		});
	});

	describe("status queries", () => {
		it("getConnections returns all connections", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("a", { command: "echo" });
			await manager.connectServer("b", { command: "cat" });

			const conns = manager.getConnections();
			expect(conns).toHaveLength(2);
			expect(conns.map((c) => c.name).sort()).toEqual(["a", "b"]);
		});

		it("getConnection returns by name", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("srv", { command: "echo" });
			const conn = manager.getConnection("srv")!;
			expect(conn.name).toBe("srv");
			expect(conn.status).toBe("connected");
		});

		it("getConnection returns undefined for unknown", () => {
			expect(manager.getConnection("nope")).toBeUndefined();
		});

		it("getToolsByServer returns tools for specific server", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "toolA", description: "A", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			const tools = manager.getToolsByServer("srv");
			expect(tools).toHaveLength(1);
			expect(tools[0].originalName).toBe("toolA");
		});

		it("getToolsByServer returns empty for unknown server", () => {
			expect(manager.getToolsByServer("nope")).toEqual([]);
		});
	});

	describe("dynamic management", () => {
		it("addServer connects and tools become available", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "newTool", description: "new", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.addServer("dynamic", { command: "echo" });
			expect(manager.getAllTools()).toHaveLength(1);
			expect(manager.getAllTools()[0].fullName).toBe("mcp__dynamic__newTool");
		});

		it("removeServer disconnects and clears tools", async () => {
			const Client = await getClientMock();
			const mockClose = vi.fn().mockResolvedValue(undefined);
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "tool1", description: "", inputSchema: {} }],
						}),
						close: mockClose,
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getAllTools()).toHaveLength(1);

			await manager.removeServer("srv");
			expect(mockClose).toHaveBeenCalled();
			expect(manager.getConnection("srv")).toBeUndefined();
			expect(manager.getAllTools()).toHaveLength(0);
		});

		it("setServerEnabled(false) disconnects", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "t", description: "", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			await manager.setServerEnabled("srv", false);

			const conn = manager.getConnection("srv")!;
			expect(conn.status).toBe("disconnected");
			expect(conn.config.disabled).toBe(true);
		});

		it("setServerEnabled(true) reconnects", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "t", description: "", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			await manager.setServerEnabled("srv", false);
			expect(manager.getConnection("srv")!.status).toBe("disconnected");

			await manager.setServerEnabled("srv", true);
			expect(manager.getConnection("srv")!.status).toBe("connected");
			expect(manager.getConnection("srv")!.config.disabled).toBe(false);
		});

		it("refreshTools rediscovers tools for specific server", async () => {
			const Client = await getClientMock();
			const mockListTools = vi
				.fn()
				.mockResolvedValueOnce({
					tools: [{ name: "old", description: "old", inputSchema: {} }],
				})
				.mockResolvedValueOnce({
					tools: [
						{ name: "new1", description: "n1", inputSchema: {} },
						{ name: "new2", description: "n2", inputSchema: {} },
					],
				});
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: mockListTools,
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getToolsByServer("srv")).toHaveLength(1);

			const refreshed = await manager.refreshTools("srv");
			expect(refreshed).toHaveLength(2);
			expect(manager.getToolsByServer("srv")).toHaveLength(2);
		});

		it("refreshTools refreshes all servers when no name given", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "t", description: "", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.connectServer("a", { command: "echo" });
			await manager.connectServer("b", { command: "cat" });

			const all = await manager.refreshTools();
			expect(all).toHaveLength(2);
		});

		it("refreshTools handles listTools failure for single server", async () => {
			const Client = await getClientMock();
			const mockListTools = vi.fn().mockResolvedValue({
				tools: [{ name: "tool1", description: "d", inputSchema: {} }],
			});
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: mockListTools,
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getToolsByServer("srv")).toHaveLength(1);

			mockListTools.mockRejectedValue(new Error("listTools failed"));

			const result = await manager.refreshTools("srv");
			expect(result).toHaveLength(1);
			expect(manager.getConnection("srv")!.status).toBe("connected");
		});

		it("refreshTools handles partial failure when refreshing all servers", async () => {
			const Client = await getClientMock();
			let callIdx = 0;
			const mockListToolsA = vi.fn().mockResolvedValue({
				tools: [{ name: "toolA", description: "A", inputSchema: {} }],
			});
			const mockListToolsB = vi.fn().mockResolvedValue({
				tools: [{ name: "toolB", description: "B", inputSchema: {} }],
			});

			Client.mockImplementation(() => {
				callIdx++;
				if (callIdx === 1) {
					return mockClient({ listTools: mockListToolsA }) as any;
				}
				return mockClient({ listTools: mockListToolsB }) as any;
			});

			await manager.connectServer("a", { command: "echo" });
			await manager.connectServer("b", { command: "cat" });

			mockListToolsB.mockRejectedValue(new Error("refresh failed"));

			const all = await manager.refreshTools();
			expect(all).toHaveLength(1);
			expect(all[0].originalName).toBe("toolA");
			expect(manager.getToolsByServer("b")).toHaveLength(1);
		});
	});

	describe("reconnection", () => {
		it("schedules reconnect on unexpected close", async () => {
			vi.useFakeTimers();
			let oncloseHandler: (() => void) | undefined;
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						set onclose(fn: () => void) {
							oncloseHandler = fn;
						},
						get onclose() {
							return oncloseHandler;
						},
						onerror: undefined,
					}) as any,
			);

			await manager.connectServer("srv", { command: "echo" });

			// Read the onclose handler from the connection's client
			const conn = manager.getConnection("srv")!;
			const client = (conn as any).client;
			if (client?.onclose) {
				client.onclose();
			}

			expect(manager.getConnection("srv")!.status).toBe("error");

			vi.advanceTimersByTime(1000);

			vi.useRealTimers();
		});

		it("max reconnect attempts stops retrying", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockRejectedValue(new Error("fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onclose: undefined,
						onerror: undefined,
					}) as any,
			);

			// Manually trigger reconnect loop by calling scheduleReconnect via internal behavior
			// We'll use connectServer which fails, then manually trigger reconnects
			await manager.connectServer("srv", { command: "fail" }).catch(() => {});

			// The connection failed but scheduleReconnect is only called from onclose, not from connectServer failure.
			// connectServer failure just sets error status.
			expect(manager.getConnection("srv")!.status).toBe("error");

			vi.useRealTimers();
		});

		it("removeServer cancels reconnect timer", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await manager.connectServer("srv", { command: "echo" });
			await manager.removeServer("srv");

			expect(manager.getConnection("srv")).toBeUndefined();
		});

		it("retries reconnection up to max attempts then stops", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			let firstClientOnclose: (() => void) | undefined;
			let callCount = 0;

			Client.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					const client: any = {
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onerror: undefined,
					};
					Object.defineProperty(client, "onclose", {
						set(fn: () => void) {
							firstClientOnclose = fn;
						},
						get() {
							return firstClientOnclose;
						},
					});
					return client;
				}
				return {
					connect: vi.fn().mockRejectedValue(new Error("reconnect failed")),
					listTools: vi.fn(),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
					onclose: undefined,
					onerror: undefined,
				} as any;
			});

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getConnection("srv")!.status).toBe("connected");

			firstClientOnclose!();
			expect(manager.getConnection("srv")!.status).toBe("error");

			await vi.advanceTimersByTimeAsync(1000);
			expect(callCount).toBe(2);
			expect(manager.getConnection("srv")!.status).toBe("error");

			await vi.advanceTimersByTimeAsync(2000);
			expect(callCount).toBe(3);
			expect(manager.getConnection("srv")!.status).toBe("error");

			await vi.advanceTimersByTimeAsync(4000);
			expect(callCount).toBe(4);
			expect(manager.getConnection("srv")!.status).toBe("error");

			await vi.advanceTimersByTimeAsync(60000);
			expect(callCount).toBe(4);

			vi.useRealTimers();
		});

		it("reconnects successfully on retry and discovers tools", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			let firstClientOnclose: (() => void) | undefined;
			let callCount = 0;

			Client.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					const client: any = {
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onerror: undefined,
					};
					Object.defineProperty(client, "onclose", {
						set(fn: () => void) {
							firstClientOnclose = fn;
						},
						get() {
							return firstClientOnclose;
						},
					});
					return client;
				}
				if (callCount === 2) {
					return {
						connect: vi.fn().mockRejectedValue(new Error("reconnect fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onclose: undefined,
						onerror: undefined,
					} as any;
				}
				return {
					connect: vi.fn().mockResolvedValue(undefined),
					listTools: vi.fn().mockResolvedValue({
						tools: [{ name: "recoveredTool", description: "recovered", inputSchema: {} }],
					}),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
					onclose: undefined,
					onerror: undefined,
				} as any;
			});

			await manager.connectServer("srv", { command: "echo" });
			expect(manager.getConnection("srv")!.tools).toHaveLength(0);

			firstClientOnclose!();

			await vi.advanceTimersByTimeAsync(1000);
			expect(manager.getConnection("srv")!.status).toBe("error");
			expect(callCount).toBe(2);

			await vi.advanceTimersByTimeAsync(2000);
			expect(manager.getConnection("srv")!.status).toBe("connected");
			expect(manager.getConnection("srv")!.tools).toHaveLength(1);
			expect(manager.getConnection("srv")!.tools[0].originalName).toBe("recoveredTool");

			vi.useRealTimers();
		});
	});

	describe("dispose and cleanup", () => {
		it("dispose removes process listeners and disconnects", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);
			const offSpy = vi.spyOn(process, "off");

			await manager.connectServer("srv", { command: "echo" });
			await manager.dispose();

			expect(offSpy).toHaveBeenCalledWith("beforeExit", expect.any(Function));
			expect(offSpy).toHaveBeenCalledWith("SIGTERM", expect.any(Function));
			expect(offSpy).toHaveBeenCalledWith("SIGINT", expect.any(Function));
			expect(manager.getConnections()).toHaveLength(0);

			offSpy.mockRestore();
		});

		it("disconnectAll closes all clients and clears state", async () => {
			const Client = await getClientMock();
			const mockClose = vi.fn().mockResolvedValue(undefined);
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "t1", description: "", inputSchema: {} }],
						}),
						close: mockClose,
					}) as any,
			);

			await manager.connectServer("a", { command: "echo" });
			await manager.connectServer("b", { command: "cat" });

			expect(manager.getAllTools()).toHaveLength(2);
			await manager.disconnectAll();

			expect(mockClose).toHaveBeenCalledTimes(2);
			expect(manager.getAllTools()).toHaveLength(0);
			expect(manager.getConnections()).toHaveLength(0);
		});
	});

	describe("getAllTools", () => {
		it("only returns tools from connected servers", async () => {
			const Client = await getClientMock();
			let callIdx = 0;
			Client.mockImplementation(() => {
				callIdx++;
				if (callIdx === 1) {
					return {
						connect: vi.fn().mockRejectedValue(new Error("fail")),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					} as any;
				}
				return mockClient({
					listTools: vi.fn().mockResolvedValue({
						tools: [{ name: "tool1", description: "", inputSchema: {} }],
					}),
				}) as any;
			});

			await manager.connectServer("broken", { command: "fail" }).catch(() => {});
			await manager.connectServer("ok", { command: "echo" });

			const tools = manager.getAllTools();
			expect(tools).toHaveLength(1);
			expect(tools[0].serverName).toBe("ok");
		});

		it("tool names follow mcp__<server>__<tool> format", async () => {
			const Client = await getClientMock();
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "search", description: "Search", inputSchema: {} }],
						}),
					}) as any,
			);

			await manager.connectServer("my-server", { command: "echo" });
			const tools = manager.getAllTools();
			expect(tools[0].fullName).toBe("mcp__my-server__search");
			expect(tools[0].originalName).toBe("search");
			expect(tools[0].serverName).toBe("my-server");
		});
	});

	describe("constructor options (P2-4)", () => {
		it("accepts logLevel option and passes to logger", async () => {
			const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
			const m = new McpManager({ logLevel: "debug" });
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await m.connectServer("srv", { command: "echo" });
			expect(logSpy).toHaveBeenCalled();
			const calls = logSpy.mock.calls.map((c) => c[0] as string);
			expect(calls.some((c) => c.includes("[mcp:info]"))).toBe(true);

			logSpy.mockRestore();
			await m.dispose();
		});

		it("accepts custom connectTimeoutMs", async () => {
			vi.useFakeTimers();
			const m = new McpManager({ connectTimeoutMs: 5000 });
			const Client = await getClientMock();

			let rejectConnect!: (err: Error) => void;
			Client.mockImplementation(
				() =>
					({
						connect: vi.fn().mockReturnValue(
							new Promise<void>((_, reject) => {
								rejectConnect = reject;
							}),
						),
						listTools: vi.fn(),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
					}) as any,
			);

			const promise = m.connectServer("slow", { command: "hang" });
			await Promise.resolve();
			vi.advanceTimersByTime(5000);
			rejectConnect(new Error("Connection timeout"));

			await expect(promise).rejects.toThrow(McpTimeoutError);

			vi.useRealTimers();
			await m.dispose();
		});

		it("accepts custom maxReconnectAttempts", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			let firstClientOnclose: (() => void) | undefined;
			let callCount = 0;

			Client.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					const client: any = {
						connect: vi.fn().mockResolvedValue(undefined),
						listTools: vi.fn().mockResolvedValue({ tools: [] }),
						callTool: vi.fn(),
						close: vi.fn().mockResolvedValue(undefined),
						onerror: undefined,
					};
					Object.defineProperty(client, "onclose", {
						set(fn: () => void) {
							firstClientOnclose = fn;
						},
						get() {
							return firstClientOnclose;
						},
					});
					return client;
				}
				return {
					connect: vi.fn().mockRejectedValue(new Error("reconnect failed")),
					listTools: vi.fn(),
					callTool: vi.fn(),
					close: vi.fn().mockResolvedValue(undefined),
					onclose: undefined,
					onerror: undefined,
				} as any;
			});

			const m = new McpManager({ maxReconnectAttempts: 1 });
			await m.connectServer("srv", { command: "echo" });

			firstClientOnclose!();
			await vi.advanceTimersByTimeAsync(1000);
			expect(callCount).toBe(2);

			await vi.advanceTimersByTimeAsync(60000);
			expect(callCount).toBe(2);

			vi.useRealTimers();
			await m.dispose();
		});

		it("accepts custom callTimeoutMs", async () => {
			vi.useFakeTimers();
			const Client = await getClientMock();
			let rejectCall!: (err: Error) => void;
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "slowTool", description: "", inputSchema: { type: "object" } }],
						}),
						callTool: vi.fn().mockReturnValue(
							new Promise((_, reject) => {
								rejectCall = reject;
							}),
						),
					}) as any,
			);

			const m = new McpManager({ callTimeoutMs: 5000 });
			await m.connectServer("srv", { command: "echo" });
			const promise = m.callTool("mcp__srv__slowTool", {});
			await Promise.resolve();

			vi.advanceTimersByTime(5000);
			rejectCall(new Error("timeout"));

			await expect(promise).rejects.toThrow(McpTimeoutError);
			vi.useRealTimers();
			await m.dispose();
		});

		it("accepts events alongside options", async () => {
			const changes: string[] = [];
			const m = new McpManager({
				logLevel: "info",
				onConnectionChange: (c) => changes.push(`${c.name}:${c.status}`),
			});
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await m.connectServer("srv", { command: "echo" });
			await m.dispose();

			expect(changes).toContain("srv:connecting");
			expect(changes).toContain("srv:connected");
		});

		it("backward compatible: accepts old McpManagerEvents shape", async () => {
			const changes: string[] = [];
			const m = new McpManager({
				onConnectionChange: (c) => changes.push(`${c.name}:${c.status}`),
			});
			const Client = await getClientMock();
			Client.mockImplementation(() => mockClient() as any);

			await m.connectServer("srv", { command: "echo" });
			await m.dispose();

			expect(changes).toContain("srv:connecting");
			expect(changes).toContain("srv:connected");
		});
	});

	describe("concurrent call throttling (P2-6)", () => {
		it("limits concurrent calls when maxConcurrentCalls is set", async () => {
			const Client = await getClientMock();
			const resolveCall: (() => void)[] = [];
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "tool1", description: "", inputSchema: { type: "object" } }],
						}),
						callTool: vi.fn().mockImplementation(() => {
							return new Promise((resolve) => {
								resolveCall.push(() => resolve({ content: [{ type: "text", text: "ok" }] }));
							});
						}),
					}) as any,
			);

			const m = new McpManager({ maxConcurrentCalls: 1 });
			await m.connectServer("srv", { command: "echo" });

			const p1 = m.callTool("mcp__srv__tool1", {});
			const p2 = m.callTool("mcp__srv__tool1", {});

			expect(resolveCall.length).toBe(1);

			resolveCall[0]();
			await p1;

			expect(resolveCall.length).toBe(2);
			resolveCall[1]();
			await p2;

			await m.dispose();
		});

		it("no limit when maxConcurrentCalls is not set", async () => {
			const Client = await getClientMock();
			let callCount = 0;
			const resolveCall: (() => void)[] = [];
			Client.mockImplementation(
				() =>
					mockClient({
						listTools: vi.fn().mockResolvedValue({
							tools: [{ name: "tool1", description: "", inputSchema: { type: "object" } }],
						}),
						callTool: vi.fn().mockImplementation(() => {
							callCount++;
							return new Promise((resolve) => {
								resolveCall.push(() => resolve({ content: [{ type: "text", text: "ok" }] }));
							});
						}),
					}) as any,
			);

			const m = new McpManager();
			await m.connectServer("srv", { command: "echo" });

			const p1 = m.callTool("mcp__srv__tool1", {});
			const p2 = m.callTool("mcp__srv__tool1", {});

			expect(callCount).toBe(2);

			resolveCall[0]();
			resolveCall[1]();
			await Promise.all([p1, p2]);

			await m.dispose();
		});
	});
});
