import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "@sinclair/typebox";
import * as log from "../log.js";
import { isProtectedPath } from "../protection.js";
import type { ReviewManager } from "../review-manager.js";
import type { Executor } from "../sandbox.js";

const writeSchema = Type.Object({
	label: Type.String({ description: "Brief description of what you're writing (shown to user)" }),
	path: Type.String({ description: "Path to the file to write (relative or absolute)" }),
	content: Type.String({ description: "Content to write to the file" }),
});

export function createWriteTool(executor: Executor, reviewManager: ReviewManager): AgentTool<typeof writeSchema> {
	return {
		name: "write",
		label: "write",
		description:
			"Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Use for creating new files or completely replacing file contents.",
		parameters: writeSchema,
		execute: async (
			_toolCallId: string,
			{ path, content }: { label: string; path: string; content: string },
			signal?: AbortSignal,
		) => {
			// Check if this is a protected path
			const protectionCheck = isProtectedPath(path);

			if (protectionCheck.protected) {
				// This is a protected file - create a review request
				const request = reviewManager.createRequest(path, content, "Direct write via write tool", false);

				log.logWarning(`Protected file write blocked: ${path}`, `Created review request ${request.id}`);

				throw new Error(
					`⚠️ Protected File Write Blocked\n\n` +
						`The file "${path}" is protected and cannot be written directly.\n\n` +
						`**Reason:** ${protectionCheck.match?.reason || "This is a critical system file"}\n\n` +
						`**What to do:**\n` +
						`1. Use the \`request_write\` tool to submit your write request for review\n` +
						`2. A product manager will review and approve/reject the request\n` +
						`3. If approved, the write will be applied\n\n` +
						`**Current Request ID:** ${request.id}\n` +
						`Use \`pending_reviews\` to see the request status.`,
				);
			}

			// Not protected - proceed with write
			const result = await executor.exec(`cat > ${shellEscape(path)} << 'MOM_EOF'\n${content}\nMOM_EOF`, {
				signal,
			});

			if (result.code !== 0) {
				throw new Error(result.stderr || `Failed to write file: ${path}`);
			}

			return {
				content: [{ type: "text", text: `Successfully wrote ${content.length} bytes to ${path}` }],
			};
		},
	};
}

function shellEscape(s: string): string {
	return `'${s.replace(/'/g, "'\\''")}'`;
}
