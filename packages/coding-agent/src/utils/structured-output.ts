import { readFileSync } from "node:fs";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { stripMarkdownCodeBlock } from "../core/tools/strip-markdown.js";

export interface StructuredOutputResult {
	success: boolean;
	data?: unknown;
	error?: string;
	raw: string;
}

export function resolveSchema(value: string): TSchema {
	let jsonStr: string;
	if (value.startsWith("{")) {
		jsonStr = value;
	} else {
		const filePath = value.startsWith("@") ? value.slice(1) : value;
		jsonStr = readFileSync(filePath, "utf-8");
	}
	return JSON.parse(jsonStr) as TSchema;
}

export function validateStructuredOutput(raw: string, schema: TSchema): StructuredOutputResult {
	const cleaned = stripMarkdownCodeBlock(raw);

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch (e) {
		return {
			success: false,
			error: `JSON parse failed: ${(e as Error).message}`,
			raw,
		};
	}

	try {
		const check = Compile(schema);
		const coerced = Value.Convert(schema, parsed);
		if (!check.Check(coerced)) {
			const errors = check
				.Errors(coerced)
				.map((e) => `${e.instancePath}: ${e.message}`)
				.join("; ");
			return {
				success: false,
				error: `Schema validation failed: ${errors}`,
				raw,
			};
		}
		return {
			success: true,
			data: coerced,
			raw,
		};
	} catch (e) {
		return {
			success: false,
			error: `Schema compilation failed: ${(e as Error).message}`,
			raw,
		};
	}
}
