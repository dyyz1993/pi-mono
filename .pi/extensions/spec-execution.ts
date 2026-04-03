/**
 * Spec-Driven Execution Extension
 *
 * A workflow that enforces strict spec-based execution:
 * 1. User triggers with shortcut + task description
 * 2. Generates spec.md / tasks.md / checklist.md
 * 3. User confirms to execute
 * 4. Agent strictly follows the 3 files
 * 5. Auto-validates completion against checklist
 *
 * Usage:
 * - Ctrl+Shift+S: Start spec-driven workflow (enters task description mode)
 * - Extension automatically enforces completion
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key, matchesKey } from "@mariozechner/pi-tui";
import { Type } from "@sinclair/typebox";

interface TaskItem {
	checked: boolean;
	description: string;
}

interface ChecklistItem {
	passed: boolean;
	description: string;
	evidence?: string;
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

function escapeMarkdown(text: string): string {
	return text
		.replace(/[*_`#\\]/g, "\\$&")
		.replace(/\n/g, "\\n");
}

function generateSpecTemplate(taskDescription: string): string {
	return `# Specification

## Overview
${taskDescription}

## Requirements
- [ ] Feature 1
- [ ] Feature 2

## Boundaries
- What this does NOT do

## Acceptance Criteria
- [ ] Criteria 1
- [ ] Criteria 2
`;
}

function generateTasksTemplate(): string {
	return `# Tasks

## Execution Order
- [ ] 1. Task description
- [ ] 2. Task description
`;
}

function generateChecklistTemplate(): string {
	return `# Checklist

## Pre-Execution
- [ ] All dependencies available
- [ ] Environment configured

## Post-Execution
- [ ] All tasks completed (100%)
- [ ] No errors in output
- [ ] Code passes lint/typecheck
- [ ] Tests pass (if applicable)

## Final Validation
- [ ] spec.md requirements met
- [ ] tasks.md all checked
- [ ] deliverables produced
`;
}

function parseTasksFile(content: string): TaskItem[] {
	const tasks: TaskItem[] = [];
	const lines = content.split("\n");
	for (const line of lines) {
		const match = line.match(/- \[([ x])\] \d+\. (.+)/);
		if (match) {
			tasks.push({
				checked: match[1] === "x",
				description: match[2].trim(),
			});
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
			items.push({
				passed: match[1] === "x",
				description: match[2].trim(),
			});
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
		report += `### ✅ COMPLETE\n\nAll tasks and checklist items passed.\n`;
	} else {
		report += `### ❌ INCOMPLETE\n\n`;
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

export default function specExecutionExtension(pi: ExtensionAPI): void {
	let executionState: SpecExecutionState | null = null;
	let inputMode: "none" | "task-description" | "confirmation" = "none";

	pi.registerFlag("spec-exec", {
		description: "Enable spec-driven execution mode",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("spec", {
		description: "Start spec-driven execution workflow",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Spec execution requires UI mode", "error");
				return;
			}
			inputMode = "task-description";
			ctx.ui.notify("Enter task description. Use Ctrl+G to generate spec files.", "info");
		},
	});

	pi.registerCommand("spec-generate", {
		description: "Generate spec files from current task description",
		handler: async (_args, ctx) => {
			const editorText = ctx.ui.getEditorText();
			if (!editorText.trim()) {
				ctx.ui.notify("Please enter a task description first", "warning");
				return;
			}

			const specDir = ensureSpecDir(ctx.cwd);
			const timestamp = Date.now();

			const specPath = path.join(specDir, `spec-${timestamp}.md`);
			const tasksPath = path.join(specDir, `tasks-${timestamp}.md`);
			const checklistPath = path.join(specDir, `checklist-${timestamp}.md`);

			fs.writeFileSync(specPath, generateSpecTemplate(editorText), "utf-8");
			fs.writeFileSync(tasksPath, generateTasksTemplate(), "utf-8");
			fs.writeFileSync(checklistPath, generateChecklistTemplate(), "utf-8");

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

			ctx.ui.notify(
				`Spec files generated:\n- ${path.basename(specPath)}\n- ${path.basename(tasksPath)}\n- ${path.basename(checklistPath)}\n\nEdit these files, then use /spec-confirm to proceed.`,
				"info",
			);

			inputMode = "confirmation";
		},
	});

	pi.registerCommand("spec-confirm", {
		description: "Confirm and start execution after spec files are ready",
		handler: async (_args, ctx) => {
			if (!executionState || !executionState.specGenerated) {
				ctx.ui.notify("No spec generated. Use /spec first.", "warning");
				return;
			}

			const specContent = fs.readFileSync(executionState.specPath, "utf-8");
			const tasksContent = fs.readFileSync(executionState.tasksPath, "utf-8");
			const checklistContent = fs.readFileSync(executionState.checklistPath, "utf-8");

			executionState.tasks = parseTasksFile(tasksContent);
			executionState.checklist = parseChecklistFile(checklistContent);
			executionState.userConfirmed = true;

			ctx.ui.notify(
				`Execution started!\n\nTasks: ${executionState.tasks.length}\nChecklist: ${executionState.checklist.length}\n\nStrict mode enabled.`,
				"info",
			);

			inputMode = "none";

			pi.sendMessage(
				{
					customType: "spec-execution-start",
					content: `[SPEC EXECUTION MODE - STRICT]

You must follow these files exactly:
- ${executionState.specPath}
- ${executionState.tasksPath}
- ${executionState.checklistPath}

RULES:
1. Complete ALL tasks in tasks.md (all must be checked)
2. Meet ALL checklist criteria
3. Do NOT add, skip, or modify requirements
4. Report progress after each task
5. Use [DONE:n] markers to mark completed tasks

Begin execution.`,
					display: false,
				},
				{ triggerTurn: true },
			);
		},
	});

	pi.registerCommand("spec-status", {
		description: "Show current execution status",
		handler: async (_args, ctx) => {
			if (!executionState) {
				ctx.ui.notify("No active spec execution", "info");
				return;
			}

			const totalTasks = executionState.tasks.length;
			const completedTasks = executionState.tasks.filter((t) => t.checked).length;
			const totalChecklist = executionState.checklist.length;
			const passedChecklist = executionState.checklist.filter((c) => c.passed).length;

			const tasksPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
			const checklistPercent = totalChecklist > 0 ? Math.round((passedChecklist / totalChecklist) * 100) : 0;

			let status = `**Spec Execution Status**\n\n`;
			status += `Tasks: ${completedTasks}/${totalTasks} (${tasksPercent}%)\n`;
			status += `Checklist: ${passedChecklist}/${totalChecklist} (${checklistPercent}%)\n\n`;

			if (executionState.userConfirmed) {
				status += `**Mode**: Strict enforcement enabled\n`;
				status += `**Files**: \n  - ${path.basename(executionState.specPath)}\n  - ${path.basename(executionState.tasksPath)}\n  - ${path.basename(executionState.checklistPath)}\n`;
			} else {
				status += `**Status**: Waiting for confirmation (/spec-confirm)`;
			}

			ctx.ui.notify(status, "info");
		},
	});

	pi.registerCommand("spec-complete", {
		description: "Mark current task as complete and validate",
		handler: async (_args, ctx) => {
			if (!executionState || !executionState.userConfirmed) {
				ctx.ui.notify("No active execution. Use /spec first.", "warning");
				return;
			}

			const currentIndex = executionState.currentTaskIndex;
			if (currentIndex >= executionState.tasks.length) {
				ctx.ui.notify("All tasks completed!", "info");
				return;
			}

			executionState.tasks[currentIndex].checked = true;
			executionState.currentTaskIndex++;

			fs.writeFileSync(
				executionState.tasksPath,
				"# Tasks\n\n## Execution Order\n" +
					executionState.tasks
						.map((t, i) => `- [${t.checked ? "x" : " "}] ${i + 1}. ${t.description}`)
						.join("\n"),
				"utf-8",
			);

			const remaining = executionState.tasks.filter((t) => !t.checked).length;
			ctx.ui.notify(
				`Task ${currentIndex + 1} complete. ${remaining} tasks remaining.`,
				"info",
			);
		},
	});

	pi.registerCommand("spec-validate", {
		description: "Validate current execution state against checklist",
		handler: async (_args, ctx) => {
			if (!executionState || !executionState.userConfirmed) {
				ctx.ui.notify("No active execution. Use /spec first.", "warning");
				return;
			}

			const report = generateValidationReport(executionState);
			ctx.ui.notify(report, "info");
		},
	});

	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Start spec-driven execution workflow",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.setEditorText("/spec\n");
		},
	});

	pi.on("turn_end", async (event, ctx) => {
		if (!executionState || !executionState.userConfirmed) return;

		const msg = event.message;
		if (msg.role !== "assistant") return;

		const content = typeof msg.content === "string" ? msg.content : "";
		const doneMatches = content.match(/\[DONE:(\d+)\]/g);
		if (doneMatches) {
			for (const match of doneMatches) {
				const taskNum = parseInt(match.match(/\[DONE:(\d+)\]/)?.[1] || "0", 10);
				if (taskNum > 0 && taskNum <= executionState.tasks.length) {
					executionState.tasks[taskNum - 1].checked = true;
				}
			}

			fs.writeFileSync(
				executionState.tasksPath,
				"# Tasks\n\n## Execution Order\n" +
					executionState.tasks
						.map((t, i) => `- [${t.checked ? "x" : " "}] ${i + 1}. ${t.description}`)
						.join("\n"),
				"utf-8",
			);
		}

		const totalTasks = executionState.tasks.length;
		const completedTasks = executionState.tasks.filter((t) => t.checked).length;
		if (completedTasks === totalTasks && totalTasks > 0) {
			ctx.ui.notify("All tasks completed! Run /spec-validate for final check.", "info");
		}
	});

	pi.on("agent_end", async (event, ctx) => {
		if (!executionState || !executionState.userConfirmed) return;

		const report = generateValidationReport(executionState);
		const totalTasks = executionState.tasks.length;
		const completedTasks = executionState.tasks.filter((t) => t.checked).length;
		const checklistPercent =
			executionState.checklist.length > 0
				? Math.round(
						(executionState.checklist.filter((c) => c.passed).length / executionState.checklist.length) * 100,
					)
				: 0;

		const isComplete = completedTasks === totalTasks && checklistPercent === 100;

		pi.sendMessage(
			{
				customType: "spec-execution-complete",
				content: report + (isComplete ? "\n\n### 🎉 Task complete!" : "\n\n### ⚠️ Validation failed. Complete remaining items."),
				display: true,
			},
			{ triggerTurn: false },
		);

		executionState = null;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("spec-exec") === true) {
			ctx.ui.notify("Spec execution mode enabled", "info");
		}
	});
}