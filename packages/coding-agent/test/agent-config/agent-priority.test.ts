import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type AgentConfig, loadAgentsFromDir, mergeAgentsByPriority } from "../../extensions/subagent/agents.js";

describe("Agent priority 6-level override", () => {
	let userDir: string;
	let projectDir: string;

	beforeEach(() => {
		userDir = join(tmpdir(), `pi-priority-user-${Date.now()}`);
		projectDir = join(tmpdir(), `pi-priority-project-${Date.now()}`);
		mkdirSync(userDir, { recursive: true });
		mkdirSync(projectDir, { recursive: true });
	});

	afterEach(() => {
		if (existsSync(userDir)) rmSync(userDir, { recursive: true, force: true });
		if (existsSync(projectDir)) rmSync(projectDir, { recursive: true, force: true });
	});

	it("project overrides user agent with same name", () => {
		writeFileSync(
			join(userDir, "shared.md"),
			"---\nname: shared\ndescription: user version\nmodel: haiku\n---\nUser prompt",
		);
		writeFileSync(
			join(projectDir, "shared.md"),
			"---\nname: shared\ndescription: project version\nmodel: sonnet\n---\nProject prompt",
		);

		const userAgents = loadAgentsFromDir(userDir, "user");
		expect(userAgents).toHaveLength(1);
		expect(userAgents[0].description).toBe("user version");

		const projectAgents = loadAgentsFromDir(projectDir, "project");
		const merged = mergeAgentsByPriority([], [], userAgents, projectAgents);
		const shared = merged.filter((a) => a.name === "shared");
		expect(shared).toHaveLength(1);
		expect(shared[0].description).toBe("project version");
	});

	it("flag overrides override project agents", () => {
		writeFileSync(join(projectDir, "flagged.md"), "---\nname: flagged\ndescription: project version\n---\nProject");

		const projectAgents = loadAgentsFromDir(projectDir, "project");
		const flagOverride: AgentConfig = {
			name: "flagged",
			description: "flag override",
			systemPrompt: "Flag prompt",
			source: "flag",
			filePath: "",
		};

		const merged = mergeAgentsByPriority([], [], [], projectAgents, [flagOverride]);
		const agent = merged.find((a) => a.name === "flagged");
		expect(agent?.description).toBe("flag override");
		expect(agent?.source).toBe("flag");
	});

	it("merges agents from multiple sources without duplicates", () => {
		writeFileSync(join(userDir, "agent-a.md"), "---\nname: agent-a\ndescription: user A\n---\nA");
		writeFileSync(join(userDir, "agent-b.md"), "---\nname: agent-b\ndescription: user B\n---\nB");
		writeFileSync(join(projectDir, "agent-c.md"), "---\nname: agent-c\ndescription: project C\n---\nC");

		const userAgents = loadAgentsFromDir(userDir, "user");
		const projectAgents = loadAgentsFromDir(projectDir, "project");
		const merged = mergeAgentsByPriority([], [], userAgents, projectAgents);

		expect(merged.length).toBeGreaterThanOrEqual(3);
		const names = merged.map((a) => a.name);
		expect(names).toContain("agent-a");
		expect(names).toContain("agent-b");
		expect(names).toContain("agent-c");
	});

	it("policy overrides are highest priority", () => {
		writeFileSync(join(projectDir, "locked.md"), "---\nname: locked\ndescription: project version\n---\nProj");

		const projectAgents = loadAgentsFromDir(projectDir, "project");
		const policyOverride: AgentConfig = {
			name: "locked",
			description: "policy enforced",
			systemPrompt: "Policy prompt",
			source: "policy",
			filePath: "",
		};

		const merged = mergeAgentsByPriority([], [], [], projectAgents, [], [policyOverride]);
		const agent = merged.find((a) => a.name === "locked");
		expect(agent?.description).toBe("policy enforced");
		expect(agent?.source).toBe("policy");
	});

	it("empty groups produce empty result", () => {
		const merged = mergeAgentsByPriority();
		expect(merged).toHaveLength(0);
	});

	it("6-level priority order: builtin < plugin < user < project < flag < policy", () => {
		const makeAgent = (name: string, source: string, desc: string): AgentConfig => ({
			name,
			description: desc,
			systemPrompt: `${source} prompt`,
			source: source as AgentConfig["source"],
			filePath: "",
		});

		const builtin = [makeAgent("a", "builtin", "builtin v1")];
		const plugin = [makeAgent("a", "plugin", "plugin v2")];
		const user = [makeAgent("a", "user", "user v3")];
		const project = [makeAgent("a", "project", "project v4")];
		const flag = [makeAgent("a", "flag", "flag v5")];
		const policy = [makeAgent("a", "policy", "policy v6")];

		const result = mergeAgentsByPriority(builtin, plugin, user, project, flag, policy);
		expect(result).toHaveLength(1);
		expect(result[0].description).toBe("policy v6");

		const withoutPolicy = mergeAgentsByPriority(builtin, plugin, user, project, flag);
		expect(withoutPolicy[0].description).toBe("flag v5");

		const withoutFlag = mergeAgentsByPriority(builtin, plugin, user, project);
		expect(withoutFlag[0].description).toBe("project v4");

		const withoutProject = mergeAgentsByPriority(builtin, plugin, user);
		expect(withoutProject[0].description).toBe("user v3");

		const withoutUser = mergeAgentsByPriority(builtin, plugin);
		expect(withoutUser[0].description).toBe("plugin v2");

		const onlyBuiltin = mergeAgentsByPriority(builtin);
		expect(onlyBuiltin[0].description).toBe("builtin v1");
	});
});
