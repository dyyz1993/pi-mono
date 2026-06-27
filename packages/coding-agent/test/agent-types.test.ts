import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { discoverAgents, getBuiltinAgents, loadAgentsFromDir } from "../src/core/agent-types.ts";

const tempDirs: string[] = [];
const originalRemoteSshToolProxy = process.env.PI_REMOTE_SSH_TOOL_PROXY;
const originalRuntimeKind = process.env.PI_RUNTIME_KIND;

afterEach(() => {
	vi.restoreAllMocks();
	if (originalRuntimeKind === undefined) {
		delete process.env.PI_RUNTIME_KIND;
	} else {
		process.env.PI_RUNTIME_KIND = originalRuntimeKind;
	}
	if (originalRemoteSshToolProxy === undefined) {
		delete process.env.PI_REMOTE_SSH_TOOL_PROXY;
	} else {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = originalRemoteSshToolProxy;
	}
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-agent-types-"));
	tempDirs.push(dir);
	return dir;
}

function writeAgent(dir: string, name: string, frontmatter: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${name}.md`),
		`---\nname: ${name}\ndescription: Test agent\ntier: fast\nthinkingLevel: low\neffort: low\ntools: read\n${frontmatter}---\nBody\n`,
	);
}

describe("agent frontmatter permission profile parsing", () => {
	it("keeps existing permissionMode parsing", () => {
		const dir = makeDir();
		writeAgent(dir, "legacy-mode", "permissionMode: always-allow\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionMode).toBe("always-allow");
		expect(agent?.permissionProfile).toBeUndefined();
	});

	it("accepts permissionProfile and mirrors it to effective permissionMode", () => {
		const dir = makeDir();
		writeAgent(dir, "profile-mode", "permissionProfile: yolo\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionProfile).toBe("yolo");
		expect(agent?.permissionMode).toBe("yolo");
	});

	it("lets permissionProfile win when both profile fields are present", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const dir = makeDir();
		writeAgent(dir, "both-mode", "permissionMode: normal\npermissionProfile: yolo\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionProfile).toBe("yolo");
		expect(agent?.permissionMode).toBe("yolo");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('defines both "permissionMode" and "permissionProfile"'),
		);
	});

	it("does not report permissionProfile as an unknown field", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const dir = makeDir();
		writeAgent(dir, "known-profile", "permissionProfile: normal\n");

		loadAgentsFromDir(dir, "project");

		expect(warn.mock.calls.some(([message]) => String(message).includes("unrecognized frontmatter"))).toBe(false);
	});
});

describe("agent discovery in SSH tool-proxy mode", () => {
	it("does not expose local user, project, or flag agents", () => {
		process.env.PI_REMOTE_SSH_TOOL_PROXY = "1";
		const dir = makeDir();
		const projectAgentsDir = join(dir, ".pi", "agents");
		writeAgent(projectAgentsDir, "project-worker", "");

		const result = discoverAgents(dir, "both", [
			{
				name: "flag-agent",
				description: "Flag agent",
				systemPrompt: "Flag agent",
				source: "flag",
				filePath: "/tmp/flag-agent.md",
			},
		]);

		expect(result.projectAgentsDir).toBeNull();
		expect(result.agents.map((agent) => agent.name)).toEqual(getBuiltinAgents().map((agent) => agent.name));
		expect(result.agents.every((agent) => agent.source === "builtin")).toBe(true);
		expect(result.agents.some((agent) => agent.name === "project-worker")).toBe(false);
		expect(result.agents.some((agent) => agent.name === "flag-agent")).toBe(false);
	});

	it("loads runtime-owned agents in remote-agent-child mode", () => {
		process.env.PI_RUNTIME_KIND = "remote-agent-child";
		delete process.env.PI_REMOTE_SSH_TOOL_PROXY;
		const dir = makeDir();
		const projectAgentsDir = join(dir, ".pi", "agents");
		writeAgent(projectAgentsDir, "remote-project-worker", "");

		const result = discoverAgents(dir, "project");

		expect(result.projectAgentsDir).toBe(projectAgentsDir);
		expect(result.agents.some((agent) => agent.name === "remote-project-worker")).toBe(true);
	});
});
