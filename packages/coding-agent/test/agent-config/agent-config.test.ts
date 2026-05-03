import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadAgentsFromDir } from "../../extensions/subagent/agents.js";

describe("AgentConfig frontmatter parsing", () => {
	let testDir: string;

	beforeEach(() => {
		testDir = join(tmpdir(), `pi-agent-config-test-${Date.now()}`);
		mkdirSync(testDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
	});

	function writeAgent(fileName: string, frontmatter: string, body = "") {
		writeFileSync(join(testDir, fileName), `---\n${frontmatter}\n---\n${body}`);
	}

	it("parses minimal required fields", () => {
		writeAgent("minimal.md", `name: test-agent\ndescription: A test agent`);
		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents).toHaveLength(1);
		expect(agents[0].name).toBe("test-agent");
		expect(agents[0].description).toBe("A test agent");
		expect(agents[0].model).toBeUndefined();
		expect(agents[0].tools).toBeUndefined();
		expect(agents[0].systemPrompt.trim()).toBe("");
	});

	it("parses all new frontmatter fields", () => {
		writeAgent(
			"full.md",
			`name: full-agent
description: Full featured agent
tools: read, grep, find, ls, bash
disallowedTools: Bash(rm *)
model: glm-4.7
permissionMode: plan
maxTurns: 25
effort: high
color: red
background: true
memory: project
isolation: worktree
initialPrompt: Start by reading the README`,
			"You are a test agent.",
		);

		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents).toHaveLength(1);
		const a = agents[0];

		expect(a.name).toBe("full-agent");
		expect(a.tools).toEqual(["read", "grep", "find", "ls", "bash"]);
		expect(a.disallowedTools).toEqual(["Bash(rm *)"]);
		expect(a.model).toBe("glm-4.7");
		expect(a.permissionMode).toBe("plan");
		expect(a.maxTurns).toBe(25);
		expect(a.effort).toBe("high");
		expect(a.color).toBe("red");
		expect(a.background).toBe(true);
		expect(a.memory).toBe("project");
		expect(a.isolation).toBe("worktree");
		expect(a.initialPrompt).toBe("Start by reading the README");
		expect(a.systemPrompt.trim()).toBe("You are a test agent.");
	});

	it("parses hooks from frontmatter", () => {
		writeAgent(
			"hooks.md",
			`name: hooks-agent
description: Agent with hooks
hooks:
  tool_call:
    - type: command
      command: "echo tool_called"
      if: "bash"
    - type: prompt
      prompt: "Be careful"`,
		);

		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents[0].hooks).toBeDefined();
		expect(agents[0].hooks?.tool_call).toHaveLength(2);
		expect(agents[0].hooks?.tool_call?.[0]).toEqual({
			type: "command",
			command: "echo tool_called",
			if: "bash",
			async: false,
		});
		expect(agents[0].hooks?.tool_call?.[1]).toEqual({
			type: "prompt",
			prompt: "Be careful",
			if: undefined,
		});
	});

	it("parses variables from frontmatter", () => {
		writeAgent(
			"vars.md",
			`name: vars-agent
description: Agent with variables
variables:
  role: explorer
  permissionMode: plan`,
		);

		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents[0].variables).toEqual({ role: "explorer", permissionMode: "plan" });
	});

	it("parses skills as comma-separated string", () => {
		writeAgent("skills.md", `name: skills-agent\ndescription: Agent with skills\nskills: skill-a, skill-b, skill-c`);

		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents[0].skills).toEqual(["skill-a", "skill-b", "skill-c"]);
	});

	it("parses skills as YAML array", () => {
		writeAgent("skills-array.md", `name: skills-array\ndescription: Skills array\nskills:\n  - skill-x\n  - skill-y`);

		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents[0].skills).toEqual(["skill-x", "skill-y"]);
	});

	it("skips files without name or description", () => {
		writeAgent("no-name.md", "description: missing name");
		writeAgent("no-desc.md", "name: missing-desc");
		writeAgent("empty.md", "");
		expect(loadAgentsFromDir(testDir, "user")).toHaveLength(0);
	});

	it("skips non-.md files", () => {
		writeFileSync(join(testDir, "agent.json"), '{"name": "json-agent"}');
		expect(loadAgentsFromDir(testDir, "user")).toHaveLength(0);
	});

	it("handles all permission modes", () => {
		const modes = ["auto", "acceptEdits", "plan", "dontAsk", "always-allow", "always-deny"];
		for (const mode of modes) {
			writeAgent(`${mode}.md`, `name: ${mode}-agent\ndescription: ${mode} mode\npermissionMode: ${mode}`);
		}
		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents).toHaveLength(6);
		for (let i = 0; i < modes.length; i++) {
			expect(agents.find((a) => a.name === `${modes[i]}-agent`)?.permissionMode).toBe(modes[i]);
		}
	});

	it("handles background as boolean", () => {
		writeAgent("bg-true.md", `name: bg-true\ndescription: bg true\nbackground: true`);
		writeAgent("bg-false.md", `name: bg-false\ndescription: bg false\nbackground: false`);
		const agents = loadAgentsFromDir(testDir, "user");
		expect(agents.find((a) => a.name === "bg-true")?.background).toBe(true);
		expect(agents.find((a) => a.name === "bg-false")?.background).toBe(false);
	});

	it("sets source correctly", () => {
		writeAgent("src.md", `name: src-test\ndescription: source test`);
		expect(loadAgentsFromDir(testDir, "user")[0].source).toBe("user");
		expect(loadAgentsFromDir(testDir, "project")[0].source).toBe("project");
	});

	it("sets filePath to absolute path", () => {
		writeAgent("path.md", `name: path-test\ndescription: path test`);
		const agent = loadAgentsFromDir(testDir, "user")[0];
		expect(agent.filePath).toBe(join(testDir, "path.md"));
	});
});
