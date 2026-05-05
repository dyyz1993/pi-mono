import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { DiscoveredTool, McpConnection, McpServerConfig, McpStdioServerConfig } from "./types.js";

interface ManagedConnection extends McpConnection {
	client?: Client;
}

export class McpManager {
	private connections = new Map<string, ManagedConnection>();
	private toolMap = new Map<string, { serverName: string; toolName: string }>();

	async connectAll(servers: Record<string, McpServerConfig>): Promise<void> {
		const entries = Object.entries(servers).filter(([_, c]) => !c.disabled);
		if (entries.length === 0) return;

		const results = await Promise.allSettled(entries.map(([name, config]) => this.connectServer(name, config)));

		const succeeded = results.filter((r) => r.status === "fulfilled").length;
		const failed = results.filter((r) => r.status === "rejected").length;
		console.log(`[mcp] ${succeeded} server(s) connected${failed > 0 ? `, ${failed} failed` : ""}`);
	}

	private async connectServer(name: string, config: McpServerConfig): Promise<void> {
		const entry: ManagedConnection = { name, config, status: "connecting", tools: [] };
		this.connections.set(name, entry);

		try {
			const transport = this.createTransport(config);
			const client = new Client({ name: "pi-mcp", version: "1.0.0" }, { capabilities: {} });

			await client.connect(transport);
			const { tools } = await client.listTools();

			entry.client = client;
			entry.status = "connected";
			entry.tools = (tools ?? []).map((tool) => {
				const fullName = `mcp__${name}__${tool.name}`;
				this.toolMap.set(fullName, { serverName: name, toolName: tool.name });
				return {
					serverName: name,
					originalName: tool.name,
					fullName,
					description: tool.description ?? "",
					inputSchema: (tool.inputSchema as Record<string, unknown>) ?? { type: "object", properties: {} },
				};
			});

			console.log(`[mcp] "${name}": ${entry.tools.length} tool(s) discovered`);
		} catch (e) {
			entry.status = "error";
			entry.error = e instanceof Error ? e.message : String(e);
			console.error(`[mcp] "${name}" failed: ${entry.error}`);
		}
	}

	private createTransport(config: McpServerConfig) {
		if (this.isStdioConfig(config)) {
			return new StdioClientTransport({
				command: config.command,
				args: config.args,
				env: config.env ? ({ ...process.env, ...config.env } as Record<string, string>) : undefined,
				stderr: "pipe",
			});
		}
		return new SSEClientTransport(new URL(config.url));
	}

	private isStdioConfig(config: McpServerConfig): config is McpStdioServerConfig {
		return "command" in config;
	}

	async callTool(fullName: string, args: Record<string, unknown>): Promise<unknown> {
		const mapping = this.toolMap.get(fullName);
		if (!mapping) throw new Error(`Unknown MCP tool: ${fullName}`);

		const connection = this.connections.get(mapping.serverName);
		if (!connection?.client) throw new Error(`MCP server "${mapping.serverName}" not connected`);

		return connection.client.callTool({ name: mapping.toolName, arguments: args });
	}

	getAllTools(): DiscoveredTool[] {
		const tools: DiscoveredTool[] = [];
		for (const connection of this.connections.values()) {
			if (connection.status === "connected") tools.push(...connection.tools);
		}
		return tools;
	}

	async disconnectAll(): Promise<void> {
		for (const connection of this.connections.values()) {
			try {
				if (connection.client) await connection.client.close();
				connection.status = "disconnected";
			} catch {}
		}
		this.connections.clear();
		this.toolMap.clear();
	}
}
