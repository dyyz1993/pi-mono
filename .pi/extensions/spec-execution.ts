/**
 * Spec-Driven Execution Extension
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";

interface TaskItem {
	checked: boolean;
	description: string;
}

interface ChecklistItem {
	passed: boolean;
	description: string;
}

interface SpecExecutionState {
	specGenerated: boolean;
	userConfirmed: boolean;
	tasks: TaskItem[];
	checklist: ChecklistItem[];
	currentTaskIndex: number;
	specPath: string;
	tasksPath: string;
	checklistPath: string;
}

const SPEC_DIR = ".pi/spec-execution";

function ensureSpecDir(cwd: string): string {
	const specDir = path.join(cwd, SPEC_DIR);
	if (!fs.existsSync(specDir)) {
		fs.mkdirSync(specDir, { recursive: true });
	}
	return specDir;
}

function parseTasksFile(content: string): TaskItem[] {
	const tasks: TaskItem[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const match = line.match(/- \[([ x])\] \d+\. (.+)/);
		if (match) {
			tasks.push({ checked: match[1] === "x", description: match[2].trim() });
		}
	}
	return tasks;
}

function parseChecklistFile(content: string): ChecklistItem[] {
	const items: ChecklistItem[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const match = line.match(/- \[([ x])\] (.+)/);
		if (match) {
			items.push({ passed: match[1] === "x", description: match[2].trim() });
		}
	}
	return items;
}

function generateValidationReport(state: SpecExecutionState): string {
	const totalTasks = state.tasks.length;
	const completedTasks = state.tasks.filter((t) => t.checked).length;
	const totalChecklist = state.checklist.length;
	const passedChecklist = state.checklist.filter((c) => c.passed).length;
	const tasksPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
	const checklistPercent = totalChecklist > 0 ? Math.round((passedChecklist / totalChecklist) * 100) : 0;

	let report = `## Validation Report\n\n`;
	report += `**Tasks**: ${completedTasks}/${totalTasks} (${tasksPercent}%)\n`;
	report += `**Checklist**: ${passedChecklist}/${totalChecklist} (${checklistPercent}%)\n\n`;

	if (tasksPercent === 100 && checklistPercent === 100) {
		report += `### COMPLETE\n\nAll tasks and checklist items passed.\n`;
	} else {
		report += `### INCOMPLETE\n\n`;
		if (tasksPercent < 100) {
			const remaining = state.tasks.filter((t) => !t.checked).map((t) => t.description).join(", ");
			report += `- Tasks remaining: ${remaining}\n`;
		}
		if (checklistPercent < 100) {
			const failed = state.checklist.filter((c) => !c.passed).map((c) => c.description).join(", ");
			report += `- Checklist failed: ${failed}\n`;
		}
	}
	return report;
}

function extractSections(content: string): { spec: string; tasks: string; checklist: string } | null {
	const lines = content.split("\n");
	const sections: { spec: string[]; tasks: string[]; checklist: string[] } = { spec: [], tasks: [], checklist: [] };
	let currentSection: "spec" | "tasks" | "checklist" | null = null;

	for (const line of lines) {
		if (line.includes("===SPEC===") || line.startsWith("# Specification") || line.startsWith("# SPEC")) {
			currentSection = "spec";
			continue;
		}
		if (line.includes("===TASKS===") || line.startsWith("# Tasks") || line.startsWith("# TASKS")) {
			currentSection = "tasks";
			continue;
		}
		if (line.includes("===CHECKLIST===") || line.startsWith("# Checklist") || line.startsWith("# CHECKLIST")) {
			currentSection = "checklist";
			continue;
		}
		if (currentSection) {
			sections[currentSection].push(line);
		}
	}

	const spec = sections.spec.join("\n").trim();
	const tasks = sections.tasks.join("\n").trim();
	const checklist = sections.checklist.join("\n").trim();

	if (spec.length > 50 && tasks.length > 20 && checklist.length > 10) {
		return { spec, tasks, checklist };
	}
	return null;
}

export default function specExecutionExtension(pi: ExtensionAPI): void {
	let executionState: SpecExecutionState | null = null;

	pi.registerCommand("spec-generate", {
		description: "Generate spec files with AI",
		handler: async (args, ctx) => {
			let taskDescription = args && args.trim() ? args.trim() : (ctx.hasUI ? ctx.ui.getEditorText() : "");
			
			if (!taskDescription.trim()) {
				ctx.ui.notify("Usage: /spec-generate <task description>", "warning");
				return;
			}

			ctx.ui.notify("Generating spec files with AI...", "info");

			const prompt = `Generate SPEC.md, TASKS.md, and CHECKLIST.md for: "${taskDescription}"

IMPORTANT: Start your response with these exact markers:
===SPEC===
# ${taskDescription} Specification
## Why
## What Changes
## ADDED Requirements
## Data Structures
## Architecture
## Implementation Files
## Verification Criteria

===TASKS===
# Tasks - Implementation
## Task List
- [ ] 1. 

===CHECKLIST===
# Checklist - Implementation
## Code Implementation Checklist
- [ ] 

Generate now:`;

			pi.sendMessage({ customType: "spec-generate", content: prompt, display: false }, { triggerTurn: true });
			ctx.ui.notify("AI is generating... Wait for completion message.", "info");
		},
	});

	pi.registerCommand("spec-confirm", {
		description: "Confirm and start execution",
		handler: async (_args, ctx) => {
			if (!executionState || !executionState.specGenerated) {
				ctx.ui.notify("No spec generated. Use /spec-generate first.", "warning");
				return;
			}

			let specContent = "", tasksContent = "", checklistContent = "";
			try {
				specContent = fs.readFileSync(executionState.specPath, "utf-8");
				tasksContent = fs.readFileSync(executionState.tasksPath, "utf-8");
				checklistContent = fs.readFileSync(executionState.checklistPath, "utf-8");
			} catch {
				ctx.ui.notify("Spec files not found.", "error");
				return;
			}

			if (specContent.trim().length < 50) {
				ctx.ui.notify("Spec files empty. Use /spec-generate again.", "warning");
				return;
			}

			executionState.tasks = parseTasksFile(tasksContent);
			executionState.checklist = parseChecklistFile(checklistContent);
			executionState.userConfirmed = true;

			ctx.ui.notify(`Execution started! Tasks: ${executionState.tasks.length}, Checklist: ${executionState.checklist.length}`, "info");

			pi.sendMessage({
				customType: "spec-execute",
				content: `## [STRICT MODE]

Read these files:
- ${executionState.specPath}
- ${executionState.tasksPath}
- ${executionState.checklistPath}

Execute tasks in order. Output [DONE:N] after each task.
Output 任务已完成 when all done.

Begin.`,
				display: false,
			}, { triggerTurn: true });
		},
	});

	pi.registerCommand("spec-status", {
		description: "Show status",
		handler: async (_args, ctx) => {
			if (!executionState) {
				ctx.ui.notify("No active spec. Use /spec-generate first.", "info");
				return;
			}
			const done = executionState.tasks.filter((t) => t.checked).length;
			const total = executionState.tasks.length;
			ctx.ui.notify(`Tasks: ${done}/${total}\n${executionState.userConfirmed ? "Mode: Strict" : "Status: Waiting /spec-confirm"}`, "info");
		},
	});

	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Quick start spec",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.setEditorText("/spec-generate ");
		},
	});

	pi.on("agent_end", async (event, ctx) => {
		const msg = event.messages?.find((m: any) => m?.role === "assistant" && typeof m?.content === "string");
		if (!msg) return;
		
		const content = (msg as any).content as string;
		if (!content) return;

		if (executionState?.userConfirmed) {
			const doneMatches = content.match(/\[DONE:(\d+)\]/g);
			if (doneMatches) {
				for (const match of doneMatches) {
					const num = parseInt(match.match(/\[DONE:(\d+)\]/)?.[1] || "0", 10);
					if (num > 0 && num <= executionState.tasks.length) {
						executionState.tasks[num - 1].checked = true;
					}
				}
				fs.writeFileSync(executionState.tasksPath, "# Tasks\n\n" + executionState.tasks.map((t, i) => `- [${t.checked ? "x" : " "}] ${i + 1}. ${t.description}`).join("\n"), "utf-8");
			}
			const report = generateValidationReport(executionState);
			const isComplete = executionState.tasks.every((t) => t.checked);
			pi.sendMessage({
				customType: "spec-validation",
				content: report + (isComplete ? "\n\n### Done!" : "\n\n### Incomplete"),
				display: true,
			}, { triggerTurn: false });
			executionState = null;
			return;
		}

		const sections = extractSections(content);
		if (sections) {
			const specDir = ensureSpecDir(ctx.cwd);
			const timestamp = Date.now();
			const specPath = path.join(specDir, `spec-${timestamp}.md`);
			const tasksPath = path.join(specDir, `tasks-${timestamp}.md`);
			const checklistPath = path.join(specDir, `checklist-${timestamp}.md`);
			
			fs.writeFileSync(specPath, sections.spec, "utf-8");
			fs.writeFileSync(tasksPath, sections.tasks, "utf-8");
			fs.writeFileSync(checklistPath, sections.checklist, "utf-8");
			
			executionState = {
				specGenerated: true,
				userConfirmed: false,
				tasks: [],
				checklist: [],
				currentTaskIndex: 0,
				specPath,
				tasksPath,
				checklistPath,
			};
			
			ctx.ui.notify(`Spec files saved!\n- ${path.basename(specPath)}\n- ${path.basename(tasksPath)}\n- ${path.basename(checklistPath)}\n\nUse /spec-confirm to start.`, "info");
			return;
		}

		if (content.includes("SPEC") || content.includes("Tasks") || content.includes("Checklist")) {
			const specDir = ensureSpecDir(ctx.cwd);
			const rawPath = path.join(specDir, `raw-ai-output-${Date.now()}.txt`);
			fs.writeFileSync(rawPath, content, "utf-8");
			ctx.ui.notify(`AI output saved to raw file for debugging:\n${path.basename(rawPath)}\n\nExpected format not detected. Check file.`, "warning");
		}
	});
}