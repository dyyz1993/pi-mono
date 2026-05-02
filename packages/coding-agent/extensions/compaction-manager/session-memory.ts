import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { CompactionPreparation, CompactionResult } from "@dyyz1993/pi-coding-agent";

export type { CompactionPreparation, CompactionResult };

export function buildMemorySummary(
	memoryFiles: Map<string, string>,
	preparation: CompactionPreparation,
	minContentLength: number,
): CompactionResult | undefined {
	if (memoryFiles.size === 0) return undefined;

	const parts: string[] = [];
	for (const [name, content] of memoryFiles) {
		parts.push(`### ${name}\n${content}`);
	}
	const summary = parts.join("\n\n---\n\n");

	if (summary.trim().length < minContentLength) return undefined;

	const estimatedTokens = Math.ceil(summary.length / 4);
	if (estimatedTokens > preparation.settings.reserveTokens) return undefined;

	return {
		summary,
		firstKeptEntryId: preparation.firstKeptEntryId,
		tokensBefore: preparation.tokensBefore,
	};
}

export async function readMemoryFiles(cwd: string, memoryDir: string): Promise<Map<string, string>> {
	const dir = join(cwd, memoryDir);
	const files = new Map<string, string>();

	try {
		const entries = await readdir(dir);
		for (const entry of entries) {
			if (!entry.endsWith(".md")) continue;
			const content = await readFile(join(dir, entry), "utf-8");
			files.set(entry, content);
		}
	} catch {
		// directory doesn't exist
	}

	return files;
}
