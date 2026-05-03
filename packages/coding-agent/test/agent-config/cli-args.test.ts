import { describe, expect, it } from "vitest";
import type { AgentConfig } from "../../extensions/subagent/agents.js";
import { buildAgentCliArgs } from "../../extensions/subagent/index.js";

function makeAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
	return {
		name: "test-agent",
		description: "test",
		systemPrompt: "You are a test agent.",
		source: "user",
		filePath: "/tmp/test.md",
		...overrides,
	};
}

describe("buildAgentCliArgs", () => {
	it("produces base args for minimal agent", () => {
		const args = buildAgentCliArgs(makeAgent());
		expect(args).toEqual(["--mode", "json", "-p", "--no-session"]);
	});

	it("includes --model when set", () => {
		const args = buildAgentCliArgs(makeAgent({ model: "glm-4.7" }));
		expect(args).toContain("--model");
		expect(args[args.indexOf("--model") + 1]).toBe("glm-4.7");
	});

	it("includes --tools as comma-separated when set", () => {
		const args = buildAgentCliArgs(makeAgent({ tools: ["read", "grep", "bash"] }));
		expect(args).toContain("--tools");
		expect(args[args.indexOf("--tools") + 1]).toBe("read,grep,bash");
	});

	it("includes --max-turns when set to positive number", () => {
		const args = buildAgentCliArgs(makeAgent({ maxTurns: 10 }));
		expect(args).toContain("--max-turns");
		expect(args[args.indexOf("--max-turns") + 1]).toBe("10");
	});

	it("excludes --max-turns when zero", () => {
		const args = buildAgentCliArgs(makeAgent({ maxTurns: 0 }));
		expect(args).not.toContain("--max-turns");
	});

	it("excludes --max-turns when undefined", () => {
		const args = buildAgentCliArgs(makeAgent());
		expect(args).not.toContain("--max-turns");
	});

	it("includes --thinking when effort is set", () => {
		const args = buildAgentCliArgs(makeAgent({ effort: "high" }));
		expect(args).toContain("--thinking");
		expect(args[args.indexOf("--thinking") + 1]).toBe("high");
	});

	it("excludes --thinking when effort is undefined", () => {
		const args = buildAgentCliArgs(makeAgent());
		expect(args).not.toContain("--thinking");
	});

	it("combines all args together", () => {
		const args = buildAgentCliArgs(
			makeAgent({
				model: "glm-4.7",
				tools: ["read", "bash"],
				maxTurns: 5,
				effort: "low",
			}),
		);
		expect(args).toEqual(
			expect.arrayContaining([
				"--mode",
				"json",
				"-p",
				"--no-session",
				"--model",
				"glm-4.7",
				"--tools",
				"read,bash",
				"--max-turns",
				"5",
				"--thinking",
				"low",
			]),
		);
	});

	it("excludes --tools when empty array", () => {
		const args = buildAgentCliArgs(makeAgent({ tools: [] }));
		expect(args).not.toContain("--tools");
	});

	it("handles all effort levels", () => {
		for (const effort of ["low", "medium", "high"] as const) {
			const args = buildAgentCliArgs(makeAgent({ effort }));
			expect(args).toContain("--thinking");
			expect(args[args.indexOf("--thinking") + 1]).toBe(effort);
		}
	});
});
