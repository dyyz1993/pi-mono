import { readFileSync } from "node:fs";
import type { TSchema } from "typebox";
import { Compile } from "typebox/compile";
import { Value } from "typebox/value";
import { stripMarkdownCodeBlock } from "../core/tools/strip-markdown.ts";

export interface StructuredOutputResult {
	success: boolean;
	data?: unknown;
	error?: string;
	raw: string;
}

export function resolveSchema(value: string): TSchema {
	let json: string;
	if (value.startsWith("{")) {
		json = value;
	} else {
		const filePath = value.startsWith("@") ? value.slice(1) : value;
		json = readFileSync(filePath, "utf-8");
	}
	return JSON.parse(json) as TSchema;
}

export function validateStructuredOutput(raw: string, schema: TSchema): StructuredOutputResult {
	const cleaned = stripMarkdownCodeBlock(raw);

	let parsed: unknown;
	try {
		parsed = JSON.parse(cleaned);
	} catch (error) {
		return {
			success: false,
			error: `JSON parse failed: ${error instanceof Error ? error.message : String(error)}`,
			raw,
		};
	}

	try {
		const validator = Compile(schema);
		const converted = Value.Convert(schema, parsed);
		if (!validator.Check(converted)) {
			const errors = [...validator.Errors(converted)]
				.map((error) => `${error.instancePath}: ${error.message}`)
				.join("; ");
			return {
				success: false,
				error: `Schema validation failed: ${errors}`,
				raw,
			};
		}

		return {
			success: true,
			data: converted,
			raw,
		};
	} catch (error) {
		return {
			success: false,
			error: `Schema compilation failed: ${error instanceof Error ? error.message : String(error)}`,
			raw,
		};
	}
}
