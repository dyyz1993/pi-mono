import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { Type } from "typebox";
import type { Executor } from "../sandbox.js";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult, truncateTail } from "./truncate.js";

/**
 * Generate a unique temp file path for bash output
 */
function getTempFilePath(): string {
	const id = randomBytes(8).toString("hex");
	return join(tmpdir(), `mom-bash-${id}.log`);
}

const DEFAULT_TIMEOUT_SECONDS = 300;

const bashSchema = Type.Object({
	description: Type.String({ description: "Clear, concise description of what this command does in 5-10 words" }),
	command: Type.String({ description: "Bash command to execute" }),
	timeout: Type.Optional(
		Type.Number({
			description: `Hard timeout in seconds. Process is killed if still running after this duration. Defaults to ${DEFAULT_TIMEOUT_SECONDS}s (5 minutes).`,
		}),
	),
	backgroundAfter: Type.Optional(
		Type.Number({
			description:
				"Soft limit in seconds. If the command runs longer than this, it is automatically moved to background. Must be less than timeout if both are set. Use for long-running tasks like builds or installs.",
		}),
	),
});

interface BashToolDetails {
	truncation?: TruncationResult;
	fullOutputPath?: string;
}

export function createBashTool(executor: Executor): AgentTool<typeof bashSchema> {
	return {
		name: "bash",
		label: "bash",
		description: `Execute a bash command in the current working directory. Returns stdout and stderr. Output is truncated to last ${DEFAULT_MAX_LINES} lines or ${DEFAULT_MAX_BYTES / 1024}KB (whichever is hit first). Hard timeout defaults to ${DEFAULT_TIMEOUT_SECONDS}s (5 min). Use backgroundAfter for long-running tasks to auto-move to background.`,
		parameters: bashSchema,
		execute: async (
			_toolCallId: string,
			{
				command,
				timeout,
				backgroundAfter: _backgroundAfter,
			}: { description: string; command: string; timeout?: number; backgroundAfter?: number },
			signal?: AbortSignal,
		) => {
			let tempFilePath: string | undefined;
			let tempFileStream: ReturnType<typeof createWriteStream> | undefined;
			const effectiveTimeout = timeout ?? DEFAULT_TIMEOUT_SECONDS;
			const result = await executor.exec(command, { timeout: effectiveTimeout, signal });
			let output = "";
			if (result.stdout) output += result.stdout;
			if (result.stderr) {
				if (output) output += "\n";
				output += result.stderr;
			}

			const totalBytes = Buffer.byteLength(output, "utf-8");

			// Write to temp file if output exceeds limit
			if (totalBytes > DEFAULT_MAX_BYTES) {
				tempFilePath = getTempFilePath();
				tempFileStream = createWriteStream(tempFilePath);
				tempFileStream.write(output);
				tempFileStream.end();
			}

			// Apply tail truncation
			const truncation = truncateTail(output);
			let outputText = truncation.content || "(no output)";

			// Build details with truncation info
			let details: BashToolDetails | undefined;

			if (truncation.truncated) {
				details = {
					truncation,
					fullOutputPath: tempFilePath,
				};

				// Build actionable notice
				const startLine = truncation.totalLines - truncation.outputLines + 1;
				const endLine = truncation.totalLines;

				if (truncation.lastLinePartial) {
					// Edge case: last line alone > 50KB
					const lastLineSize = formatSize(Buffer.byteLength(output.split("\n").pop() || "", "utf-8"));
					outputText += `\n\n[Showing last ${formatSize(truncation.outputBytes)} of line ${endLine} (line is ${lastLineSize}). Full output: ${tempFilePath}]`;
				} else if (truncation.truncatedBy === "lines") {
					outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines}. Full output: ${tempFilePath}]`;
				} else {
					outputText += `\n\n[Showing lines ${startLine}-${endLine} of ${truncation.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Full output: ${tempFilePath}]`;
				}
			}

			if (result.code !== 0) {
				throw new Error(`${outputText}\n\nCommand exited with code ${result.code}`.trim());
			}

			return { content: [{ type: "text", text: outputText }], details };
		},
	};
}
