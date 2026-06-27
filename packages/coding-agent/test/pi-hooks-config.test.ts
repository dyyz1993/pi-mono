import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfigSignature, loadConfigSources, loadConfigs } from "../extensions/pi-hooks/config-loader.ts";
import { matchesIfClause } from "../extensions/pi-hooks/if-parser.ts";
import { matchesMatcher } from "../extensions/pi-hooks/matcher.ts";

// Override HOME so global config files don't interfere with tests
const originalHome = process.env.HOME;
let fakeHome: string;

beforeEach(() => {
	fakeHome = mkdtempSync(join(tmpdir(), "pi-hooks-home-"));
	process.env.HOME = fakeHome;
});

afterEach(() => {
	process.env.HOME = originalHome;
	if (fakeHome) rmSync(fakeHome, { recursive: true, force: true });
});

describe("pi-hooks config-loader", () => {
	let projectDir: string;

	beforeEach(() => {
		projectDir = mkdtempSync(join(tmpdir(), "pi-hooks-test-"));
	});

	afterEach(() => {
		rmSync(projectDir, { recursive: true, force: true });
	});

	it("loads hooks from .claude/settings.json", () => {
		mkdirSync(join(projectDir, ".claude"));
		writeFileSync(
			join(projectDir, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo ok" }] }],
				},
			}),
		);

		const configs = loadConfigs(projectDir);
		expect(configs.has("PreToolUse")).toBe(true);
		const groups = configs.get("PreToolUse")!;
		expect(groups).toHaveLength(1);
		expect(groups[0]!.matcher).toBe("Bash");
		expect(groups[0]!.hooks).toHaveLength(1);
		expect(groups[0]!.hooks[0]!.command).toBe("echo ok");
		expect(groups[0]!.__source__).toBe("project");
	});

	it("loads hooks from .pi/settings.json", () => {
		mkdirSync(join(projectDir, ".pi"));
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo pi" }] }],
				},
			}),
		);

		const configs = loadConfigs(projectDir);
		expect(configs.has("PreToolUse")).toBe(true);
		const groups = configs.get("PreToolUse")!;
		expect(groups[0]!.matcher).toBe("Read");
		expect(groups[0]!.__source__).toBe("pi-project");
	});

	it("merges .claude and .pi hooks for the same event", () => {
		mkdirSync(join(projectDir, ".claude"));
		mkdirSync(join(projectDir, ".pi"));
		writeFileSync(
			join(projectDir, ".claude", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo claude" }] }],
				},
			}),
		);
		writeFileSync(
			join(projectDir, ".pi", "settings.json"),
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Read", hooks: [{ type: "command", command: "echo pi" }] }],
				},
			}),
		);

		const configs = loadConfigs(projectDir);
		const groups = configs.get("PreToolUse")!;
		expect(groups).toHaveLength(2);
		expect(groups[0]!.matcher).toBe("Bash");
		expect(groups[0]!.__source__).toBe("project");
		expect(groups[1]!.matcher).toBe("Read");
		expect(groups[1]!.__source__).toBe("pi-project");
	});

	it("returns empty map when no config files exist", () => {
		const configs = loadConfigs(projectDir);
		expect(configs.size).toBe(0);
	});

	it("skips config with disableAllHooks", () => {
		mkdirSync(join(projectDir, ".claude"));
		writeFileSync(
			join(projectDir, ".claude", "settings.json"),
			JSON.stringify({ disableAllHooks: true, hooks: { PreToolUse: [] } }),
		);

		const configs = loadConfigs(projectDir);
		// config has disableAllHooks=true, so its hooks should be skipped
		const groups = configs.get("PreToolUse");
		expect(groups).toBeUndefined();
	});

	it("reports config sources correctly", () => {
		mkdirSync(join(projectDir, ".claude"));
		writeFileSync(join(projectDir, ".claude", "settings.json"), JSON.stringify({ hooks: {} }));

		const sources = loadConfigSources(projectDir);
		const projectSource = sources.find((s) => s.scope === "project");
		expect(projectSource).toBeDefined();
		expect(projectSource!.exists).toBe(true);

		const piProjectSource = sources.find((s) => s.scope === "pi-project");
		expect(piProjectSource).toBeDefined();
		expect(piProjectSource!.exists).toBe(false);
	});

	it("changes config signature when pi project settings change", () => {
		mkdirSync(join(projectDir, ".pi"));
		const settingsPath = join(projectDir, ".pi", "settings.json");
		writeFileSync(
			settingsPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo one" }] }],
				},
			}),
		);

		const before = getConfigSignature(projectDir);

		writeFileSync(
			settingsPath,
			JSON.stringify({
				hooks: {
					PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo two" }] }],
				},
			}),
		);

		expect(getConfigSignature(projectDir)).not.toBe(before);
	});
});

describe("pi-hooks matcher", () => {
	it("matches wildcard", () => {
		expect(matchesMatcher("*", "Bash")).toBe(true);
	});

	it("matches empty matcher", () => {
		expect(matchesMatcher("", "Bash")).toBe(true);
	});

	it("matches undefined matcher", () => {
		expect(matchesMatcher(undefined, "Bash")).toBe(true);
	});

	it("matches pipe-separated tool names", () => {
		expect(matchesMatcher("Bash|Read|Write", "Bash")).toBe(true);
		expect(matchesMatcher("Bash|Read|Write", "Read")).toBe(true);
		expect(matchesMatcher("Bash|Read|Write", "Edit")).toBe(false);
	});

	it("matches case-insensitively", () => {
		expect(matchesMatcher("bash", "Bash")).toBe(true);
		expect(matchesMatcher("BASH", "bash")).toBe(true);
	});

	it("matches via regex", () => {
		expect(matchesMatcher("^Ba.*", "Bash")).toBe(true);
		expect(matchesMatcher("^Ba.*", "Read")).toBe(false);
	});
});

describe("pi-hooks if-parser", () => {
	it("returns true for no if clause", () => {
		expect(matchesIfClause(undefined, "Bash", {})).toBe(true);
	});

	it("matches tool name in if clause", () => {
		expect(matchesIfClause("Bash(rm -rf*)", "Bash", { command: "rm -rf /tmp" })).toBe(true);
		expect(matchesIfClause("Bash(rm -rf*)", "Read", { command: "rm -rf /tmp" })).toBe(false);
	});

	it("matches file paths for Edit/Write", () => {
		expect(matchesIfClause("Write(/tmp/*)", "Write", { file_path: "/tmp/test.txt" })).toBe(true);
		expect(matchesIfClause("Write(/etc/*)", "Write", { file_path: "/tmp/test.txt" })).toBe(false);
	});

	it("returns true for unparseable if clause", () => {
		expect(matchesIfClause("not a function call", "Bash", {})).toBe(true);
	});
});
