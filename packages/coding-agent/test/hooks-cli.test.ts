import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { validateHooksFile } from "../src/hooks-cli.ts";
import { main } from "../src/main.ts";

describe("hooks CLI", () => {
	let tempDir: string;
	let originalCwd: string;
	let originalExitCode: typeof process.exitCode;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-hooks-cli-"));
		originalCwd = process.cwd();
		originalExitCode = process.exitCode;
		process.exitCode = undefined;
		process.chdir(tempDir);
	});

	afterEach(() => {
		vi.restoreAllMocks();
		process.chdir(originalCwd);
		process.exitCode = originalExitCode;
		rmSync(tempDir, { recursive: true, force: true });
	});

	it("validates hooks from settings JSON", () => {
		mkdirSync(join(tempDir, ".pi"), { recursive: true });
		const settingsPath = join(tempDir, ".pi", "settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{
							matcher: "Bash",
							hooks: [
								{ type: "command", command: "printf ok" },
								{ type: "prompt", prompt: "Review the command" },
							],
						},
					],
				},
			}),
		);

		const result = validateHooksFile(settingsPath);

		expect(result.diagnostics).toEqual([]);
		expect(result.eventCount).toBe(1);
		expect(result.handlerCount).toBe(2);
	});

	it("validates hooks from markdown frontmatter", () => {
		const agentPath = join(tempDir, "agent.md");
		writeFileSync(
			agentPath,
			`---
name: reviewer
description: Review files
hooks:
  Stop:
    - hooks:
        - type: agent
          prompt: Summarize the subagent result
          once: true
---
Review files.
`,
		);

		const result = validateHooksFile(agentPath);

		expect(result.diagnostics).toEqual([]);
		expect(result.eventCount).toBe(1);
		expect(result.handlerCount).toBe(1);
	});

	it("reports invalid hook handlers", () => {
		const settingsPath = join(tempDir, "settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [
						{ matcher: "Bash", hooks: [{ type: "command" }] },
						{ type: "prompt", prompt: "ok", allowedEnvVars: [123] },
					],
				},
			}),
		);

		const result = validateHooksFile(settingsPath);

		expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toContain(
			'handler type "command" requires command',
		);
		expect(result.diagnostics.map((diagnostic) => diagnostic.path)).toContain("hooks.PreToolUse[1].allowedEnvVars");
	});

	it("runs hooks validate without starting a session", async () => {
		const settingsPath = join(tempDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ type: "command", command: "true" }] } }));
		const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await main(["hooks", "validate", settingsPath]);

		expect(process.exitCode).toBeUndefined();
		expect(logSpy.mock.calls.map(([message]) => String(message)).join("\n")).toContain("Hooks valid:");
		expect(errorSpy).not.toHaveBeenCalled();
	});

	it("sets a failure exit code for invalid hooks", async () => {
		const settingsPath = join(tempDir, "settings.json");
		writeFileSync(settingsPath, JSON.stringify({ hooks: { PreToolUse: [{ type: "command" }] } }));
		const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

		await main(["hooks", "validate", settingsPath]);

		expect(process.exitCode).toBe(1);
		expect(errorSpy.mock.calls.map(([message]) => String(message)).join("\n")).toContain("Invalid hooks");
	});
});
