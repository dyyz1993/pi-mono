import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "typebox";
import { afterEach, describe, expect, it } from "vitest";
import { resolveSchema, validateStructuredOutput } from "../../src/utils/structured-output.js";

let tempDirs: string[] = [];

afterEach(() => {
	for (const dir of tempDirs) {
		try {
			rmSync(dir, { recursive: true, force: true });
		} catch {}
	}
	tempDirs = [];
});

function makeTempDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "so-test-"));
	tempDirs.push(dir);
	return dir;
}

describe("resolveSchema", () => {
	it("parses inline JSON schema", () => {
		const schema = resolveSchema('{"type":"object","properties":{"name":{"type":"string"}}}');
		expect(schema.type).toBe("object");
	});

	it("reads schema from file path", () => {
		const dir = makeTempDir();
		const file = join(dir, "schema.json");
		writeFileSync(file, '{"type":"string"}');
		const schema = resolveSchema(file);
		expect(schema.type).toBe("string");
	});

	it("reads schema from @file path", () => {
		const dir = makeTempDir();
		const file = join(dir, "schema.json");
		writeFileSync(file, '{"type":"number"}');
		const schema = resolveSchema(`@${file}`);
		expect(schema.type).toBe("number");
	});

	it("throws on invalid JSON", () => {
		expect(() => resolveSchema("{not valid json}")).toThrow();
	});

	it("throws on non-existent file", () => {
		expect(() => resolveSchema("/tmp/__nonexistent_schema_file_12345.json")).toThrow();
	});
});

describe("validateStructuredOutput", () => {
	it("validates correct JSON matching schema", () => {
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

	it("returns error for invalid JSON", () => {
		const schema = Type.Object({ name: Type.String() });
		const result = validateStructuredOutput("not json at all", schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("JSON parse failed");
	});

	it("returns error for schema mismatch", () => {
		const schema = Type.Object({ count: Type.Number() });
		const result = validateStructuredOutput('{"count":"not a number"}', schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});

	it("returns error for missing required fields", () => {
		const schema = Type.Object({ name: Type.String(), age: Type.Number() });
		const result = validateStructuredOutput('{"name":"Alice"}', schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});

	it("coerces types with Value.Convert", () => {
		const schema = Type.Object({ count: Type.Number() });
		const result = validateStructuredOutput('{"count":"42"}', schema);
		expect(result.success).toBe(true);
		expect((result.data as { count: number }).count).toBe(42);
	});

	it("handles nested objects", () => {
		const schema = Type.Object({
			user: Type.Object({
				name: Type.String(),
				address: Type.Object({
					city: Type.String(),
				}),
			}),
		});
		const result = validateStructuredOutput('{"user":{"name":"Bob","address":{"city":"NYC"}}}', schema);
		expect(result.success).toBe(true);
		expect((result.data as { user: { name: string; address: { city: string } } }).user.address.city).toBe("NYC");
	});

	it("handles arrays", () => {
		const schema = Type.Object({
			numbers: Type.Array(Type.Number()),
		});
		const result = validateStructuredOutput('{"numbers":[1,2,3]}', schema);
		expect(result.success).toBe(true);
		expect((result.data as { numbers: number[] }).numbers).toEqual([1, 2, 3]);
	});

	it("includes raw text in result", () => {
		const raw = '{"name":"test"}';
		const schema = Type.Object({ name: Type.String() });
		const result = validateStructuredOutput(raw, schema);
		expect(result.raw).toBe(raw);
	});

	it("strips markdown code block without language hint", () => {
		const schema = Type.Object({ value: Type.Number() });
		const result = validateStructuredOutput('```\n{"value":123}\n```', schema);
		expect(result.success).toBe(true);
		expect((result.data as { value: number }).value).toBe(123);
	});

	it("handles boolean type correctly", () => {
		const schema = Type.Object({ active: Type.Boolean() });
		const result = validateStructuredOutput('{"active":true}', schema);
		expect(result.success).toBe(true);
		expect((result.data as { active: boolean }).active).toBe(true);
	});

	it("returns error for extra properties with additionalProperties false", () => {
		const schema = Type.Object({ name: Type.String() }, { additionalProperties: false });
		const result = validateStructuredOutput('{"name":"test","extra":1}', schema);
		expect(result.success).toBe(false);
		expect(result.error).toContain("Schema validation failed");
	});

	it("handles empty object schema", () => {
		const schema = Type.Object({}, { additionalProperties: false });
		const result = validateStructuredOutput("{}", schema);
		expect(result.success).toBe(true);
		expect(result.data).toEqual({});
	});
});
