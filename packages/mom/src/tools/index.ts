import type { AgentTool } from "@mariozechner/pi-agent-core";
import type { ReviewManager } from "../review-manager.js";
import type { Executor } from "../sandbox.js";
import { attachTool } from "./attach.js";
import { createBashTool } from "./bash.js";
import { createEditTool } from "./edit.js";
import { createReadTool } from "./read.js";
import {
	createManualReviewTool,
	createPendingReviewsTool,
	createRequestWriteTool,
	createReviewHistoryTool,
} from "./review.js";
import { createWriteTool } from "./write.js";

export { setUploadFunction } from "./attach.js";

export function createMomTools(executor: Executor, reviewManager: ReviewManager): AgentTool<any>[] {
	return [
		createReadTool(executor),
		createBashTool(executor),
		createEditTool(executor, reviewManager),
		createWriteTool(executor, reviewManager),
		attachTool,
		// Review tools for protected files
		createRequestWriteTool(executor, reviewManager),
		createPendingReviewsTool(reviewManager),
		createManualReviewTool(executor, reviewManager),
		createReviewHistoryTool(reviewManager),
	];
}
