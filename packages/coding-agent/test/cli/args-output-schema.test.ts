import { describe, expect, it } from "vitest";
import { parseArgs } from "../../src/cli/args.ts";

describe("--output-schema argument parsing", () => {
	it("parses inline JSON", () => {
		const result = parseArgs(["-p", "test", "--output-schema", '{"type":"object"}']);
		expect(result.outputSchema).toBe('{"type":"object"}');
	});

	it("parses file paths", () => {
		const result = parseArgs(["-p", "test", "--output-schema", "/path/to/schema.json"]);
		expect(result.outputSchema).toBe("/path/to/schema.json");
	});

	it("parses @file paths", () => {
		const result = parseArgs(["-p", "test", "--output-schema", "@/path/to/schema.json"]);
		expect(result.outputSchema).toBe("@/path/to/schema.json");
	});

	it("forces print mode", () => {
		const result = parseArgs(["--output-schema", '{"type":"number"}', "prompt"]);
		expect(result.print).toBe(true);
		expect(result.outputSchema).toBe('{"type":"number"}');
		expect(result.messages).toEqual(["prompt"]);
	});

	it("does not consume a value when omitted", () => {
		const result = parseArgs(["--output-schema"]);
		expect(result.outputSchema).toBeUndefined();
	});
});
