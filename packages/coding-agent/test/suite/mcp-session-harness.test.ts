import { afterEach, describe, expect, it, vi } from "vitest";
import type { AgentSessionEvent } from "../../src/core/agent-session.js";
import { createHarness, type Harness } from "./harness.js";

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => {
	return {
		Client: vi.fn().mockImplementation(() => ({
			connect: vi.fn().mockResolvedValue(undefined),
			listTools: vi
				.fn()
				.mockResolvedValue({ tools: [{ name: "search", description: "Search", inputSchema: { type: "object" } }] }),
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

describe("MCP AgentSession integration (harness)", () => {
	const harnesses: Harness[] = [];

	afterEach(() => {
		while (harnesses.length > 0) {
			harnesses.pop()?.cleanup();
		}
		vi.clearAllMocks();
	});

	it("emits mcp_connection_change events when mcp servers are configured", async () => {
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

		const mcpEvents = harness.eventsOfType("mcp_connection_change");

		const connectedEvent = mcpEvents.find((e) => e.status === "connected");
		expect(connectedEvent).toBeDefined();
		expect(connectedEvent!.name).toBe("testSrv");
		expect(connectedEvent!.tools.length).toBeGreaterThanOrEqual(1);
		expect(connectedEvent!.tools[0].fullName).toBe("mcp__testSrv__search");
	});

	it("does not emit mcp events when no mcp config", async () => {
		const harness = await createHarness({});
		harnesses.push(harness);

		const mcpEvents = harness.eventsOfType("mcp_connection_change");
		expect(mcpEvents).toHaveLength(0);
	});

	it("emits error status when server fails to connect", async () => {
		const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
		const mockClient = vi.mocked(Client);

		mockClient.mockImplementationOnce(() => ({
			connect: vi.fn().mockRejectedValue(new Error("connection refused")),
			listTools: vi.fn(),
			callTool: vi.fn(),
			close: vi.fn().mockResolvedValue(undefined),
		}));

		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						badSrv: { command: "nonexistent" },
					},
				},
			},
		});
		harnesses.push(harness);

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			expect(mcpEvents.some((e) => e.status === "error")).toBe(true);
		});

		const errorEvents = harness.eventsOfType("mcp_connection_change").filter((e) => e.status === "error");
		expect(errorEvents[0].name).toBe("badSrv");
		expect(errorEvents[0].error).toContain("connection refused");
	});

	it("multiple servers emit separate events", async () => {
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

		const mcpEvents = harness.eventsOfType("mcp_connection_change");
		const srv1Events = mcpEvents.filter((e) => e.name === "srv1");
		const srv2Events = mcpEvents.filter((e) => e.name === "srv2");

		expect(srv1Events.length).toBeGreaterThanOrEqual(1);
		expect(srv2Events.length).toBeGreaterThanOrEqual(1);
	});

	it("cleanup via dispose does not throw", async () => {
		const harness = await createHarness({
			settings: {
				mcp: {
					servers: {
						srv: { command: "echo" },
					},
				},
			},
		});

		await vi.waitFor(() => {
			const mcpEvents = harness.eventsOfType("mcp_connection_change");
			expect(mcpEvents.some((e) => e.status === "connected")).toBe(true);
		});

		expect(() => harness.cleanup()).not.toThrow();
	});
});
