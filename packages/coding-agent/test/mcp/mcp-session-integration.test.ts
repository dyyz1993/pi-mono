import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi.fn().mockResolvedValue({
				tools: [{ name: "search", description: "Search docs", inputSchema: { type: "object" } }],
			}),
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

async function getClientMock() {
	const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
	return vi.mocked(Client);
}

describe("MCP session integration (TDD)", () => {
	const cleanups: Array<() => void> = [];

	afterEach(() => {
		while (cleanups.length > 0) {
			cleanups.pop()?.();
		}
		vi.clearAllMocks();
	});

	it("emits mcp_connection_change when server connects", async () => {
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");
		const events: AgentSessionEvent[] = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				events.push({
					type: "mcp_connection_change",
					name: conn.name,
					status: conn.status,
					error: conn.error,
					tools: conn.tools.map((t) => ({
						originalName: t.originalName,
						fullName: t.fullName,
						description: t.description,
					})),
				} as AgentSessionEvent);
			},
		});

		await manager.connectAll({
			testSrv: { command: "echo", args: [] },
		});

		await manager.dispose();

		expect(events.length).toBeGreaterThanOrEqual(2);

		expect(events[0].type).toBe("mcp_connection_change");
		if (events[0].type === "mcp_connection_change") {
			expect(events[0].name).toBe("testSrv");
			expect(events[0].status).toBe("connecting");
		}

		const connectedEvent = events.find(
			(e) => e.type === "mcp_connection_change" && (e as any).status === "connected",
		);
		expect(connectedEvent).toBeDefined();
		if (connectedEvent && connectedEvent.type === "mcp_connection_change") {
			expect(connectedEvent.name).toBe("testSrv");
			expect(connectedEvent.tools.length).toBeGreaterThanOrEqual(1);
		}
	});

	it("emits connecting then connected status sequence", async () => {
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");
		const statuses: string[] = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				statuses.push(conn.status);
			},
		});

		await manager.connectAll({
			srv: { command: "echo" },
		});

		await manager.dispose();

		expect(statuses[0]).toBe("connecting");
		expect(statuses[1]).toBe("connected");
	});

	it("emits error status when connection fails", async () => {
		const Client = await getClientMock();
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");

		Client.mockImplementationOnce(() => ({
			connect: vi.fn().mockRejectedValue(new Error("spawn fail")),
			listTools: vi.fn(),
			callTool: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		}));

		const statuses: string[] = [];
		const errors: (string | undefined)[] = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				statuses.push(conn.status);
				errors.push(conn.error);
			},
		});

		await expect(
			manager.connectAll({
				badSrv: { command: "nonexistent" },
			}),
		).resolves.toBeUndefined();

		await manager.dispose();

		expect(statuses).toContain("connecting");
		expect(statuses).toContain("error");
		const errorEvent = errors.find((e) => e !== undefined);
		expect(errorEvent).toContain("spawn fail");
	});

	it("dispose cleans up without emitting disconnected", async () => {
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");
		const statuses: string[] = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				statuses.push(conn.status);
			},
		});

		await manager.connectAll({
			srv: { command: "echo" },
		});

		await manager.dispose();

		expect(statuses).toContain("connecting");
		expect(statuses).toContain("connected");
		expect(statuses).not.toContain("disconnected");
	});

	it("includes tool info in connected event", async () => {
		const Client = await getClientMock();
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");

		Client.mockImplementationOnce(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi
				.fn()
				.mockResolvedValue({ tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }] }),
			callTool: vi.fn().mockResolvedValue({ content: [{ type: "text", text: "ok" }] }),
			close: vi.fn().mockResolvedValue(undefined),
		}));

		let connectedTools: Array<{ originalName: string; fullName: string; description: string }> = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				if (conn.status === "connected") {
					connectedTools = conn.tools.map((t) => ({
						originalName: t.originalName,
						fullName: t.fullName,
						description: t.description,
					}));
				}
			},
		});

		await manager.connectAll({
			kb: { command: "npx", args: ["kb-mcp"] },
		});

		await manager.dispose();

		expect(connectedTools).toHaveLength(1);
		expect(connectedTools[0].originalName).toBe("search");
		expect(connectedTools[0].fullName).toBe("mcp__kb__search");
		expect(connectedTools[0].description).toBe("Search");
	});

	it("no events when settings have no mcp config", async () => {
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");
		const events: string[] = [];

		const manager = new McpManager({
			onConnectionChange: () => {
				events.push("should-not-fire");
			},
		});

		await manager.connectAll({});
		await manager.dispose();

		expect(events).toHaveLength(0);
	});

	it("multiple servers emit independent events", async () => {
		const { McpManager } = await import("../../src/core/mcp/mcp-manager.js");
		const changes: Array<{ name: string; status: string }> = [];

		const manager = new McpManager({
			onConnectionChange: (conn) => {
				changes.push({ name: conn.name, status: conn.status });
			},
		});

		await manager.connectAll({
			srv1: { command: "echo" },
			srv2: { command: "echo" },
		});

		await manager.dispose();

		const srv1Events = changes.filter((c) => c.name === "srv1");
		const srv2Events = changes.filter((c) => c.name === "srv2");

		expect(srv1Events.length).toBeGreaterThanOrEqual(2);
		expect(srv2Events.length).toBeGreaterThanOrEqual(2);
		expect(srv1Events[0].status).toBe("connecting");
		expect(srv2Events[0].status).toBe("connecting");
	});
});
