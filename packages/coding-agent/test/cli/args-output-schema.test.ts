import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.js";

describe("--output-schema argument parsing", () => {
	it("parses --output-schema with inline JSON", () => {
		const result = parseArgs(["-p", "test", "--output-schema", '{"type":"object"}']);
		expect(result.outputSchema).toBe('{"type":"object"}');
	});

	it("parses --output-schema with file path", () => {
		const result = parseArgs(["-p", "test", "--output-schema", "/path/to/schema.json"]);
		expect(result.outputSchema).toBe("/path/to/schema.json");
	});

	it("parses --output-schema with @file path", () => {
		const result = parseArgs(["-p", "test", "--output-schema", "@/path/to/schema.json"]);
		expect(result.outputSchema).toBe("@/path/to/schema.json");
	});

	it("returns undefined when not provided", () => {
		const result = parseArgs(["-p", "test"]);
		expect(result.outputSchema).toBeUndefined();
	});

	it("works in combination with -p", () => {
		const result = parseArgs(["-p", "do something", "--output-schema", '{"type":"object"}']);
		expect(result.print).toBe(true);
		expect(result.outputSchema).toBe('{"type":"object"}');
		expect(result.messages).toEqual(["do something"]);
	});

	it("works in combination with --mode json", () => {
		const result = parseArgs(["--mode", "json", "--output-schema", '{"type":"string"}']);
		expect(result.mode).toBe("json");
		expect(result.outputSchema).toBe('{"type":"string"}');
	});

	it("works with --output-schema placed before other args", () => {
		const result = parseArgs(["--output-schema", '{"type":"number"}', "-p", "prompt"]);
		expect(result.outputSchema).toBe('{"type":"number"}');
		expect(result.print).toBe(true);
	});

	it("does not consume value when --output-schema is last arg without value", () => {
		const result = parseArgs(["--output-schema"]);
		expect(result.outputSchema).toBeUndefined();
	});
});
