import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createEventBus } from "../src/core/event-bus.js";
import { createExtensionRuntime, loadExtensionFromFactory, loadExtensions } from "../src/core/extensions/loader.js";
import type { ExtensionFactory } from "../src/core/extensions/types.js";
import { DefaultResourceLoader } from "../src/core/resource-loader.js";
import { SettingsManager } from "../src/core/settings-manager.js";

const darkThemeJson = JSON.parse(
	readFileSync(join(process.cwd(), "src", "modes", "interactive", "theme", "dark.json"), "utf-8"),
) as Record<string, unknown>;

const timings: Array<{ name: string; durationMs: number }> = [];

function extensionWithTool(toolName: string, commandName: string, flagName: string): string {
	return `
		import { Type } from "typebox";
		export default function(pi) {
			pi.registerTool({
				name: "${toolName}",
				label: "${toolName}",
				description: "Test tool ${toolName}",
				parameters: Type.Object({}),
				execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
			});
			pi.registerCommand("${commandName}", {
				description: "Test command ${commandName}",
				handler: async () => {},
			});
			pi.registerFlag("${flagName}", {
				description: "Test flag ${flagName}",
				type: "boolean",
				default: false,
			});
		}
	`;
}

function brokenExtension(): string {
	return `
		export default function(pi) {
			throw new SyntaxError("broken extension!");
		}
	`;
}

