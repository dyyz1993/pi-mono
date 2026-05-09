import { afterEach, describe, expect, it, vi } from "vitest";
import { createHarness, type Harness } from "./harness.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi
				.fn()
				.mockResolvedValue({
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

describe("MCP tool registration into agent session", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		vi.clearAllMocks();
	});

	it("registers MCP tools into the agent tool registry after connection", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						testSrv: { command: "echo", args: [] },
					},
				},
			},
		});
		harnesses.push(harness);

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			expect(mcpEvents.some((e) => e.status === "connected")).toBe(true);
		});

		expect(harness.session.getAllTools().map((t) => t.name)).toContain("mcp__testSrv__search");
		expect(harness.session.getActiveToolNames()).toContain("mcp__testSrv__search");
	});

	it("MCP tool sourceInfo has mcp source", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						testSrv: { command: "echo", args: [] },
					},
				},
			},
		});
		harnesses.push(harness);

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			expect(mcpEvents.some((e) => e.status === "connected")).toBe(true);
		});

		const mcpTool = harness.session.getAllTools().find((t) => t.name === "mcp__testSrv__search");
		expect(mcpTool).toBeDefined();
		expect(mcpTool?.sourceInfo?.source).toBe("mcp");
	});

	it("getMcpConnections returns server status after connection", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						testSrv: { command: "echo", args: [] },
					},
				},
			},
		});
		harnesses.push(harness);

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			expect(mcpEvents.some((e) => e.status === "connected")).toBe(true);
		});

		const connections = harness.session.getMcpConnections();
		expect(connections).toHaveLength(1);
		expect(connections[0].name).toBe("testSrv");
		expect(connections[0].status).toBe("connected");
		expect(connections[0].tools).toHaveLength(1);
		expect(connections[0].tools[0].fullName).toBe("mcp__testSrv__search");
	});

	it("registers tools from multiple MCP servers", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						srv1: { command: "echo" },
						srv2: { command: "echo" },
					},
				},
			},
		});
		harnesses.push(harness);

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			const connectedNames = mcpEvents.filter((e) => e.status === "connected").map((e) => e.name);
			expect(connectedNames).toContain("srv1");
			expect(connectedNames).toContain("srv2");
		});

		const allToolNames = harness.session.getAllTools().map((t) => t.name);
		expect(allToolNames).toContain("mcp__srv1__search");
		expect(allToolNames).toContain("mcp__srv2__search");
		expect(harness.session.getActiveToolNames()).toContain("mcp__srv1__search");
		expect(harness.session.getActiveToolNames()).toContain("mcp__srv2__search");
	});

	it("does not register MCP tools when no mcp config", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);

		const mcpToolNames = harness.session
			.getAllTools()
			.map((t) => t.name)
			.filter((n) => n.startsWith("mcp__"));
		expect(mcpToolNames).toHaveLength(0);
	});

	it("does not register MCP tools when noMcp is true", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						testSrv: { command: "echo", args: [] },
					},
				},
			},
		});
		(harness.session as any)._noMcp = true;
		harnesses.push(harness);

		const mcpToolNames = harness.session
			.getAllTools()
			.map((t) => t.name)
			.filter((n) => n.startsWith("mcp__"));
		expect(mcpToolNames).toHaveLength(0);
	});
});
