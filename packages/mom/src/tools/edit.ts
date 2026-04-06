import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Executor } from "../sandbox.js";
import { isProtectedPath } from "../protection.js";
import type { ReviewManager } from "../review-manager.js";
import * as log from "../log.js";

const editSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're editing (shown to user)" }),
	path: Type.String({ description: "Path to the file to edit (relative or absolute)" }),
	operations: Type.Array(
		Type.Object({
			oldText: Type.String({ description: "Text to search for - must match exactly" }),
			newText: Type.String({ description: "Text to replace with" }),
		}),
		{ description: "List of search/replace operations to apply sequentially" },
	),
});

export function createEditTool(executor: Executor, reviewManager: ReviewManager): AgentTool<typeof editSchema> {
	return {
		name: "edit",
		label: "edit",
		description:
			"Apply surgical edits to a file. Each operation replaces exact text matches. Safer than write for targeted changes. Shows diff of all changes.",
		parameters: editSchema,
		execute: async (
			_toolCallId: string,
			{ path, operations }: { label: string; path: string; operations: Array<{ oldText: string; newText: string }> },
			signal?: AbortSignal,
		) => {
			// Check if this is a protected path
			const protectionCheck = isProtectedPath(path);
			
			if (protectionCheck.protected) {
				// This is a protected file - need to check if user used request_write
				// For edit tool, we need to apply the operations first to get the final content
				// then submit that for review
				
				// Read current file
				const readResult = await executor.exec(`cat ${shellEscape(path)}`, { signal });
				if (readResult.code !== 0) {
					throw new Error(`Failed to read file for edit: ${readResult.stderr || path}`);
				}
				
				let content = readResult.stdout || "";
				
				// Apply operations
				const appliedOps: Array<{ oldText: string; newText: string; found: boolean }> = [];
				for (const op of operations) {
					if (content.includes(op.oldText)) {
						content = content.replace(op.oldText, op.newText);
						appliedOps.push({ ...op, found: true });
					} else {
						appliedOps.push({ ...op, found: false });
					}
				}
				
				// Check if all operations found their targets
				const failedOps = appliedOps.filter((op) => !op.found);
				if (failedOps.length > 0) {
					throw new Error(
						`Some operations could not be applied:\n` +
							failedOps.map((op) => `  - "${op.oldText.substring(0, 50)}..." not found`).join("\n"),
					);
				}
				
				// Create review request with the final content
				const opsSummary = operations.map(op => 
					`Replace "${op.oldText.substring(0, 50)}${op.oldText.length > 50 ? '...' : ''}" with "${op.newText.substring(0, 50)}${op.newText.length > 50 ? '...' : ''}"`
				).join('; ');
				
				const request = reviewManager.createRequest(
					path, 
					content, 
					`Edit operations: ${opsSummary}`,
					false
				);
				
				log.logWarning(`Protected file edit blocked: ${path}`, `Created review request ${request.id}`);
				
				throw new Error(
					`⚠️ Protected File Edit Blocked\n\n` +
					`The file "${path}" is protected and cannot be edited directly.\n\n` +
					`**Reason:** ${protectionCheck.match?.reason || "This is a critical system file"}\n\n` +
					`**Operations applied in preview:**\n` +
					appliedOps.map((op, i) => `${i + 1}. Replace "${op.oldText.substring(0, 30)}..." with "${op.newText.substring(0, 30)}..."`).join('\n') +
					`\n\n**What to do:**\n` +
					`1. Use the \`request_write\` tool to submit your edit for review\n` +
					`2. A product manager will review and approve/reject the request\n` +
					`3. If approved, the changes will be applied\n\n` +
					`**Current Request ID:** ${request.id}\n` +
					`Use \`pending_reviews\` to see the request status.`
				);
			}
			
			// Not protected - proceed with edit
			// Read current file
			const readResult = await executor.exec(`cat ${shellEscape(path)}`, { signal });
			if (readResult.code !== 0) {
				throw new Error(`Failed to read file for edit: ${readResult.stderr || path}`);
			}

			const original = readResult.stdout || "";
			let content = original;

			// Apply operations
			const appliedOps: Array<{ oldText: string; newText: string; found: boolean }> = [];
			for (const op of operations) {
				if (content.includes(op.oldText)) {
					content = content.replace(op.oldText, op.newText);
					appliedOps.push({ ...op, found: true });
				} else {
					appliedOps.push({ ...op, found: false });
				}
			}

			// Check if all operations found their targets
			const failedOps = appliedOps.filter((op) => !op.found);
			if (failedOps.length > 0) {
				throw new Error(
					`Some operations could not be applied:\n` +
						failedOps.map((op) => `  - "${op.oldText.substring(0, 50)}..." not found`).join("\n"),
				);
			}

			// Write back
			const writeResult = await executor.exec(
				`cat > ${shellEscape(path)} << 'MOM_EOF'\n${content}\nMOM_EOF`,
				{ signal },
			);

			if (writeResult.code !== 0) {
				throw new Error(writeResult.stderr || `Failed to write edited file: ${path}`);
			}

			// Generate diff output
			const diffLines: string[] = [];
			for (const op of appliedOps) {
				diffLines.push(`--- Old ---\n${op.oldText}\n--- New ---\n${op.newText}\n---`);
			}

			return {
				content: [
					{
						type: "text",
						text: `Successfully edited ${path}\n\n${diffLines.join("\n")}\n\nApplied ${appliedOps.length} operation(s).`,
					},
				],
			};
		},
	};
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
