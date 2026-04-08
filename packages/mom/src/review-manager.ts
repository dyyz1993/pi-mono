/**
 * Review manager for protected file writes
 *
 * Manages the review queue for writes to protected files.
 * All writes to protected files must be approved by a product manager.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "fs";
import { join } from "path";
import * as log from "./log.js";

/**
 * Review request for a protected file write
 */
export interface ReviewRequest {
	id: string;
	filePath: string;
	content: string;
	reason: string;
	timestamp: string;
	status: "pending" | "approved" | "rejected";
	reviewedBy?: string;
	reviewComment?: string;
	suggestion?: string;
	append: boolean;
}

/**
 * Review history entry (after approval/rejection)
 */
export interface ReviewHistoryEntry extends ReviewRequest {
	reviewedAt: string;
}

/**
 * Configuration for the review manager
 */
export interface ReviewManagerConfig {
	workingDir: string;
}

/**
 * Manages the review queue for protected file writes
 */
export class ReviewManager {
	private workingDir: string;
	private reviewDir: string;
	private historyFile: string;
	private pendingReviews: Map<string, ReviewRequest> = new Map();

	constructor(config: ReviewManagerConfig) {
		this.workingDir = config.workingDir;
		this.reviewDir = join(this.workingDir, ".reviews");
		this.historyFile = join(this.reviewDir, "history.jsonl");

		// Ensure review directory exists
		if (!existsSync(this.reviewDir)) {
			mkdirSync(this.reviewDir, { recursive: true });
		}

		// Load pending reviews
		this.loadPendingReviews();
	}

	/**
	 * Load pending reviews from disk
	 */
	private loadPendingReviews(): void {
		if (!existsSync(this.reviewDir)) return;

		const files = require("fs").readdirSync(this.reviewDir);
		for (const file of files) {
			if (!file.endsWith(".json") || file === "history.jsonl") continue;

			try {
				const filePath = join(this.reviewDir, file);
				const content = readFileSync(filePath, "utf-8");
				const request = JSON.parse(content) as ReviewRequest;

				if (request.status === "pending") {
					this.pendingReviews.set(request.id, request);
				}
			} catch (error) {
				log.logWarning(`Failed to load review request: ${file}`, error);
			}
		}
	}

	/**
	 * Generate a unique request ID
	 */
	private generateId(): string {
		const timestamp = Date.now().toString(36);
		const random = Math.random().toString(36).substring(2, 8);
		return `${timestamp}-${random}`;
	}

	/**
	 * Create a new review request for a protected file write
	 */
	createRequest(filePath: string, content: string, reason: string, append: boolean = false): ReviewRequest {
		const id = this.generateId();
		const request: ReviewRequest = {
			id,
			filePath,
			content,
			reason,
			timestamp: new Date().toISOString(),
			status: "pending",
			append,
		};

		// Save to disk
		this.saveRequest(request);

		// Add to pending
		this.pendingReviews.set(id, request);

		log.logInfo(`Created review request ${id} for ${filePath}`);

		return request;
	}

	/**
	 * Save a review request to disk
	 */
	private saveRequest(request: ReviewRequest): void {
		const filePath = join(this.reviewDir, `${request.id}.json`);
		writeFileSync(filePath, JSON.stringify(request, null, 2), "utf-8");
	}

	/**
	 * Get a pending review request by ID
	 */
	getRequest(id: string): ReviewRequest | undefined {
		return this.pendingReviews.get(id);
	}

	/**
	 * Get all pending review requests
	 */
	getPendingReviews(): ReviewRequest[] {
		return Array.from(this.pendingReviews.values());
	}

	/**
	 * Approve a review request
	 */
	approveRequest(id: string, reviewedBy: string, comment?: string): { success: boolean; error?: string } {
		const request = this.pendingReviews.get(id);
		if (!request) {
			return { success: false, error: `Review request ${id} not found` };
		}

		request.status = "approved";
		request.reviewedBy = reviewedBy;
		request.reviewComment = comment;

		// Add to history
		this.addToHistory(request);

		// Remove from pending
		this.pendingReviews.delete(id);

		// Delete the request file
		const filePath = join(this.reviewDir, `${id}.json`);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}

		log.logInfo(`Approved review request ${id} for ${request.filePath}`);

		return { success: true };
	}

	/**
	 * Reject a review request
	 */
	rejectRequest(
		id: string,
		reviewedBy: string,
		comment: string,
		suggestion?: string,
	): { success: boolean; error?: string } {
		const request = this.pendingReviews.get(id);
		if (!request) {
			return { success: false, error: `Review request ${id} not found` };
		}

		request.status = "rejected";
		request.reviewedBy = reviewedBy;
		request.reviewComment = comment;
		request.suggestion = suggestion;

		// Add to history
		this.addToHistory(request);

		// Remove from pending
		this.pendingReviews.delete(id);

		// Delete the request file
		const filePath = join(this.reviewDir, `${id}.json`);
		if (existsSync(filePath)) {
			unlinkSync(filePath);
		}

		log.logInfo(`Rejected review request ${id} for ${request.filePath}`);

		return { success: true };
	}

	/**
	 * Add a review request to the history file
	 */
	private addToHistory(request: ReviewRequest): void {
		const entry: ReviewHistoryEntry = {
			...request,
			reviewedAt: new Date().toISOString(),
		};

		const line = `${JSON.stringify(entry)}\n`;
		require("fs").appendFileSync(this.historyFile, line, "utf-8");
	}

	/**
	 * Get review history (recent entries)
	 */
	getHistory(limit: number = 10): ReviewHistoryEntry[] {
		if (!existsSync(this.historyFile)) {
			return [];
		}

		try {
			const content = readFileSync(this.historyFile, "utf-8");
			const lines = content
				.trim()
				.split("\n")
				.filter((l) => l);

			// Get the last N entries
			const recentLines = lines.slice(-limit);

			return recentLines
				.map((line) => {
					try {
						return JSON.parse(line) as ReviewHistoryEntry;
					} catch {
						return null;
					}
				})
				.filter((e): e is ReviewHistoryEntry => e !== null);
		} catch {
			return [];
		}
	}

	/**
	 * Clear old history entries (older than N days)
	 */
	clearOldHistory(daysToKeep: number = 30): void {
		if (!existsSync(this.historyFile)) return;

		const cutoffDate = new Date();
		cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);

		try {
			const content = readFileSync(this.historyFile, "utf-8");
			const lines = content
				.trim()
				.split("\n")
				.filter((l) => l);

			const recentEntries = lines.filter((line) => {
				try {
					const entry = JSON.parse(line) as ReviewHistoryEntry;
					const reviewedAt = new Date(entry.reviewedAt);
					return reviewedAt >= cutoffDate;
				} catch {
					return false;
				}
			});

			if (recentEntries.length < lines.length) {
				writeFileSync(this.historyFile, `${recentEntries.join("\n")}\n`, "utf-8");
				log.logInfo(`Cleared ${lines.length - recentEntries.length} old history entries`);
			}
		} catch (error) {
			log.logWarning("Failed to clear old history", error);
		}
	}
}
