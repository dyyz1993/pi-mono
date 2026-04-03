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
	const title = taskDescription.replace(/^#\s*/, "").split("\n")[0].trim();
	return `# ${title} Specification

## Why
<!-- Why this feature is needed. What problem does it solve? -->

## What Changes
<!-- What exactly changes in this implementation -->

## Impact
<!-- Side effects, breaking changes, performance implications -->

## ADDED Requirements

### Scenario 1: When-Then
- [ ] 

## MODIFIED Requirements (if any)
- [ ]

## Data Structures
\`\`\`typescript
// Define TypeScript interfaces here
\`\`\`

## Architecture
<!-- Architecture data flow, module relationships -->

## Implementation Files
<!-- File list to be created/modified:
- src/...
- test/...
-->

## Verification Criteria
- [ ] Unit tests pass
- [ ] Integration tests pass
- [ ] Manual verification steps
`;
}

function generateTasksTemplate(): string {
	return `# Tasks - Implementation

## Task List (in coding order, with file paths)
- [ ] 1. 
- [ ] 2. 

## Task Dependencies
<!-- Dependencies:
Task 1 → Task 2 → Task 3
-->

## Verification Steps
### Task 1
1. 

### Task 2
1. 
`;
}

function generateChecklistTemplate(): string {
	return `# Checklist - Implementation

## Code Implementation Checklist (per task)
- [ ] Task 1: Code written
- [ ] Task 1: Types defined
- [ ] Task 1: Error handling added
- [ ] Task 2: Code written
- [ ] Task 2: Types defined
- [ ] Task 2: Error handling added

## Build and Verification Checklist
- [ ] TypeScript compiles without errors
- [ ] Lint passes (\`npm run check\`)
- [ ] No new TypeScript errors introduced

## Functional Verification Checklist
- [ ] Feature works as specified in spec.md
- [ ] Edge cases handled
- [ ] Error messages are user-friendly
- [ ] Performance acceptable
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
		handler: async (args, ctx) => {
			let taskDescription = "";
			
			if (args && args.trim()) {
				taskDescription = args.trim();
			} else if (ctx.hasUI) {
				taskDescription = ctx.ui.getEditorText();
			}
			
			if (!taskDescription.trim()) {
				ctx.ui.notify("Please enter a task description first", "warning");
				return;
			}

			const specDir = ensureSpecDir(ctx.cwd);
			const timestamp = Date.now();

			const specPath = path.join(specDir, `spec-${timestamp}.md`);
			const tasksPath = path.join(specDir, `tasks-${timestamp}.md`);
			const checklistPath = path.join(specDir, `checklist-${timestamp}.md`);

			fs.writeFileSync(specPath, generateSpecTemplate(taskDescription), "utf-8");
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
					content: `## [SPEC EXECUTION MODE - STRICT]

You must execute this task by strictly following these 3 files:
- \`${executionState.specPath}\` - Requirements, boundaries, acceptance criteria
- \`${executionState.tasksPath}\` - Ordered task list, MUST complete ALL items
- \`${executionState.checklistPath}\` - Validation checklist, ALL items must pass

### Execution Rules

1. **READ FILES**: Read all 3 spec files at the start. Understand the requirements.

2. **TASKS**: Execute items in tasks.md in order. After completing task N, output \`[DONE:N]\` in your response.

3. **PROGRESS**: After each tool execution, report: "Task N: done. Remaining: X tasks."

4. **BLOCKING**: If you cannot proceed (missing info, environment issue, unclear requirement), output exactly:
   \`【阻塞】具体原因\`
   Do NOT skip or guess. Wait for human clarification.

5. **VALIDATION**: Before completing, verify against checklist.md. Update the file with \`[x]\` for passed items.

6. **FILES**: You MUST read and write to the 3 spec files to track progress. Do NOT assume what's in them.

7. **COMPLETION**: When ALL tasks are checked AND ALL checklist items pass, output:
   \`【任务已完成】\`
   With a summary of: total tasks, completed tasks, checklist pass rate.

### Forbidden
- Do NOT add new requirements not in spec.md
- Do NOT skip tasks in tasks.md
- Do NOT mark tasks as done without actual execution
- Do NOT finish without validation report

Begin execution now.`,
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