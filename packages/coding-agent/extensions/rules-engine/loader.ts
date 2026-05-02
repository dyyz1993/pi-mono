import * as fs from "node:fs";
import * as path from "node:path";
import type { ParsedRule, RuleCache, RuleFrontmatter } from "./types.js";

function splitComma(val: string): string[] {
	const result: string[] = [];
	let depth = 0;
	let current = "";
	for (const ch of val) {
		if (ch === "{" || ch === "(" || ch === "[") depth++;
		else if (ch === "}" || ch === ")" || ch === "]") depth--;

		if (ch === "," && depth === 0) {
			const trimmed = current.trim().replace(/^["']|["']$/g, "");
			if (trimmed) result.push(trimmed);
			current = "";
		} else {
			current += ch;
		}
	}
	const trimmed = current.trim().replace(/^["']|["']$/g, "");
	if (trimmed) result.push(trimmed);
	return result;
}

export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
	const frontmatterRegex = /^---\r?\n([\s\S]*?)\n?---\r?\n([\s\S]*)$/;
	const match = content.match(frontmatterRegex);

	if (!match) {
		return { data: {}, body: content };
	}

	const [, frontmatterStr, body] = match;
	const data: Record<string, unknown> = {};

	const lines = frontmatterStr.split("\n");
	let i = 0;
	while (i < lines.length) {
		const line = lines[i];
		const colonIndex = line.indexOf(":");
		if (colonIndex === -1) {
			i++;
			continue;
		}

		const rawKey = line.slice(0, colonIndex).trim();
		let value: string | string[] | null = line.slice(colonIndex + 1).trim();

		if (value === "" || value === "null" || value === "undefined") {
			const listItems: string[] = [];
			let j = i + 1;
			while (j < lines.length) {
				const subLine = lines[j];
				if (subLine.match(/^\s*-\s+/)) {
					listItems.push(
						subLine
							.replace(/^\s*-\s+/, "")
							.trim()
							.replace(/^["']|["']$/g, ""),
					);
					j++;
				} else if (subLine.trim() === "" || subLine.match(/^\s+/)) {
					j++;
				} else {
					break;
				}
			}
			if (listItems.length > 0) {
				const camelKey = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
				data[camelKey] = listItems;
				i = j;
				continue;
			}
			value = null;
		} else if (value.startsWith("[") && value.endsWith("]")) {
			try {
				value = JSON.parse(value.replace(/'/g, '"'));
			} catch {
				value = (value as string)
					.slice(1, -1)
					.split(",")
					.map((v: string) => v.trim().replace(/^["']|["']$/g, ""));
			}
		} else if (value.startsWith('"') && value.endsWith('"')) {
			value = value.slice(1, -1);
		} else if (value.startsWith("'") && value.endsWith("'")) {
			value = value.slice(1, -1);
		}

		const camelKey = rawKey.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());

		if ((camelKey === "paths" || camelKey === "globs") && typeof value === "string") {
			data[camelKey] = splitComma(value);
		} else {
			data[camelKey] = value;
		}
		i++;
	}

	return { data, body: body.trim() };
}

function extractTitle(body: string): string {
	for (const line of body.split("\n")) {
		const trimmed = line.trim();
		if (trimmed) {
			return trimmed.replace(/^#+\s*/, "").replace(/\*\*/g, "");
		}
	}
	return "Untitled Rule";
}

function parsePaths(raw: unknown): string[] {
	if (!raw) return [];
	if (typeof raw === "string") {
		return raw
			.split(",")
			.map((g) => g.trim())
			.filter(Boolean);
	}
	if (Array.isArray(raw)) return raw as string[];
	return [];
}

export function parseRuleFile(filePath: string, content: string): ParsedRule {
	const { data, body } = parseFrontmatter(content);
	const rawGlobs = data.globs ?? data.paths;
	const globs = parsePaths(rawGlobs);
	const isUnconditional = globs.length === 0 || (globs.length === 1 && globs[0] === "**");

	const frontmatter: RuleFrontmatter = {};
	if (rawGlobs) {
		frontmatter.globs = globs;
		if (data.paths) frontmatter.paths = globs;
	}
	if (data.description && typeof data.description === "string") frontmatter.description = data.description;
	if (data.severity && typeof data.severity === "string")
		frontmatter.severity = data.severity as ParsedRule["frontmatter"]["severity"];
	if (data.allowedTools)
		frontmatter.allowedTools =
			typeof data.allowedTools === "string" ? [data.allowedTools] : (data.allowedTools as string[]);
	if (data.whenToUse && typeof data.whenToUse === "string") frontmatter.whenToUse = data.whenToUse;
	if (data.notifyOnMatch !== undefined)
		frontmatter.notifyOnMatch = data.notifyOnMatch === "true" || data.notifyOnMatch === true;
	if (data.skipInPrompt !== undefined)
		frontmatter.skipInPrompt = data.skipInPrompt === "true" || data.skipInPrompt === true;

	return {
		name: path.basename(filePath, path.extname(filePath)),
		filePath,
		title: extractTitle(body),
		content: body.trim(),
		scope: "project",
		source: "",
		frontmatter,
		isUnconditional,
	};
}

function scanDir(dir: string, files: string[] = []): string[] {
	if (!fs.existsSync(dir)) return files;
	const entries = fs.readdirSync(dir, { withFileTypes: true });
	for (const entry of entries) {
		const fullPath = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			scanDir(fullPath, files);
		} else if (entry.isFile() && (entry.name.endsWith(".md") || entry.name.endsWith(".mdc"))) {
			files.push(fullPath);
		}
	}
	return files;
}

export function loadRules(rulesDir: string): RuleCache {
	const rules: ParsedRule[] = [];
	const unconditional: ParsedRule[] = [];
	const conditional: ParsedRule[] = [];

	if (!fs.existsSync(rulesDir)) {
		return { rules, unconditional, conditional, loadedAt: Date.now() };
	}

	const files = scanDir(rulesDir);

	for (const filePath of files) {
		const content = fs.readFileSync(filePath, "utf-8");
		const rule = parseRuleFile(filePath, content);
		rules.push(rule);
		if (rule.isUnconditional) {
			unconditional.push(rule);
		} else {
			conditional.push(rule);
		}
	}

	return { rules, unconditional, conditional, loadedAt: Date.now() };
}
