import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	type AgentConfig,
	type AgentSource,
	discoverAgents,
	formatAgentList,
	loadAgentsFromDir,
	mergeAgentsByPriority,
} from "../../src/core/agent-types.js";

vi.mock("../../src/config.js", () => ({
	getAgentDir: () => "/nonexistent/agent/dir",
}));

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "A test agent",
		systemPrompt: "You are a test agent",
		source: "user" as AgentSource,
		filePath: "/fake/path.md",
		...overrides,
	};
}

describe("loadAgentsFromDir (coerceField + parseHooks integration)", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `pi-agent-types-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
	});

	function writeAgent(fileName: string, frontmatter: string, body = "") {
		writeFileSync(join(testDir, fileName), `---\n${frontmatter}\n---\n${body}`);
	}

	it("coerces string fields correctly", () => {
		writeAgent(
			"strings.md",
			`name: str-agent
description: "desc"
model: glm-4.7
permissionMode: plan
effort: high
color: red
memory: project
isolation: worktree
initialPrompt: Hello`,
		);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.model).toBe("glm-4.7");
		expect(agent.permissionMode).toBe("plan");
		expect(agent.effort).toBe("high");
		expect(agent.color).toBe("red");
		expect(agent.memory).toBe("project");
		expect(agent.isolation).toBe("worktree");
		expect(agent.initialPrompt).toBe("Hello");
	});

	it("coerces array fields from comma-separated string", () => {
		writeAgent(
			"arrays.md",
			`name: arr-agent\ndescription: arr\ntools: read, grep, bash\ndisallowedTools: rm\nskills: skill-a, skill-b`,
		);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.tools).toEqual(["read", "grep", "bash"]);
		expect(agent.disallowedTools).toEqual(["rm"]);
		expect(agent.skills).toEqual(["skill-a", "skill-b"]);
	});

	it("coerces array fields from YAML array", () => {
		writeAgent("yaml-arr.md", `name: ya-agent\ndescription: ya\ntools:\n  - read\n  - grep`);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.tools).toEqual(["read", "grep"]);
	});

	it("coerces boolean fields", () => {
		writeAgent("bool-true.md", `name: bt\ndescription: bt\nbackground: true`);
		writeAgent("bool-false.md", `name: bf\ndescription: bf\nbackground: false`);
		writeAgent("bool-str.md", `name: bs\ndescription: bs\nbackground: "yes"`);
		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents.find((a) => a.name === "bt")?.background).toBe(true);
		expect(agents.find((a) => a.name === "bf")?.background).toBe(false);
		expect(agents.find((a) => a.name === "bs")?.background).toBe(true);
	});

	it("coerces number fields", () => {
		writeAgent("num.md", `name: num\ndescription: num\nmaxTurns: 42`);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.maxTurns).toBe(42);
	});

	it("parses hooks correctly", () => {
		writeAgent(
			"hooks.md",
			`name: hk\ndescription: hk
hooks:
  tool_call:
    - type: command
      command: "echo hi"
      if: "bash"
      async: true
    - type: prompt
      prompt: "Be careful"
  on_start:
    - type: command
      command: "date"`,
		);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.hooks).toBeDefined();
		expect(agent.hooks?.tool_call).toHaveLength(2);
		expect(agent.hooks?.tool_call?.[0]).toEqual({
			type: "command",
			command: "echo hi",
			if: "bash",
			async: true,
		});
		expect(agent.hooks?.tool_call?.[1]).toEqual({
			type: "prompt",
			prompt: "Be careful",
			if: undefined,
		});
		expect(agent.hooks?.on_start).toHaveLength(1);
	});

	it("handles empty hooks", () => {
		writeAgent("no-hooks.md", `name: nh\ndescription: nh`);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.hooks).toBeUndefined();
	});

	it("handles invalid hooks gracefully", () => {
		writeAgent(
			"bad-hooks.md",
			`name: bh\ndescription: bh
hooks:
  tool_call:
    - type: unknown
      foo: bar
    - not_an_object: true
    - type: command
      command: "valid"`,
		);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.hooks?.tool_call).toHaveLength(1);
		expect(agent.hooks?.tool_call?.[0].command).toBe("valid");
	});

	it("returns empty array for non-existent directory", () => {
		expect(loadAgentsFromDir(join(testDir, "nope"), "user")).toEqual([]);
	});

	it("skips files missing required fields", () => {
		writeAgent("no-name.md", `description: no name`);
		writeAgent("no-desc.md", `name: no-desc`);
		writeAgent("empty.md", ``);
		expect(loadAgentsFromDir(testDir, "user")).toHaveLength(0);
	});

	it("skips non-.md files", () => {
		writeFileSync(join(testDir, "agent.json"), `{"name": "json", "description": "d"}`);
		expect(loadAgentsFromDir(testDir, "user")).toHaveLength(0);
	});

	it("sets source and filePath correctly", () => {
		writeAgent("src.md", `name: s\ndescription: s`);
		const [agent] = loadAgentsFromDir(testDir, "project");
		expect(agent.source).toBe("project");
		expect(agent.filePath).toBe(join(testDir, "src.md"));
	});

	it("parses variables", () => {
		writeAgent("vars.md", `name: v\ndescription: v\nvariables:\n  role: explorer\n  mode: plan`);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.variables).toEqual({ role: "explorer", mode: "plan" });
	});

	it("filters empty arrays to undefined", () => {
		writeAgent("empty-arr.md", `name: ea\ndescription: ea\ntools:`);
		const [agent] = loadAgentsFromDir(testDir, "user");
		expect(agent.tools).toBeUndefined();
	});
});

describe("mergeAgentsByPriority", () => {
	it("last group wins for same name", () => {
		const group1 = [makeAgent({ name: "a", source: "builtin" })];
		const group2 = [makeAgent({ name: "a", source: "project" })];
		const result = mergeAgentsByPriority(group1, group2);
		expect(result).toHaveLength(1);
		expect(result[0].source).toBe("project");
	});

	it("keeps agents with different names", () => {
		const g1 = [makeAgent({ name: "a" })];
		const g2 = [makeAgent({ name: "b" })];
		expect(mergeAgentsByPriority(g1, g2)).toHaveLength(2);
	});

	it("returns empty for no groups", () => {
		expect(mergeAgentsByPriority()).toHaveLength(0);
	});

	it("handles empty groups", () => {
		const result = mergeAgentsByPriority([], [makeAgent({ name: "x" })], []);
		expect(result).toHaveLength(1);
	});

	it("merges multiple agents across groups", () => {
		const g1 = [makeAgent({ name: "a" }), makeAgent({ name: "b" })];
		const g2 = [makeAgent({ name: "b", description: "overridden" }), makeAgent({ name: "c" })];
		const result = mergeAgentsByPriority(g1, g2);
		expect(result).toHaveLength(3);
		const b = result.find((a) => a.name === "b");
		expect(b?.description).toBe("overridden");
	});
});

describe("formatAgentList", () => {
	it("formats multiple agents", () => {
		const agents = [
			makeAgent({ name: "agent-1", source: "builtin", description: "First" }),
			makeAgent({ name: "agent-2", source: "user", description: "Second" }),
		];
		const { text, remaining } = formatAgentList(agents, 10);
		expect(text).toBe("agent-1 (builtin): First; agent-2 (user): Second");
		expect(remaining).toBe(0);
	});

	it("returns 'none' for empty list", () => {
		const { text, remaining } = formatAgentList([], 10);
		expect(text).toBe("none");
		expect(remaining).toBe(0);
	});

	it("formats single agent", () => {
		const { text, remaining } = formatAgentList(
			[makeAgent({ name: "only", source: "plugin", description: "Solo" })],
			10,
		);
		expect(text).toBe("only (plugin): Solo");
		expect(remaining).toBe(0);
	});

	it("respects maxItems and reports remaining", () => {
		const agents = [
			makeAgent({ name: "a", source: "user", description: "A" }),
			makeAgent({ name: "b", source: "user", description: "B" }),
			makeAgent({ name: "c", source: "user", description: "C" }),
		];
		const { text, remaining } = formatAgentList(agents, 2);
		expect(text).toContain("a (user): A");
		expect(text).toContain("b (user): B");
		expect(text).not.toContain("c (user): C");
		expect(remaining).toBe(1);
	});
});

describe("discoverAgents", () => {
	it("returns empty agents when no agent dirs exist", () => {
		const { agents, projectAgentsDir } = discoverAgents("/nonexistent/path", "both");
		expect(projectAgentsDir).toBeNull();
		expect(agents).toEqual([]);
	});

	it("passes overrideAgents as flagAgents", () => {
		const override = makeAgent({ name: "override", source: "flag" });
		const { agents } = discoverAgents("/nonexistent/path", "both", [override]);
		expect(agents).toHaveLength(1);
		expect(agents[0].name).toBe("override");
	});

	it("scope=user skips project agents", () => {
		const { agents } = discoverAgents("/nonexistent/path", "user");
		expect(agents).toEqual([]);
	});

	it("scope=project skips user agents", () => {
		const { agents } = discoverAgents("/nonexistent/path", "project");
		expect(agents).toEqual([]);
	});

	it("discovers project agents when .pi/agents exists", () => {
		const projectDir = join(tmpdir(), `pi-discover-test-${Date.now()}`);
		const agentsDir = join(projectDir, ".pi", "agents");
		mkdirSync(agentsDir, { recursive: true });
		writeFileSync(join(agentsDir, "proj.md"), `---\nname: proj-agent\ndescription: A project agent\n---\nDo stuff`);

		const { agents, projectAgentsDir } = discoverAgents(projectDir, "project");
		expect(projectAgentsDir).toBe(agentsDir);
		expect(agents.some((a) => a.name === "proj-agent")).toBe(true);

		rmSync(projectDir, { recursive: true, force: true });
	});
});
