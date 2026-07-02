import { afterEach, describe, expect, test } from "vitest";
import type { AgentConfig } from "../src/core/agent-types.ts";
import { buildSystemPrompt, buildSystemPromptWithBreakdown } from "../src/core/system-prompt.ts";

const originalRemoteSshToolProxy = process.env.PI_REMOTE_SSH_TOOL_PROXY;
const originalRemoteSshCwd = process.env.PI_REMOTE_SSH_CWD;
const originalRuntimeKind = process.env.PI_RUNTIME_KIND;

afterEach(() => {
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
	if (originalRemoteSshCwd === undefined) {
		delete process.env.PI_REMOTE_SSH_CWD;
	} else {
		process.env.PI_REMOTE_SSH_CWD = originalRemoteSshCwd;
	}
});

describe("buildSystemPrompt", () => {
	describe("empty tools", () => {
		test("shows (none) for empty tools list", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Available tools:\n(none)");
		});

		test("shows file paths guideline even with no tools", () => {
			const prompt = buildSystemPrompt({
				selectedTools: [],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("Show file paths clearly");
		});
	});

	describe("default tools", () => {
		test("includes all default tools when snippets are provided", () => {
			const prompt = buildSystemPrompt({
				toolSnippets: {
					read: "Read file contents",
					bash: "Execute bash commands",
					edit: "Make surgical edits",
					write: "Create or overwrite files",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- read:");
			expect(prompt).toContain("- bash:");
			expect(prompt).toContain("- edit:");
			expect(prompt).toContain("- write:");
		});

		test("instructs models to resolve pi docs and examples under absolute base paths", () => {
			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain(
				"- When reading pi docs or examples, resolve docs/... under Additional docs and examples/... under Examples, not the current working directory",
			);
		});

		test("omits local pi docs and shows remote cwd in SSH tool-proxy mode", () => {
			process.env.PI_REMOTE_SSH_TOOL_PROXY = "1";
			process.env.PI_REMOTE_SSH_CWD = "/srv/app";

			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: "/Users/example/.pi-agent-chat/remote-projects/ssh-shadow",
			});

			expect(prompt).not.toContain("Pi documentation");
			expect(prompt).not.toContain("/Users/example/.pi-agent-chat/remote-projects/ssh-shadow");
			expect(prompt).toContain("Current working directory: /srv/app");
		});

		test("omits local pi docs in remote-agent-child mode", () => {
			process.env.PI_RUNTIME_KIND = "remote-agent-child";
			delete process.env.PI_REMOTE_SSH_TOOL_PROXY;

			const prompt = buildSystemPrompt({
				contextFiles: [],
				skills: [],
				cwd: "/srv/app",
			});

			expect(prompt).not.toContain("Pi documentation");
			expect(prompt).toContain("Current working directory: /srv/app");
		});
	});

	describe("custom tool snippets", () => {
		test("includes custom tools in available tools section when promptSnippet is provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				toolSnippets: {
					dynamic_tool: "Run dynamic test behavior",
				},
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- dynamic_tool: Run dynamic test behavior");
		});

		test("omits custom tools from available tools section when promptSnippet is not provided", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).not.toContain("dynamic_tool");
		});
	});

	describe("prompt guidelines", () => {
		test("appends promptGuidelines to default guidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for project summaries."],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt).toContain("- Use dynamic_tool for project summaries.");
		});

		test("deduplicates and trims promptGuidelines", () => {
			const prompt = buildSystemPrompt({
				selectedTools: ["read", "dynamic_tool"],
				promptGuidelines: ["Use dynamic_tool for summaries.", "  Use dynamic_tool for summaries.  ", "   "],
				contextFiles: [],
				skills: [],
				cwd: process.cwd(),
			});

			expect(prompt.match(/- Use dynamic_tool for summaries\./g)).toHaveLength(1);
		});
	});

	describe("breakdown", () => {
		test("splits tools, project context, and skills without double counting", () => {
			const { prompt, breakdown } = buildSystemPromptWithBreakdown({
				selectedTools: ["read", "skill"],
				toolSnippets: {
					read: "Read file contents",
					skill: "Load a skill",
				},
				contextFiles: [{ path: "AGENTS.md", content: "Project rules" }],
				skills: [
					{
						name: "debugger",
						description: "Debug failing tests",
						filePath: "/skills/debugger/SKILL.md",
						baseDir: "/skills/debugger",
						disableModelInvocation: false,
						sourceInfo: {
							path: "/skills/debugger/SKILL.md",
							source: "global",
							scope: "temporary",
							origin: "top-level",
						},
					},
				],
				agents: [
					{
						name: "code-reviewer",
						description: "Review <code> & security",
						systemPrompt: "Review code.",
						source: "user",
						filePath: "/agents/code-reviewer.md",
					},
				],
				cwd: "/tmp/project",
			});

			expect(prompt).toContain("Available tools:\n- read: Read file contents\n- skill: Load a skill");
			expect(prompt).toContain("<project_context>");
			expect(prompt).toContain("<available_skills>");
			expect(prompt).toContain("<available_agents>");
			expect(prompt).toContain("<name>code-reviewer</name>");
			expect(prompt).toContain("<description>Review &lt;code&gt; &amp; security</description>");
			expect(breakdown.toolsChars).toBe("- read: Read file contents\n- skill: Load a skill".length);
			expect(breakdown.contextFilesChars).toBeGreaterThan(0);
			expect(breakdown.skillsChars).toBeGreaterThan(0);
			expect(breakdown.agentsChars).toBeGreaterThan(0);
			expect(
				breakdown.systemBaseChars +
					breakdown.toolsChars +
					breakdown.contextFilesChars +
					breakdown.skillsChars +
					breakdown.agentsChars,
			).toBe(prompt.length);
		});

		test("includes visible agents and filters hidden agents", () => {
			const agents: AgentConfig[] = [
				{
					name: "build",
					description: "Full-permission agent for development tasks",
					systemPrompt: "Build software.",
					source: "builtin",
					filePath: "",
				},
				{
					name: "private-planner",
					description: "Internal planning only",
					systemPrompt: "Plan privately.",
					source: "project",
					filePath: "/tmp/project/.pi/agents/private-planner.md",
					hidden: true,
				},
			];

			const { prompt, breakdown } = buildSystemPromptWithBreakdown({
				selectedTools: ["read"],
				contextFiles: [],
				skills: [],
				agents,
				cwd: "/tmp/project",
			});

			expect(prompt).toContain("<available_agents>");
			expect(prompt).toContain("<name>build</name>");
			expect(prompt).toContain("<filePath>(builtin)</filePath>");
			expect(prompt).toContain("ordinary subtask/subagent/child task");
			expect(prompt).toContain("子任务/子代理");
			expect(prompt).toContain(
				"Use `session_delegate` only for explicit asynchronous delegation/dispatch/background work",
			);
			expect(prompt).toContain('Default agent is "build"');
			expect(prompt).not.toContain("private-planner");
			expect(breakdown.agentsChars).toBeGreaterThan(0);
			expect(
				breakdown.systemBaseChars +
					breakdown.toolsChars +
					breakdown.contextFilesChars +
					breakdown.skillsChars +
					breakdown.agentsChars,
			).toBe(prompt.length);
		});
	});
});
