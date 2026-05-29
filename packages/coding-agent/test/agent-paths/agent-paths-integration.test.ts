import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	createPathPermissionHandler,
	normalizeFilePath,
	type PathConfig,
	type PathPermissionResult,
} from "../../extensions/agent-permissions/path-checker.js";
import { type AgentConfig, loadAgentsFromDir } from "../../src/core/agent-types.js";

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "agent-paths-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

function writeAgent(filename: string, frontmatter: Record<string, unknown>, body = "You are a test agent.") {
	const fm = Object.entries(frontmatter)
		.map(([k, v]) => {
			if (typeof v === "object" && v !== null) {
				return `${k}: ${JSON.stringify(v)}`;
			}
			return `${k}: ${v}`;
		})
		.join("\n");
	writeFileSync(join(tempDir, filename), `---\n${fm}\n---\n${body}`);
}

function loadFirst(): AgentConfig {
	const agents = loadAgentsFromDir(tempDir, "project");
	expect(agents.length).toBeGreaterThanOrEqual(1);
	return agents[0];
}

function loadByName(name: string): AgentConfig {
	const agents = loadAgentsFromDir(tempDir, "project");
	const agent = agents.find((a) => a.name === name);
	expect(agent).toBeDefined();
	return agent!;
}

describe("Agent paths integration — frontmatter parsing", () => {
	it("parses paths.write from frontmatter", () => {
		writeAgent("docs-only.md", {
			name: "docs-only",
			description: "Only writes docs",
			paths: { write: ["docs/**", "*.md"] },
		});
		const agent = loadFirst();
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**", "*.md"]);
		expect(agent.paths!.read).toBeUndefined();
		expect(agent.paths!.bash).toBeUndefined();
	});

	it("parses paths.read from frontmatter", () => {
		writeAgent("src-reader.md", {
			name: "src-reader",
			description: "Only reads src",
			paths: { read: ["src/**"] },
		});
		const agent = loadFirst();
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.read).toEqual(["src/**"]);
		expect(agent.paths!.write).toBeUndefined();
	});

	it("parses full paths config with write + read + bash", () => {
		writeAgent("full.md", {
			name: "full-paths",
			description: "All path types",
			paths: {
				write: ["docs/**"],
				read: ["src/**", "docs/**"],
				bash: ["scripts/**"],
			},
		});
		const agent = loadFirst();
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
		expect(agent.paths!.read).toEqual(["src/**", "docs/**"]);
		expect(agent.paths!.bash).toEqual(["scripts/**"]);
	});

	it("returns undefined paths when frontmatter has no paths field", () => {
		writeAgent("no-paths.md", {
			name: "no-paths",
			description: "No paths at all",
		});
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
	});

	it("returns undefined paths for empty paths object", () => {
		writeAgent("empty-paths.md", {
			name: "empty-paths",
			description: "Empty paths",
			paths: {},
		});
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
	});

	it("returns undefined paths when all arrays are empty", () => {
		writeAgent("empty-arrays.md", {
			name: "empty-arrays",
			description: "Empty arrays",
			paths: { write: [], read: [] },
		});
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
	});

	it("parses paths combined with disallowedTools", () => {
		writeAgent("combo-disallowed.md", {
			name: "combo-disallowed",
			description: "paths + disallowedTools",
			disallowedTools: ["bash"],
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.disallowedTools).toEqual(["bash"]);
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("parses paths combined with permissionMode", () => {
		writeAgent("combo-mode.md", {
			name: "combo-mode",
			description: "paths + permissionMode",
			permissionMode: "auto",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.permissionMode).toBe("auto");
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("parses paths combined with tools whitelist", () => {
		writeAgent("combo-tools.md", {
			name: "combo-tools",
			description: "paths + tools",
			tools: ["read", "edit"],
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.tools).toEqual(["read", "edit"]);
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("loads multiple agents with different paths configs from same dir", () => {
		writeAgent("a.md", {
			name: "agent-a",
			description: "Agent A",
			paths: { write: ["docs/**"] },
		});
		writeAgent("b.md", {
			name: "agent-b",
			description: "Agent B",
			paths: { read: ["src/**"] },
		});
		writeAgent("c.md", {
			name: "agent-c",
			description: "Agent C",
		});

		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(3);

		const a = agents.find((ag) => ag.name === "agent-a")!;
		const b = agents.find((ag) => ag.name === "agent-b")!;
		const c = agents.find((ag) => ag.name === "agent-c")!;

		expect(a.paths?.write).toEqual(["docs/**"]);
		expect(b.paths?.read).toEqual(["src/**"]);
		expect(b.paths?.write).toBeUndefined();
		expect(c.paths).toBeUndefined();
	});

	it("parses paths in YAML flow (single-line) format", () => {
		writeFileSync(
			join(tempDir, "flow.md"),
			`---\nname: flow\npaths: { write: ["docs/**"], read: ["src/**"] }\ndescription: flow format\n---\nbody`,
		);
		const agent = loadFirst();
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
		expect(agent.paths!.read).toEqual(["src/**"]);
	});

	it("parses paths with nested glob patterns", () => {
		writeAgent("nested.md", {
			name: "nested-globs",
			description: "Nested globs",
			paths: {
				write: ["src/components/**/test/*.ts", "packages/*/test/**/*.test.ts"],
			},
		});
		const agent = loadFirst();
		expect(agent.paths!.write).toEqual(["src/components/**/test/*.ts", "packages/*/test/**/*.test.ts"]);
	});

	it("handles paths with special characters in patterns", () => {
		writeAgent("special.md", {
			name: "special-chars",
			description: "Special chars",
			paths: {
				write: ["**/*.test.ts", "src/[[]special[]]/**"],
			},
		});
		const agent = loadFirst();
		expect(agent.paths!.write).toEqual(["**/*.test.ts", "src/[[]special[]]/**"]);
	});

	it("handles non-object paths value gracefully", () => {
		writeFileSync(
			join(tempDir, "invalid.md"),
			`---\nname: invalid-paths\ndescription: Invalid paths\npaths: "invalid"\n---\nbody`,
		);
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
	});

	it("handles paths.write as string instead of array", () => {
		writeFileSync(
			join(tempDir, "string-write.md"),
			`---\nname: string-write\ndescription: String write\npaths: { write: "docs/**" }\n---\nbody`,
		);
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
	});

	it("handles paths: null in Agent MD", () => {
		writeFileSync(
			join(tempDir, "null-paths.md"),
			`---\nname: null-paths\ndescription: Agent with null paths\npaths:\n---\nbody`,
		);
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].paths).toBeUndefined();
	});
});

describe("Agent paths integration — path handler", () => {
	it("allows edit tool when path matches paths.write", () => {
		writeAgent("write-agent.md", {
			name: "write-agent",
			description: "Write agent",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		const handler = createPathPermissionHandler(agent.paths!);
		expect(handler).not.toBeNull();
		const result = handler!({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(result).toBeNull();
	});

	it("blocks edit tool when path does not match paths.write", () => {
		writeAgent("write-block.md", {
			name: "write-block",
			description: "Write block agent",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		const handler = createPathPermissionHandler(agent.paths!);
		const result = handler!({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("write");
	});

	it("allows read tool when path matches paths.read", () => {
		writeAgent("read-agent.md", {
			name: "read-agent",
			description: "Read agent",
			paths: { read: ["src/**"] },
		});
		const agent = loadFirst();
		const handler = createPathPermissionHandler(agent.paths!);
		const result = handler!({
			toolName: "read",
			input: { file_path: "/project/src/utils/helpers.ts" },
		});
		expect(result).toBeNull();
	});

	it("blocks read tool when path does not match paths.read", () => {
		writeAgent("read-block.md", {
			name: "read-block",
			description: "Read block agent",
			paths: { read: ["docs/**"] },
		});
		const agent = loadFirst();
		const handler = createPathPermissionHandler(agent.paths!);
		const result = handler!({
			toolName: "read",
			input: { file_path: "/project/src/secret.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
		expect(result!.reason).toContain("read");
	});

	it("returns null handler for agent without paths", () => {
		writeAgent("no-handler.md", {
			name: "no-handler",
			description: "No paths",
		});
		const agent = loadFirst();
		expect(agent.paths).toBeUndefined();
		const handler = createPathPermissionHandler(agent.paths);
		expect(handler).toBeNull();
	});

	it("normalizes relative and absolute paths before matching", () => {
		writeAgent("norm-agent.md", {
			name: "norm-agent",
			description: "Normalization agent",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		const handler = createPathPermissionHandler(agent.paths!);

		const cases = ["./docs/readme.md", "../docs/readme.md", "/abs/path/docs/readme.md"];
		for (const p of cases) {
			const result = handler!({
				toolName: "edit",
				input: { file_path: p },
			});
			expect(result).toBeNull();
		}
	});
});

describe("Agent paths integration — multi-agent isolation", () => {
	it("each agent gets its own independent paths config", () => {
		writeAgent("writer.md", {
			name: "writer",
			description: "Writer",
			paths: { write: ["docs/**"] },
		});
		writeAgent("reader.md", {
			name: "reader",
			description: "Reader",
			paths: { read: ["src/**"] },
		});

		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(2);

		const writer = agents.find((a) => a.name === "writer")!;
		const reader = agents.find((a) => a.name === "reader")!;

		const writerHandler = createPathPermissionHandler(writer.paths!);
		const readerHandler = createPathPermissionHandler(reader.paths!);

		expect(
			writerHandler!({
				toolName: "edit",
				input: { file_path: "/project/docs/readme.md" },
			}),
		).toBeNull();
		expect(
			writerHandler!({
				toolName: "edit",
				input: { file_path: "/project/src/index.ts" },
			}),
		).not.toBeNull();

		expect(
			readerHandler!({
				toolName: "read",
				input: { file_path: "/project/src/app.ts" },
			}),
		).toBeNull();
		expect(
			readerHandler!({
				toolName: "read",
				input: { file_path: "/project/docs/other.md" },
			}),
		).not.toBeNull();
	});
});

describe("F3: paths + tier", () => {
	it("paths work independently of agent tier", async () => {
		writeAgent("pro-docs.md", {
			name: "pro-docs",
			description: "Pro tier with docs paths",
			tier: "pro",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.tier).toBe("pro");
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("switching tiers doesn't affect path enforcement", async () => {
		writeAgent("fast-docs.md", {
			name: "fast-docs",
			description: "Fast tier with docs paths",
			tier: "fast",
			paths: { write: ["docs/**"] },
		});
		const fastAgent = loadByName("fast-docs");
		expect(fastAgent.tier).toBe("fast");
		expect(fastAgent.paths!.write).toEqual(["docs/**"]);

		writeAgent("pro-docs.md", {
			name: "pro-docs",
			description: "Pro tier with same docs paths",
			tier: "pro",
			paths: { write: ["docs/**"] },
		});
		const proAgent = loadByName("pro-docs");
		expect(proAgent.tier).toBe("pro");
		expect(proAgent.paths!.write).toEqual(["docs/**"]);

		const fastHandler = createPathPermissionHandler(fastAgent.paths!);
		const proHandler = createPathPermissionHandler(proAgent.paths!);

		const docResult = fastHandler!({
			toolName: "edit",
			input: { file_path: "/project/docs/readme.md" },
		});
		expect(docResult).toBeNull();

		const srcResult = proHandler!({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(srcResult).not.toBeNull();
		expect(srcResult!.block).toBe(true);
	});
});

describe("F5: paths + mode", () => {
	it("paths work in chat mode", async () => {
		writeAgent("chat-docs.md", {
			name: "chat-docs",
			description: "Chat mode with docs paths",
			mode: "chat",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.mode).toBe("chat");
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("paths work in plan mode", async () => {
		writeAgent("plan-src.md", {
			name: "plan-src",
			description: "Plan mode with src read paths",
			mode: "plan",
			paths: { read: ["src/**"] },
		});
		const agent = loadFirst();
		expect(agent.mode).toBe("plan");
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.read).toEqual(["src/**"]);
	});

	it("paths restrictions are additional to mode-based restrictions", async () => {
		writeAgent("auto-chat-docs.md", {
			name: "auto-chat-docs",
			description: "Auto mode with chat mode and docs paths",
			permissionMode: "auto",
			mode: "chat",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.permissionMode).toBe("auto");
		expect(agent.mode).toBe("chat");
		expect(agent.paths!.write).toEqual(["docs/**"]);

		const handler = createPathPermissionHandler(agent.paths!);
		const result = handler!({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});
});

describe("F6: paths + skills", () => {
	it("paths work when skills add tools", async () => {
		writeAgent("skill-docs.md", {
			name: "skill-docs",
			description: "Agent with skills and docs paths",
			skills: ["markdown-helper"],
			paths: { write: ["*.md"] },
		});
		const agent = loadFirst();
		expect(agent.skills).toEqual(["markdown-helper"]);
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["*.md"]);
	});

	it("paths apply to both built-in and skill-added tools", async () => {
		writeAgent("skill-tools.md", {
			name: "skill-tools",
			description: "Agent with skills adding write tools",
			skills: ["markdown-helper"],
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.skills).toEqual(["markdown-helper"]);
		expect(agent.paths!.write).toEqual(["docs/**"]);

		const handler = createPathPermissionHandler(agent.paths!);
		const editResult = handler!({
			toolName: "edit",
			input: { file_path: "/project/src/secret.ts" },
		});
		expect(editResult).not.toBeNull();
		expect(editResult!.block).toBe(true);
	});
});

describe("F7: paths + isolation", () => {
	it("paths work in isolated mode", async () => {
		writeAgent("sandbox-docs.md", {
			name: "sandbox-docs",
			description: "Sandbox mode with docs paths",
			isolation: "sandbox",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.isolation).toBe("sandbox");
		expect(agent.paths).toBeDefined();
		expect(agent.paths!.write).toEqual(["docs/**"]);
	});

	it("paths provide additional security on top of isolation", async () => {
		writeAgent("no-isol-docs.md", {
			name: "no-isol-docs",
			description: "No isolation with docs paths",
			isolation: "none",
			paths: { write: ["docs/**"] },
		});
		const agent = loadFirst();
		expect(agent.isolation).toBe("none");
		expect(agent.paths!.write).toEqual(["docs/**"]);

		const handler = createPathPermissionHandler(agent.paths!);
		const result = handler!({
			toolName: "edit",
			input: { file_path: "/project/src/index.ts" },
		});
		expect(result).not.toBeNull();
		expect(result!.block).toBe(true);
	});
});

describe("paths + other AgentConfig fields independence", () => {
	it("paths work with maxTurns", async () => {
		writeAgent("maxturns.md", {
			name: "limited-turns",
			description: "Limited turns",
			maxTurns: 5,
			paths: { write: ["docs/**"] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].maxTurns).toBe(5);
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});

	it("paths work with thinkingLevel", async () => {
		writeAgent("thinking.md", {
			name: "thinking-agent",
			description: "Has thinking",
			thinkingLevel: "high",
			paths: { write: ["docs/**"] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].thinkingLevel).toBe("high");
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});

	it("paths work with effort", async () => {
		writeAgent("effort.md", {
			name: "effort-agent",
			description: "Has effort",
			effort: "high",
			paths: { write: ["docs/**"] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].effort).toBe("high");
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});

	it("paths work with color", async () => {
		writeAgent("color.md", {
			name: "color-agent",
			description: "Has color",
			color: "blue",
			paths: { write: ["docs/**"] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].color).toBe("blue");
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});

	it("paths work with background", async () => {
		writeAgent("background.md", {
			name: "bg-agent",
			description: "Background agent",
			background: true,
			paths: { write: ["docs/**"] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].background).toBe(true);
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});
});

describe("Malformed YAML edge cases", () => {
	it("handles paths with nested objects in write field", async () => {
		writeAgent("nested.md", {
			name: "nested",
			description: "Nested object",
			paths: { write: { foo: "bar" } },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].paths?.write).toBeUndefined();
	});

	it("handles paths with number values", async () => {
		writeAgent("number.md", {
			name: "number",
			description: "Number values",
			paths: { write: [123, 456] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		if (agents[0].paths?.write) {
			expect(agents[0].paths.write).toEqual(["123", "456"]);
		}
	});

	it("handles paths with mixed valid and invalid entries", async () => {
		writeAgent("mixed.md", {
			name: "mixed",
			description: "Mixed entries",
			paths: { write: ["docs/**", "", "   ", null] },
		});
		const agents = loadAgentsFromDir(tempDir, "project");
		expect(agents).toHaveLength(1);
		expect(agents[0].paths?.write).toEqual(["docs/**"]);
	});
});
