import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { TextContent } from "@mariozechner/pi-ai";
import { type Static, Type } from "@sinclair/typebox";
import { readFile as fsReadFile, stat } from "fs/promises";
import { resolve as pathResolve } from "path";

const lineCountSchema = Type.Object({
	path: Type.String({ description: "Path to the file to count lines (relative or absolute)" }),
});

export type LineCountToolInput = Static<typeof lineCountSchema>;

export interface LineCountToolDetails {
	totalLines: number;
	fileSize: number;
	fileName: string;
}

export interface LineCountToolOptions {
	encoding?: BufferEncoding;
}

export function createLineCountTool(cwd: string, options?: LineCountToolOptions): AgentTool<typeof lineCountSchema> {
	return {
		name: "line_count",
		label: "Line Count",
		description: "Count the number of lines in a text file. Returns the total line count and file size.",
		parameters: lineCountSchema,
		execute: async (_toolCallId: string, { path }: LineCountToolInput, _signal?: AbortSignal) => {
			const absolutePath = pathResolve(cwd, path);
			const encoding = options?.encoding ?? "utf-8";

			try {
				const [fileContent, fileStat] = await Promise.all([
					fsReadFile(absolutePath, { encoding }),
					stat(absolutePath),
				]);

				const lines = fileContent.split("\n");
				const totalLines = lines.length;

				const details: LineCountToolDetails = {
					totalLines,
					fileSize: fileStat.size,
					fileName: path,
				};

				const outputText = `File: ${path}\nTotal lines: ${totalLines}\nFile size: ${formatFileSize(fileStat.size)}`;

				const content: TextContent[] = [{ type: "text", text: outputText }];

				return { content, details };
			} catch (error) {
				throw new Error(`Failed to count lines: ${(error as Error).message}`);
			}
		},
	};
}

function formatFileSize(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(2)} KB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const lineCountTool = createLineCountTool(process.cwd());
