import { describe, it, expect } from "vitest";
import { toolsOptionsFromProvider, type ToolOperationsProvider } from "../src/core/tools/index.js";

describe("toolsOptionsFromProvider", () => {
	it("maps all 7 operations", () => {
		const mockOps = {
			bash: { exec: async () => ({ exitCode: 0 }) },
			read: { readFile: async () => Buffer.from(""), access: async () => {} },
			write: { writeFile: async () => {}, mkdir: async () => {} },
			edit: { readFile: async () => Buffer.from(""), writeFile: async () => {}, access: async () => {} },
			grep: { isDirectory: async () => false, readFile: async () => "" },
			find: { exists: async () => false, glob: async () => [] },
			ls: { exists: async () => false, stat: async () => ({ isDirectory: () => false }), readdir: async () => [] },
		} satisfies ToolOperationsProvider;

		const result = toolsOptionsFromProvider(mockOps);

		expect(result.bash).toBeDefined();
		expect(result.bash!.operations).toBe(mockOps.bash);
		expect(result.read).toBeDefined();
		expect(result.read!.operations).toBe(mockOps.read);
		expect(result.write).toBeDefined();
		expect(result.write!.operations).toBe(mockOps.write);
		expect(result.edit).toBeDefined();
		expect(result.edit!.operations).toBe(mockOps.edit);
		expect(result.grep).toBeDefined();
		expect(result.grep!.operations).toBe(mockOps.grep);
		expect(result.find).toBeDefined();
		expect(result.find!.operations).toBe(mockOps.find);
		expect(result.ls).toBeDefined();
		expect(result.ls!.operations).toBe(mockOps.ls);
	});

	it("returns empty options for empty provider", () => {
		const result = toolsOptionsFromProvider({});
		expect(result).toEqual({});
		expect(result.bash).toBeUndefined();
		expect(result.read).toBeUndefined();
	});

	it("only injects provided operations", () => {
		const provider: ToolOperationsProvider = {
			bash: { exec: async () => ({ exitCode: 0 }) },
			read: { readFile: async () => Buffer.from(""), access: async () => {} },
		};

		const result = toolsOptionsFromProvider(provider);

		expect(result.bash).toBeDefined();
		expect(result.bash!.operations).toBe(provider.bash);
		expect(result.read).toBeDefined();
		expect(result.read!.operations).toBe(provider.read);
		expect(result.write).toBeUndefined();
		expect(result.edit).toBeUndefined();
		expect(result.grep).toBeUndefined();
		expect(result.find).toBeUndefined();
		expect(result.ls).toBeUndefined();
	});

	it("preserves operations identity (no copy)", () => {
		const bashOps = { exec: async () => ({ exitCode: 0 }) };
		const provider: ToolOperationsProvider = { bash: bashOps };

		const result = toolsOptionsFromProvider(provider);

		expect(result.bash!.operations).toBe(bashOps);
	});
});
