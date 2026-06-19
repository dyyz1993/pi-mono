import type { AgentTool } from "@dyyz1993/pi-agent-core";
import { Text } from "@dyyz1993/pi-tui";
import { readFileSync } from "fs";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import { stripFrontmatter } from "../../utils/frontmatter.ts";
import type { AgentSessionEvent } from "../agent-session.ts";
import type { ToolDefinition, ToolRenderResultOptions } from "../extensions/types.ts";
import type { Skill } from "../skills.ts";
import { runSubtask, type SubtaskContext } from "../subtask.ts";
import { str } from "./render-utils.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const skillSchema = Type.Object({
	name: Type.String({
		description: "The name of a skill from the available-skills list. Do not guess names.",
	}),
	args: Type.Optional(
		Type.String({
			description: "Optional arguments for the skill",
		}),
	),
});

export type SkillToolInput = Static<typeof skillSchema>;

export interface SkillToolOptions {
	/** Function to resolve skills by name. */
	getSkills: () => Skill[];
	/** Context for running forked subtasks. Required for context:fork skills. */
	subtaskContext?: SubtaskContext;
	/** Optional callback to forward child session events to the parent session (for transparency). */
	onSubtaskEvent?: (subtaskId: string, label: string | undefined, inner: AgentSessionEvent) => void;
	/** Optional callback when a fork subtask completes, for persistence with timing. */
	onSubtaskComplete?: (
		subtaskId: string,
		label: string,
		result: { success: boolean; text: string; error?: string; startedAt: number; completedAt: number },
	) => void;
}

function formatSkillCall(args: { name?: string; args?: string } | undefined, theme: any): string {
	const skillName = str(args?.name);
	const skillArgs = args?.args;
	let text = `${theme.fg("toolTitle", theme.bold("skill"))} ${theme.fg("accent", skillName)}`;
	if (skillArgs) {
		text += ` ${theme.fg("dim", skillArgs)}`;
	}
	return text;
}

function formatSkillResult(
	result: { content: { type: string; text?: string }[] },
	options: ToolRenderResultOptions,
	theme: Theme,
): string {
	if (!options.expanded) {
		return "";
	}
	const output = result.content
		.filter((c) => c.type === "text")
		.map((c) => c.text || "")
		.join("\n");
	if (!output) return "";
	return `\n${theme.fg("toolOutput", output)}`;
}

export function createSkillToolDefinition(options: SkillToolOptions): ToolDefinition<typeof skillSchema, undefined> {
	const { getSkills, subtaskContext, onSubtaskEvent, onSubtaskComplete } = options;

	return {
		name: "skill",
		label: "skill",
		description: `Load a skill's full instructions by name. Skills provide specialized capabilities and domain knowledge. Available skills are listed in the <available_skills> section of the system prompt. Pass the exact skill name (no leading slash). Use this tool when the user's task matches a skill's description. Do not use this tool for built-in CLI commands.`,
		promptSnippet: "Load specialized skill instructions",
		promptGuidelines: [
			"When the user's task matches a skill description, use the skill tool to load its instructions.",
			"Only invoke a skill that appears in the available_skills list.",
		],
		parameters: skillSchema,
		async execute(toolCallId, { name, args }, _signal?, _onUpdate?, _ctx?) {
			const skills = getSkills();
			const skill = skills.find((s) => s.name.toLowerCase() === name.toLowerCase());

			if (!skill) {
				const available = skills.map((s) => s.name).join(", ");
				return {
					content: [
						{
							type: "text" as const,
							text: `Skill "${name}" not found. Available skills: ${available || "(none)"}`,
						},
					],
					details: undefined,
				};
			}

			try {
				// Fork mode: run in isolated subtask
				if (skill.context === "fork" && subtaskContext) {
					const rawContent = readFileSync(skill.filePath, "utf-8");
					const body = stripFrontmatter(rawContent).trim();
					const task = args ? `${body}\n\nAdditional context: ${args}` : body;

					const result = await runSubtask(
						{
							task,
							inheritHistory: false,
							onEvent: (event) => {
								if (!onSubtaskEvent) return;
								if (event.type === "message_update" || event.type === "tool_execution_update") return;
								onSubtaskEvent(toolCallId, name, event);
							},
						},
						subtaskContext,
					);

					onSubtaskComplete?.(toolCallId, name, {
						success: result.success,
						text: result.text,
						error: result.error,
						startedAt: result.startedAt,
						completedAt: result.completedAt,
					});

					if (result.success) {
						return {
							content: [{ type: "text" as const, text: result.text }],
							details: undefined,
						};
					}
					return {
						content: [
							{
								type: "text" as const,
								text: `Forked skill "${name}" failed: ${result.error || "unknown error"}`,
							},
						],
						details: undefined,
					};
				}

				// Inline mode (default): inject into main session
				const rawContent = readFileSync(skill.filePath, "utf-8");
				const body = stripFrontmatter(rawContent).trim();
				const skillBlock = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
				const text = args ? `${skillBlock}\n\n${args}` : skillBlock;
				return {
					content: [{ type: "text" as const, text }],
					details: undefined,
				};
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err);
				return {
					content: [
						{
							type: "text" as const,
							text: `Failed to load skill "${name}": ${message}`,
						},
					],
					details: undefined,
				};
			}
		},
		renderCall(args, theme, _context) {
			const text = (_context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatSkillCall(args, theme));
			return text;
		},
		renderResult(result, options, theme, _context) {
			const text = (_context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatSkillResult(result, options, theme));
			return text;
		},
	};
}

export function createSkillTool(options: SkillToolOptions): AgentTool<typeof skillSchema> {
	return wrapToolDefinition(createSkillToolDefinition(options));
}
