import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_INPUT_MAX_BYTES, formatSize } from "./tools/truncate.js";

export { DEFAULT_INPUT_MAX_BYTES } from "./tools/truncate.js";

export interface LargeInputResult {
	text: string;
	savedFilePath?: string;
	wasLarge: boolean;
}

const PREVIEW_HEAD_LINES = 50;
const PREVIEW_TAIL_LINES = 50;

export function handleLargeInput(text: string): LargeInputResult {
	const inputBytes = Buffer.byteLength(text, "utf-8");

	if (inputBytes <= DEFAULT_INPUT_MAX_BYTES) {
		return { text, wasLarge: false };
	}

	const tmpFile = join(tmpdir(), `pi-input-${randomUUID()}.txt`);
	writeFileSync(tmpFile, text, "utf-8");

	const lines = text.split("\n");
	const totalLines = lines.length;
	const omittedLines = totalLines - PREVIEW_HEAD_LINES - PREVIEW_TAIL_LINES;
	const head = lines.slice(0, PREVIEW_HEAD_LINES).join("\n");
	const tail = lines.slice(-PREVIEW_TAIL_LINES).join("\n");

	const preview =
		omittedLines > 0
			? `${head}\n\n... [${omittedLines} lines omitted] ...\n\n${tail}`
			: totalLines <= PREVIEW_HEAD_LINES
				? head
				: `${head}\n${tail}`;

	const replaced =
		`Your input was too large (${formatSize(inputBytes)}, ${totalLines} lines) ` +
		`and has been saved to a temporary file.\n\n` +
		`File path: ${tmpFile}\n\n` +
		`Showing first ${PREVIEW_HEAD_LINES} and last ${PREVIEW_TAIL_LINES} lines below:\n` +
		`<large_input_preview path="${tmpFile}">\n` +
		preview +
		`\n</large_input_preview>\n\n` +
		`Use the Read tool with path "${tmpFile}" to read specific sections, ` +
		`or Grep to search within it.`;

	return { text: replaced, savedFilePath: tmpFile, wasLarge: true };
}
