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

	pi.registerFlag("spec-exec", {
		description: "Enable spec-driven execution mode",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("spec", {
		description: "Start spec-driven workflow",
		handler: async (_args, ctx) => {
			ctx.ui.notify("Use /spec-generate <task> to generate spec files with AI", "info");
		},
	});

	pi.registerCommand("spec-generate", {
		description: "Generate spec files with AI",
		handler: async (args, ctx) => {
			let taskDescription = args && args.trim() ? args.trim() : (ctx.hasUI ? ctx.ui.getEditorText() : "");
			
			if (!taskDescription.trim()) {
				ctx.ui.notify("Usage: /spec-generate <task description>", "warning");
				return;
			}

			ctx.ui.notify("Generating spec files with AI...", "info");

			const prompt = `Generate 3 complete Markdown documents for this task: "${taskDescription}"

IMPORTANT: Output exactly in this format with clear section headers:

===SPEC===
# [Module Name] Specification
## Why
## What Changes  
## Impact
## ADDED Requirements
## Data Structures
## Architecture
## Implementation Files
## Verification Criteria
===TASKS===
# Tasks - Implementation
## Task List
## Task Dependencies
## Verification Steps
===CHECKLIST===
# Checklist - Implementation
## Code Implementation Checklist
## Build and Verification Checklist
## Functional Verification Checklist

Generate now:`;

			pi.sendMessage({ customType: "spec-generator", content: prompt, display: false }, { triggerTurn: true });
			ctx.ui.notify("AI is generating spec files... (wait for message with files)", "info");
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
				ctx.ui.notify("Spec files not found. Use /spec-generate first.", "error");
				return;
			}

			if (specContent.trim().length < 100) {
				ctx.ui.notify("Spec files are empty. Use /spec-generate first.", "warning");
				return;
			}

			executionState.tasks = parseTasksFile(tasksContent);
			executionState.checklist = parseChecklistFile(checklistContent);
			executionState.userConfirmed = true;

			ctx.ui.notify(`Execution started! Tasks: ${executionState.tasks.length}, Checklist: ${executionState.checklist.length}. Strict mode enabled.`, "info");

			pi.sendMessage({
				customType: "spec-execution-start",
				content: `## [SPEC EXECUTION MODE - STRICT]

You must follow these 3 files exactly:
- \`${executionState.specPath}\`
- \`${executionState.tasksPath}\` 
- \`${executionState.checklistPath}\`

RULES:
1. Read all 3 spec files at the start
2. Execute tasks in order. Output [DONE:N] after completing task N
3. Report progress after each task
4. If blocked, output: 【阻塞】原因
5. When ALL tasks done AND ALL checklist pass, output: 【任务已完成】

Begin execution now.`,
				display: false,
			}, { triggerTurn: true });
		},
	});

	pi.registerCommand("spec-status", {
		description: "Show execution status",
		handler: async (_args, ctx) => {
			if (!executionState) {
				ctx.ui.notify("No active spec execution. Use /spec-generate first.", "info");
				return;
			}
			const totalTasks = executionState.tasks.length;
			const completedTasks = executionState.tasks.filter((t) => t.checked).length;
			const totalChecklist = executionState.checklist.length;
			const passedChecklist = executionState.checklist.filter((c) => c.passed).length;
			const tasksPercent = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0;
			const checklistPercent = totalChecklist > 0 ? Math.round((passedChecklist / totalChecklist) * 100) : 0;
			ctx.ui.notify(`Tasks: ${completedTasks}/${totalTasks} (${tasksPercent}%)\nChecklist: ${passedChecklist}/${totalChecklist} (${checklistPercent}%)\n${executionState.userConfirmed ? "Mode: Strict" : "Status: Waiting for /spec-confirm"}`, "info");
		},
	});

	pi.registerCommand("spec-validate", {
		description: "Validate against checklist",
		handler: async (_args, ctx) => {
			if (!executionState || !executionState.userConfirmed) {
				ctx.ui.notify("No active execution.", "warning");
				return;
			}
			ctx.ui.notify(generateValidationReport(executionState), "info");
		},
	});

	pi.registerShortcut(Key.ctrlShift("s"), {
		description: "Start spec workflow",
		handler: async (ctx) => {
			if (!ctx.hasUI) return;
			ctx.ui.setEditorText("/spec-generate ");
		},
	});

	pi.on("turn_end", async (event, ctx) => {
		const msgAny = event.message as any;
		if (!msgAny) return;
		
		const content = typeof msgAny.content === "string" ? msgAny.content : "";
		if (!content) return;

		// Check if AI generated spec files - support both old and new format
		const hasSpec = content.includes("===SPEC===") || content.includes("---SPEC---");
		const hasTasks = content.includes("===TASKS===") || content.includes("---TASKS---");
		const hasChecklist = content.includes("===CHECKLIST===") || content.includes("---CHECKLIST---");
		
		if (hasSpec && hasTasks && hasChecklist) {
			// Try new format first
			let specContent = "", tasksContent = "", checklistContent = "";
			
			// New format: ===SPEC=== ... ===TASKS=== ... ===CHECKLIST===
			if (content.includes("===SPEC===")) {
				const specMatch = content.match(/===SPEC===\n?([\s\S]*?)(?:===TASKS===|$)/);
				const tasksMatch = content.match(/===TASKS===\n?([\s\S]*?)(?:===CHECKLIST===|$)/);
				const checklistMatch = content.match(/===CHECKLIST===\n?([\s\S]*)/);
				
				if (specMatch) specContent = specMatch[1].trim();
				if (tasksMatch) tasksContent = tasksMatch[1].trim();
				if (checklistMatch) checklistContent = checklistMatch[1].trim();
			} else {
				// Old format: ---SPEC--- ... ---TASKS--- ... ---CHECKLIST---
				const parts = content.split("---");
				for (const part of parts) {
					const p = part.trim();
					if (p.startsWith("SPEC")) specContent = p.replace(/^SPEC[A-Z-]*/, "").trim();
					else if (p.startsWith("TASKS")) tasksContent = p.replace(/^TASKS[A-Z-]*/, "").trim();
					else if (p.startsWith("CHECKLIST")) checklistContent = p.replace(/^CHECKLIST[A-Z-]*/, "").trim();
				}
			}
			
			if (specContent && tasksContent && checklistContent) {
				const specDir = ensureSpecDir(ctx.cwd);
				const timestamp = Date.now();
				const specPath = path.join(specDir, `spec-${timestamp}.md`);
				const tasksPath = path.join(specDir, `tasks-${timestamp}.md`);
				const checklistPath = path.join(specDir, `checklist-${timestamp}.md`);
				
				fs.writeFileSync(specPath, specContent, "utf-8");
				fs.writeFileSync(tasksPath, tasksContent, "utf-8");
				fs.writeFileSync(checklistPath, checklistContent, "utf-8");
				
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
				
				ctx.ui.notify(`Spec files generated!\n- ${path.basename(specPath)}\n- ${path.basename(tasksPath)}\n- ${path.basename(checklistPath)}\n\nUse /spec-confirm to start execution.`, "info");
				return;
			}
		}
		
		if (!executionState || !executionState.userConfirmed) return;
		if (msgAny.role !== "assistant") return;

		const msgContent = typeof msgAny.content === "string" ? msgAny.content : "";
		const doneMatches = msgContent.match(/\[DONE:(\d+)\]/g);
		if (doneMatches) {
			for (const match of doneMatches) {
				const taskNum = parseInt(match.match(/\[DONE:(\d+)\]/)?.[1] || "0", 10);
				if (taskNum > 0 && taskNum <= executionState.tasks.length) {
					executionState.tasks[taskNum - 1].checked = true;
				}
			}
			fs.writeFileSync(executionState.tasksPath, "# Tasks\n\n## Task List\n" + executionState.tasks.map((t, i) => `- [${t.checked ? "x" : " "}] ${i + 1}. ${t.description}`).join("\n"), "utf-8");
		}

		const totalTasks = executionState.tasks.length;
		const completedTasks = executionState.tasks.filter((t) => t.checked).length;
		if (completedTasks === totalTasks && totalTasks > 0) {
			ctx.ui.notify("All tasks completed! Run /spec-validate for final check.", "info");
		}
	});

	pi.on("agent_end", async (_event, ctx) => {
		if (!executionState || !executionState.userConfirmed) return;

		const report = generateValidationReport(executionState);
		const totalTasks = executionState.tasks.length;
		const completedTasks = executionState.tasks.filter((t) => t.checked).length;
		const checklistPercent = executionState.checklist.length > 0 ? Math.round((executionState.checklist.filter((c) => c.passed).length / executionState.checklist.length) * 100) : 0;
		const isComplete = completedTasks === totalTasks && checklistPercent === 100;

		pi.sendMessage({
			customType: "spec-execution-complete",
			content: report + (isComplete ? "\n\n### 🎉 Task complete!" : "\n\n### ⚠️ Validation failed."),
			display: true,
		}, { triggerTurn: false });

		executionState = null;
	});

	pi.on("session_start", async (_event, ctx) => {
		if (pi.getFlag("spec-exec") === true) {
			ctx.ui.notify("Spec execution mode enabled", "info");
		}
	});
}
