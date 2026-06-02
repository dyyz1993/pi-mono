import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSchema, validateStructuredOutput } from "../../src/utils/structured-output.ts";

const tempDirs: string[] = [];

afterEach(() => {
	while (tempDirs.length > 0) {
		const dir = tempDirs.pop();
		if (dir) {
			rmSync(dir, { recursive: true, force: true });
		}
	}
});

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-structured-output-"));
	tempDirs.push(dir);
	return dir;
}

describe("resolveSchema", () => {
	it("parses inline JSON schema", () => {
		const schema = resolveSchema('{"type":"object","properties":{"name":{"type":"string"}}}');
		expect(schema).toMatchObject({ type: "object" });
	});

	it("reads schema from a file path", () => {
		const dir = makeTempDir();
		const file = join(dir, "schema.json");
		writeFileSync(file, '{"type":"string"}');
		expect(resolveSchema(file)).toMatchObject({ type: "string" });
	});

	it("reads schema from an @file path", () => {
		const dir = makeTempDir();
		const file = join(dir, "schema.json");
		writeFileSync(file, '{"type":"number"}');
		expect(resolveSchema(`@${file}`)).toMatchObject({ type: "number" });
	});

	it("throws on invalid JSON", () => {
		expect(() => resolveSchema("{not valid json}")).toThrow();
	});
});

describe("validateStructuredOutput", () => {
	it("validates JSON matching the schema", () => {
		const schema = Type.Object({ name: Type.String(), age: Type.Number() });
		const result = validateStructuredOutput('{"name":"Alice","age":30}', schema);
		expect(result.success).toBe(true);
		expect(result.data).toEqual({ name: "Alice", age: 30 });
	});

	it("strips markdown code blocks before parsing", () => {
		const schema = Type.Object({ items: Type.Array(Type.String()) });
		const result = validateStructuredOutput('```json\n{"items":["a","b"]}\n```', schema);
		expect(result.success).toBe(true);
		expect((result.data as { items: string[] }).items).toEqual(["a", "b"]);
	});

	it("returns a parse error for invalid JSON", () => {
		const schema = Type.Object({ name: Type.String() });
		const result = validateStructuredOutput("not json", schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("JSON parse failed");
	});

	it("returns a validation error for missing required fields", () => {
		const schema = Type.Object({ name: Type.String(), age: Type.Number() });
		const result = validateStructuredOutput('{"name":"Alice"}', schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});

	it("coerces convertible values", () => {
		const schema = Type.Object({ count: Type.Number() });
		const result = validateStructuredOutput('{"count":"42"}', schema);
		expect(result.success).toBe(true);
		expect((result.data as { count: number }).count).toBe(42);
	});

	it("rejects extra properties when disallowed", () => {
		const schema = Type.Object({ name: Type.String() }, { additionalProperties: false });
		const result = validateStructuredOutput('{"name":"test","extra":1}', schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});
});
