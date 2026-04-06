/**
 * Review tools for protected file writes
 * 
 * These tools allow requesting, reviewing, and managing write access to protected files.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import type { Executor } from "../sandbox.js";
import type { ReviewManager } from "../review-manager.js";
import { isProtectedPath, getProtectedFileType } from "../protection.js";
import * as log from "../log.js";

/**
 * Create the request_write tool
 * This tool is used to request a write to a protected file
 */
export function createRequestWriteTool(executor: Executor, reviewManager: ReviewManager): AgentTool<any> {
	const schema = Type.Object({
		filePath: Type.String({ description: "Path to the file to write (relative or absolute)" }),
		content: Type.String({ description: "Content to write to the file" }),
		reason: Type.String({ description: "Reason for the write / description of changes" }),
		append: Type.Optional(Type.Boolean({ description: "Append mode (default: false = overwrite)" })),
	});

	return {
		name: "request_write",
		label: "request write",
		description:
			"Request to write to a protected file (memory, knowledge, tasks, system config, etc.). The request will be reviewed by a product manager before being applied.",
		parameters: schema,
		execute: async (
			_toolCallId: string,
			{ filePath, content, reason, append = false }: { filePath: string; content: string; reason: string; append?: boolean },
			_signal?: AbortSignal,
		) => {
			// Check if this is actually a protected path
			const protectionCheck = isProtectedPath(filePath);
			
			if (!protectionCheck.protected) {
				// Not protected - let the user know they can write directly
				return {
					content: [{
						type: "text",
						text: `ℹ️ The file "${filePath}" is not protected.\n\n` +
							`You can write to this file directly using the \`write\` tool instead of requesting review.\n\n` +
							`Protected files are:\n` +
							`- MEMORY.md files (memory)\n` +
							`- knowledge/ directory (verified knowledge)\n` +
							`- tasks/ directory (task tracking)\n` +
							`- SYSTEM.md (system configuration)\n` +
							`- skills/**/SKILL.md (skill definitions)`,
					}],
				};
			}
			
			// This is a protected file - create review request
			const fileType = getProtectedFileType(filePath);
			const request = reviewManager.createRequest(filePath, content, reason, append);
			
			log.logInfo(`Created review request ${request.id} for protected file: ${filePath}`);
			
			return {
				content: [{
					type: "text",
					text: `✅ Review Request Created\n\n` +
						`**Request ID:** ${request.id}\n` +
						`**File:** ${filePath}\n` +
						`**Type:** ${fileType}\n` +
						`**Mode:** ${append ? 'Append' : 'Overwrite'}\n` +
						`**Content Size:** ${content.length} bytes\n\n` +
						`**Reason:** ${reason}\n\n` +
						`**Status:** Pending Review\n\n` +
						`A product manager will review this request. Use \`pending_reviews\` to check status or \`review_history\` to see past reviews.`,
				}],
			};
		},
	};
}

/**
 * Create the pending_reviews tool
 * This tool lists all pending review requests
 */
export function createPendingReviewsTool(reviewManager: ReviewManager): AgentTool<any> {
	const schema = Type.Object({});

	return {
		name: "pending_reviews",
		label: "pending reviews",
		description: "List all pending review requests for protected file writes.",
		parameters: schema,
		execute: async (_toolCallId: string, {}: {}, _signal?: AbortSignal) => {
			const reviews = reviewManager.getPendingReviews();
			
			if (reviews.length === 0) {
				return {
					content: [{
						type: "text",
						text: "No pending review requests.",
					}],
				};
			}
			
			const lines: string[] = ["# Pending Review Requests\n"];
			
			for (const review of reviews) {
				const fileType = getProtectedFileType(review.filePath);
				const age = Date.now() - new Date(review.timestamp).getTime();
				const ageMinutes = Math.floor(age / 60000);
				const ageStr = ageMinutes < 60 ? `${ageMinutes}m ago` : `${Math.floor(ageMinutes / 60)}h ${ageMinutes % 60}m ago`;
				
				lines.push(`## ${review.id} (${ageStr})`);
				lines.push(`**File:** ${review.filePath}`);
				lines.push(`**Type:** ${fileType}`);
				lines.push(`**Mode:** ${review.append ? 'Append' : 'Overwrite'}`);
				lines.push(`**Content Size:** ${review.content.length} bytes`);
				lines.push(`**Reason:** ${review.reason}`);
				lines.push("");
			}
			
			return {
				content: [{
					type: "text",
					text: lines.join("\n"),
				}],
			};
		},
	};
}

/**
 * Create the manual_review tool
 * This tool is used by product managers to approve/reject review requests
 */
