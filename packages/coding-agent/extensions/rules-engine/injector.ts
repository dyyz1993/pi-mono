import type { ParsedRule } from "./types.js";

const SEVERITY_ICONS: Record<string, string> = {
	critical: "🔴",
	high: "🟠",
	medium: "🟡",
	low: "🔵",
	hint: "💡",
};

export function buildSystemReminderSection(rules: ParsedRule[], sources: string[]): string {
	if (rules.length === 0) return "";

	const lines: string[] = [
		"<system-reminder>",
		`Instructions from: ${sources.join(", ")}`,
		"The following rules are always active. Follow them strictly.",
		"",
	];

	for (const rule of rules) {
		lines.push(`Rule: ${rule.name} — ${rule.title}`);
		if (rule.frontmatter.description) {
			lines.push(`> ${rule.frontmatter.description}`);
		}
		lines.push("");
		lines.push(rule.content);
		lines.push("");
	}

	lines.push("</system-reminder>");
	return lines.join("\n");
}

export function buildToolReminderSection(rules: ParsedRule[], targetPath: string): string {
	if (rules.length === 0) return "";

	const lines: string[] = [
		"<system-reminder>",
		`Conditional rules matched for ${targetPath}:`,
		"",
	];

	for (const rule of rules) {
		const severity = rule.frontmatter.severity || "medium";
		const icon = SEVERITY_ICONS[severity] || "🟡";
		lines.push(`Rule: ${icon} ${rule.title} [${severity}]`);
		if (rule.frontmatter.description) {
			lines.push(`> ${rule.frontmatter.description}`);
		}
		lines.push("");
		lines.push(rule.content);
		lines.push("");
	}

	lines.push("</system-reminder>");
	return lines.join("\n");
}

export const buildSystemPromptSection = buildSystemReminderSection;
export const buildToolContextSection = buildToolReminderSection;

export function buildCompactContext(rules: ParsedRule[]): string {
	if (rules.length === 0) return "";

	const lines: string[] = ["## Active Rules (persist across compaction)", ""];

	for (const rule of rules) {
		const desc = rule.frontmatter.description || rule.content.split("\n")[0];
		lines.push(`- **${rule.title}** (${rule.name}): ${desc}`);
	}

	return lines.join("\n");
}
