import { describe, expect, test } from "vitest";
import {
	BUILTIN_SLASH_COMMANDS,
	type BuiltinSlashCommand,
	type SlashCommandInfo,
	type SlashCommandSource,
} from "../src/core/slash-commands.js";

describe("BUILTIN_SLASH_COMMANDS", () => {
	test("is a non-empty readonly array", () => {
		expect(Array.isArray(BUILTIN_SLASH_COMMANDS)).toBe(true);
		expect(BUILTIN_SLASH_COMMANDS.length).toBeGreaterThan(0);
	});

	test("each entry has name and description strings", () => {
		for (const cmd of BUILTIN_SLASH_COMMANDS) {
			expect(typeof cmd.name).toBe("string");
			expect(cmd.name.length).toBeGreaterThan(0);
			expect(typeof cmd.description).toBe("string");
			expect(cmd.description.length).toBeGreaterThan(0);
		}
	});

	test("contains expected core commands", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
		expect(names).toContain("settings");
		expect(names).toContain("model");
		expect(names).toContain("export");
		expect(names).toContain("import");
		expect(names).toContain("new");
		expect(names).toContain("compact");
		expect(names).toContain("resume");
		expect(names).toContain("quit");
		expect(names).toContain("reload");
	});

	test("all names are unique", () => {
		const names = BUILTIN_SLASH_COMMANDS.map((c) => c.name);
		expect(new Set(names).size).toBe(names.length);
	});
});

describe("SlashCommandInfo type", () => {
	test("can construct a valid SlashCommandInfo", () => {
		const info: SlashCommandInfo = {
			name: "my-cmd",
			description: "a test command",
			source: "extension",
			sourceInfo: {
				path: "/tmp/ext",
				source: "local",
				scope: "project",
				origin: "package",
			},
		};
		expect(info.name).toBe("my-cmd");
		expect(info.source).toBe("extension");
	});
});

describe("SlashCommandSource type", () => {
	test("accepts valid source values", () => {
		const sources: SlashCommandSource[] = ["extension", "prompt", "skill"];
		expect(sources).toHaveLength(3);
	});
});