describe("startup performance baseline", () => {
	let tempDir: string;
	let extensionsDir: string;
	let agentDir: string;
	let cwd: string;

	beforeEach(() => {
		tempDir = join(tmpdir(), `pi-startup-perf-${Date.now()}-${Math.random().toString(36).slice(2)}`);
		extensionsDir = join(tempDir, "extensions");
		agentDir = join(tempDir, "agent");
		cwd = join(tempDir, "project");
		mkdirSync(extensionsDir, { recursive: true });
		mkdirSync(agentDir, { recursive: true });
		mkdirSync(cwd, { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
	});

	describe("extension loading correctness", () => {
		it("loads all extensions with correct registrations", async () => {
			for (let i = 0; i < 5; i++) {
				writeFileSync(join(extensionsDir, `ext-${i}.ts`), extensionWithTool(`tool_${i}`, `cmd_${i}`, `flag_${i}`));
			}

			const start = Date.now();
			const result = await loadExtensions(
				Array.from({ length: 5 }, (_, i) => join(extensionsDir, `ext-${i}.ts`)),
				cwd,
			);
			const durationMs = Date.now() - start;
			timings.push({ name: "load 5 extensions (sequential)", durationMs });

			expect(result.extensions).toHaveLength(5);
			expect(result.errors).toHaveLength(0);

			const allToolNames = result.extensions.flatMap((ext) => Array.from(ext.tools.keys()));
			const allCommandNames = result.extensions.flatMap((ext) => Array.from(ext.commands.keys()));
			const allFlagNames = result.extensions.flatMap((ext) => Array.from(ext.flags.keys()));

			expect(allToolNames.sort()).toEqual(["tool_0", "tool_1", "tool_2", "tool_3", "tool_4"]);
			expect(allCommandNames.sort()).toEqual(["cmd_0", "cmd_1", "cmd_2", "cmd_3", "cmd_4"]);
			expect(allFlagNames.sort()).toEqual(["flag_0", "flag_1", "flag_2", "flag_3", "flag_4"]);
		});

		it("preserves filesystem discovery order", async () => {
			const expectedOrder: string[] = [];
			for (let i = 0; i < 5; i++) {
				const name = `ext-${i}.ts`;
				writeFileSync(join(extensionsDir, name), extensionWithTool(`tool_${i}`, `cmd_${i}`, `flag_${i}`));
				expectedOrder.push(join(extensionsDir, name));
			}

			const result = await loadExtensions(expectedOrder, cwd);

			const loadedPaths = result.extensions.map((ext) => ext.path);
			expect(loadedPaths).toEqual(expectedOrder);
		});
	});

	describe("extension loading error handling", () => {
		it("loads valid extensions despite one broken extension", async () => {
			for (let i = 0; i < 3; i++) {
				writeFileSync(
					join(extensionsDir, `valid-${i}.ts`),
					extensionWithTool(`valid_tool_${i}`, `valid_cmd_${i}`, `valid_flag_${i}`),
				);
			}
			writeFileSync(join(extensionsDir, "broken.ts"), brokenExtension());

			const allPaths = [
				join(extensionsDir, "valid-0.ts"),
				join(extensionsDir, "valid-1.ts"),
				join(extensionsDir, "valid-2.ts"),
				join(extensionsDir, "broken.ts"),
			];

			const start = Date.now();
			const result = await loadExtensions(allPaths, cwd);
			const durationMs = Date.now() - start;
			timings.push({ name: "load 3 valid + 1 broken", durationMs });

			expect(result.extensions).toHaveLength(3);
			expect(result.errors).toHaveLength(1);
			expect(result.errors[0]?.error).toContain("broken extension!");

			const toolNames = result.extensions.flatMap((ext) => Array.from(ext.tools.keys()));
			expect(toolNames.sort()).toEqual(["valid_tool_0", "valid_tool_1", "valid_tool_2"]);

			const commandNames = result.extensions.flatMap((ext) => Array.from(ext.commands.keys()));
			expect(commandNames.sort()).toEqual(["valid_cmd_0", "valid_cmd_1", "valid_cmd_2"]);
		});
	});

	describe("extension factory execution order", () => {
		it("maintains registration order across factories", async () => {
			const orderTracker: string[] = [];

			const factory1: ExtensionFactory = (pi) => {
				pi.registerCommand("first", {
					description: "First",
					handler: async () => {},
				});
				orderTracker.push("factory1");
			};

			const factory2: ExtensionFactory = (pi) => {
				pi.registerCommand("second", {
					description: "Second",
					handler: async () => {},
				});
				orderTracker.push("factory2");
			};

			const factory3: ExtensionFactory = (pi) => {
				pi.registerCommand("third", {
					description: "Third",
					handler: async () => {},
				});
				orderTracker.push("factory3");
			};

			const eventBus = createEventBus();
			const runtime = createExtensionRuntime();

			await loadExtensionFromFactory(factory1, cwd, eventBus, runtime, "<test:1>");
			await loadExtensionFromFactory(factory2, cwd, eventBus, runtime, "<test:2>");
			await loadExtensionFromFactory(factory3, cwd, eventBus, runtime, "<test:3>");

			expect(orderTracker).toEqual(["factory1", "factory2", "factory3"]);
		});
	});

	describe("resource loader reload() completeness", () => {
		it("discovers all resource types after reload", async () => {
			const extDir = join(cwd, ".pi", "extensions");
			const skillsDir = join(agentDir, "skills");
			const promptsDir = join(agentDir, "prompts");
			const themesDir = join(agentDir, "themes");

			mkdirSync(extDir, { recursive: true });
			mkdirSync(skillsDir, { recursive: true });
			mkdirSync(promptsDir, { recursive: true });
			mkdirSync(themesDir, { recursive: true });

			writeFileSync(
				join(extDir, "test-ext.ts"),
				`export default function(pi) {
					pi.registerCommand("test-cmd", {
						description: "Test",
						handler: async () => {},
					});
				}`,
			);

			const skillDir = join(skillsDir, "my-skill");
			mkdirSync(skillDir, { recursive: true });
			writeFileSync(
				join(skillDir, "SKILL.md"),
				`---
name: my-skill
description: A test skill
---
Skill content.`,
			);

			writeFileSync(
				join(promptsDir, "test-prompt.md"),
				`---
description: A test prompt
---
Prompt content.`,
			);

			const testTheme = { ...darkThemeJson, name: "test-theme" };
			writeFileSync(join(themesDir, "test-theme.json"), JSON.stringify(testTheme, null, 2));

			writeFileSync(join(cwd, "AGENTS.md"), "# Test Context\n\nGuidelines.");

			const start = Date.now();
			const loader = new DefaultResourceLoader({ cwd, agentDir });
			await loader.reload();
			const durationMs = Date.now() - start;
			timings.push({ name: "resource loader reload (full)", durationMs });

			const { extensions } = loader.getExtensions();
			expect(extensions.length).toBeGreaterThanOrEqual(1);
			expect(extensions.some((ext) => ext.path.includes("test-ext.ts"))).toBe(true);

			const { skills } = loader.getSkills();
			expect(skills.some((s) => s.name === "my-skill")).toBe(true);

			const { prompts } = loader.getPrompts();
			expect(prompts.some((p) => p.name === "test-prompt")).toBe(true);

			const { themes } = loader.getThemes();
			expect(themes.some((t) => t.name === "test-theme")).toBe(true);

			const { agentsFiles } = loader.getAgentsFiles();
			expect(agentsFiles.some((f) => f.path.includes("AGENTS.md"))).toBe(true);
		});
	});

	describe("resource loader with settings manager", () => {
		it("respects disabled extensions via settings", async () => {
			const settingsManager = SettingsManager.inMemory();
			settingsManager.setExtensionPaths(["-extensions/disabled.ts"]);

			const extDir = join(agentDir, "extensions");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(
				join(extDir, "disabled.ts"),
				`export default function(pi) {
				pi.registerCommand("should-not-load", {
					description: "Disabled",
					handler: async () => {},
				});
			}`,
			);

			const loader = new DefaultResourceLoader({ cwd, agentDir, settingsManager });
			await loader.reload();

			const { extensions } = loader.getExtensions();
			expect(extensions.some((e) => e.path.endsWith("disabled.ts"))).toBe(false);
		});

		it("loads extension via additionalExtensionPaths", async () => {
			const extraExtPath = join(tempDir, "extra-ext.ts");
			writeFileSync(
				extraExtPath,
				`export default function(pi) {
				pi.registerCommand("extra-cmd", {
					description: "Extra command",
					handler: async () => {},
				});
			}`,
			);

			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				additionalExtensionPaths: [extraExtPath],
			});
			await loader.reload();

			const { extensions } = loader.getExtensions();
			expect(extensions.some((e) => e.path === extraExtPath)).toBe(true);
		});
	});

	describe("inline extension factories", () => {
		it("loads factories alongside file-based extensions", async () => {
			const inlineFactory: ExtensionFactory = (pi) => {
				pi.registerCommand("inline-cmd", {
					description: "Inline command",
					handler: async () => {},
				});
				pi.registerFlag("inline-flag", {
					description: "Inline flag",
					type: "boolean",
					default: true,
				});
			};

			const extDir = join(cwd, ".pi", "extensions");
			mkdirSync(extDir, { recursive: true });
			writeFileSync(
				join(extDir, "file-ext.ts"),
				`export default function(pi) {
				pi.registerCommand("file-cmd", {
					description: "File command",
					handler: async () => {},
				});
			}`,
			);

			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				extensionFactories: [inlineFactory],
			});
			await loader.reload();

			const { extensions } = loader.getExtensions();
			expect(extensions.length).toBeGreaterThanOrEqual(2);

			const commands = extensions.flatMap((ext) => Array.from(ext.commands.keys()));
			expect(commands).toContain("inline-cmd");
			expect(commands).toContain("file-cmd");

			const flags = extensions.flatMap((ext) => Array.from(ext.flags.keys()));
			expect(flags).toContain("inline-flag");
			expect(loader.getExtensions().runtime.flagValues.get("inline-flag")).toBe(true);
		});
	});

	describe("baseline measurements", () => {
		it("records timing for reference (no assertions on duration)", async () => {
			for (let i = 0; i < 5; i++) {
				writeFileSync(
					join(extensionsDir, `bench-${i}.ts`),
					extensionWithTool(`bench_tool_${i}`, `bench_cmd_${i}`, `bench_flag_${i}`),
				);
			}

			const paths = Array.from({ length: 5 }, (_, i) => join(extensionsDir, `bench-${i}.ts`));

			const start1 = Date.now();
			await loadExtensions(paths, cwd);
			const cold = Date.now() - start1;
			timings.push({ name: "5 extensions (cold jiti)", durationMs: cold });

			const start2 = Date.now();
			await loadExtensions(paths, cwd);
			const warm = Date.now() - start2;
			timings.push({ name: "5 extensions (warm jiti)", durationMs: warm });

			for (const t of timings) {
				expect(t.durationMs).toBeGreaterThanOrEqual(0);
			}
		});
	});
});
