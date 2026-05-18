export interface LspPosition {
	line: number;
	character: number;
}

export interface LspRange {
	start: LspPosition;
	end: LspPosition;
}

export interface LspDiagnostic {
	range: LspRange;
	severity?: number;
	code?: string | number;
	source?: string;
	message: string;
}

export function normalizeRange(raw: unknown): LspRange | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	const start = normalizePosition(record.start);
	const end = normalizePosition(record.end);
	if (!start || !end) return undefined;
	return { start, end };
}

export function normalizePosition(raw: unknown): LspPosition | undefined {
	if (!raw || typeof raw !== "object") return undefined;
	const record = raw as Record<string, unknown>;
	if (typeof record.line !== "number" || typeof record.character !== "number") return undefined;
	return { line: record.line, character: record.character };
}

export function languageIdFromPath(filePath: string): string {
	const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
	const map: Record<string, string> = {
		ts: "typescript",
		tsx: "typescriptreact",
		js: "javascript",
		jsx: "javascriptreact",
		json: "json",
		css: "css",
		html: "html",
		md: "markdown",
		py: "python",
		rs: "rust",
		go: "go",
		c: "c",
		cpp: "cpp",
		lua: "lua",
	};
	return map[ext] ?? ext;
}

export function extractPullDiagnostics(payload: unknown): LspDiagnostic[] {
	if (!payload || typeof payload !== "object") return [];
	const record = payload as Record<string, unknown>;
	const items = Array.isArray(record.items) ? record.items : [];
	const diagnostics: LspDiagnostic[] = [];
	for (const item of items) {
		if (!item || typeof item !== "object") continue;
		const d = item as Record<string, unknown>;
		if (typeof d.message !== "string") continue;
		const range = normalizeRange(d.range);
		if (!range) continue;
		diagnostics.push({
			range,
			message: d.message,
			severity: typeof d.severity === "number" ? d.severity : undefined,
			code: typeof d.code === "string" || typeof d.code === "number" ? d.code : undefined,
			source: typeof d.source === "string" ? d.source : undefined,
		});
	}
	return diagnostics;
}