export function createManualReviewTool(executor: Executor, reviewManager: ReviewManager): AgentTool<any> {
	const schema = Type.Object({
		requestId: Type.String({ description: "ID of the review request" }),
		approved: Type.Boolean({ description: "Whether to approve the request" }),
		comment: Type.String({ description: "Review comment / feedback" }),
		suggestion: Type.Optional(Type.String({ description: "Suggested modification (if rejected)" })),
	});

	return {
		name: "manual_review",
		label: "manual review",
		description:
			"Approve or reject a pending review request. This tool is intended for product managers to review protected file writes.",
		parameters: schema,
		execute: async (
			_toolCallId: string,
			{ requestId, approved, comment, suggestion }: { requestId: string; approved: boolean; comment: string; suggestion?: string },
			_signal?: AbortSignal,
		) => {
			const request = reviewManager.getRequest(requestId);
			
			if (!request) {
				return {
					content: [{
						type: "text",
						text: `❌ Review request ${requestId} not found.\n\nUse \`pending_reviews\` to see all pending requests.`,
					}],
				};
			}
			
			if (approved) {
				// Approve the request
				const result = reviewManager.approveRequest(requestId, "product-manager", comment);
				
				if (!result.success) {
					return {
						content: [{
							type: "text",
							text: `❌ Failed to approve request: ${result.error}`,
						}],
					};
				}
				
				// Apply the write
				try {
					const writeCmd = request.append
						? `cat >> ${shellEscape(request.filePath)} << 'MOM_EOF'\n${request.content}\nMOM_EOF`
						: `cat > ${shellEscape(request.filePath)} << 'MOM_EOF'\n${request.content}\nMOM_EOF`;
					
					const execResult = await executor.exec(writeCmd);
					
					if (execResult.code !== 0) {
						throw new Error(execResult.stderr || "Write failed");
					}
					
					log.logInfo(`Applied approved write to ${request.filePath}`);
					
					return {
						content: [{
							type: "text",
							text: `✅ Review Approved and Applied\n\n` +
								`**Request ID:** ${requestId}\n` +
								`**File:** ${request.filePath}\n` +
								`**Mode:** ${request.append ? 'Append' : 'Overwrite'}\n` +
								`**Bytes Written:** ${request.content.length}\n\n` +
								`**Reviewer Comment:** ${comment}`,
						}],
					};
				} catch (error) {
					const errMsg = error instanceof Error ? error.message : String(error);
					log.logError(`Failed to apply approved write to ${request.filePath}`, errMsg);
					
					return {
						content: [{
							type: "text",
							text: `⚠️ Review Approved but Write Failed\n\n` +
								`**Request ID:** ${requestId}\n` +
								`**File:** ${request.filePath}\n` +
								`**Error:** ${errMsg}\n\n` +
								`The request was approved but the write could not be applied. You may need to manually apply the changes.`,
						}],
					};
				}
			} else {
				// Reject the request
				const result = reviewManager.rejectRequest(requestId, "product-manager", comment, suggestion);
				
				if (!result.success) {
					return {
						content: [{
							type: "text",
							text: `❌ Failed to reject request: ${result.error}`,
						}],
					};
				}
				
				return {
					content: [{
						type: "text",
						text: `❌ Review Rejected\n\n` +
							`**Request ID:** ${requestId}\n` +
							`**File:** ${request.filePath}\n\n` +
							`**Reviewer Comment:** ${comment}` +
							(suggestion ? `\n\n**Suggestion:** ${suggestion}` : ""),
					}],
				};
			}
		},
	};
}

/**
 * Create the review_history tool
 * This tool shows the history of review requests
 */
export function createReviewHistoryTool(reviewManager: ReviewManager): AgentTool<any> {
	const schema = Type.Object({
		limit: Type.Optional(Type.Number({ description: "Number of entries to return (default: 10)" })),
		status: Type.Optional(Type.String({ description: "Filter by status: pending/approved/rejected" })),
	});

	return {
		name: "review_history",
		label: "review history",
		description: "View recent review history for protected file writes.",
		parameters: schema,
		execute: async (
			_toolCallId: string,
			{ limit = 10, status }: { limit?: number; status?: string },
			_signal?: AbortSignal,
		) => {
			const history = reviewManager.getHistory(limit);
			
			// Filter by status if provided
			const filtered = status ? history.filter(h => h.status === status) : history;
			
			if (filtered.length === 0) {
				return {
					content: [{
						type: "text",
						text: status 
							? `No ${status} reviews in history.`
							: "No review history yet.",
					}],
				};
			}
			
			const lines: string[] = ["# Review History\n"];
			
			for (const entry of filtered) {
				const statusIcon = entry.status === 'approved' ? '✅' : '❌';
				const reviewedAt = new Date(entry.reviewedAt);
				const age = Date.now() - reviewedAt.getTime();
				const ageMinutes = Math.floor(age / 60000);
				const ageStr = ageMinutes < 60 
					? `${ageMinutes}m ago` 
					: ageMinutes < 1440 
						? `${Math.floor(ageMinutes / 60)}h ago`
						: `${Math.floor(ageMinutes / 1440)}d ago`;
				
				lines.push(`## ${statusIcon} ${entry.id} (${ageStr})`);
				lines.push(`**File:** ${entry.filePath}`);
				lines.push(`**Status:** ${entry.status}`);
				lines.push(`**Mode:** ${entry.append ? 'Append' : 'Overwrite'}`);
				lines.push(`**Reason:** ${entry.reason}`);
				lines.push(`**Reviewer:** ${entry.reviewedBy}`);
				lines.push(`**Comment:** ${entry.reviewComment}`);
				if (entry.suggestion) {
					lines.push(`**Suggestion:** ${entry.suggestion}`);
				}
				lines.push("");
			}
			
			return {
				content: [{
					type: "text",
					text: lines.join("\n"),
				}],
			};
		},
	};
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
