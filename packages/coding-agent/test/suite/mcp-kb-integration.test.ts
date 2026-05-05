import { afterAll, describe, expect, it } from "vitest";
import { McpManager } from "../../src/core/mcp/mcp-manager.js";

describe("pi-mcp integration with knowledge-base (npx)", () => {
	const manager = new McpManager();

	afterAll(async () => {
		await manager.disconnectAll();
	});

	it("connects via npx and discovers 8 tools", async () => {
		await manager.connectAll({
			"knowledge-base": {
				command: "npx",
				args: ["-y", "@dyyz1993/kb-mcp@1.2.0", "--stdio"],
			},
		});

		const tools = manager.getAllTools();
		expect(tools.length).toBe(8);

		const toolNames = tools.map((t) => t.originalName);
		expect(toolNames).toContain("kb_write");
		expect(toolNames).toContain("kb_read");
		expect(toolNames).toContain("kb_search");
		expect(toolNames).toContain("kb_search_semantic");
		expect(toolNames).toContain("kb_list");
		expect(toolNames).toContain("kb_delete");
		expect(toolNames).toContain("kb_update");
		expect(toolNames).toContain("kb_outline");

		console.log("[npx] Discovered tools:", toolNames.join(", "));
	}, 60000);

	it("calls kb_write and kb_read", async () => {
		const result = await manager.callTool("mcp__knowledge-base__kb_write", {
			title: "NPX v1.2.0 Test",
			content: "# NPX Test\n\nWritten via npx-launched MCP server v1.2.0.",
			tags: ["test", "npx"],
			keywords: ["npx", "test"],
			intent: "Verify npx v1.2.0 mode works",
			project_description: "pi-momo-fork",
		});

		expect(result).toBeDefined();
		const text = (result as any).content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("");
		console.log("[npx] kb_write:", text);

		const docId = text.match(/"id":\s*"(\w+)"/)?.[1];
		expect(docId).toBeDefined();

		const readResult = await manager.callTool("mcp__knowledge-base__kb_read", { id: docId });
		expect(readResult).toBeDefined();
		const readText = (readResult as any).content
			.filter((c: any) => c.type === "text")
			.map((c: any) => c.text)
			.join("");
		expect(readText).toContain("NPX v1.2.0 Test");
		console.log("[npx] kb_read: OK");
	}, 15000);
});
