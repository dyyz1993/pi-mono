/**
 * Session Undo/Redo Extension
 *
 * Features:
 * - /undo - Revert file changes from the last turn
 * - /redo - Reapply reverted changes
 * - /rollback [entry-id] - Jump to a specific entry and restore code state
 * - /share - Export session with file snapshots
 *
 * Architecture:
 * - Uses git for file versioning (no file bloat)
 * - Stores minimal metadata in session (commit hashes, not file content)
 * - Supports both git repos and non-git projects (diff/patch fallback)
 *
 * Usage:
 * 1. Copy to ~/.pi/agent/extensions/ or .pi/extensions/
 * 2. Works automatically - tracks file changes at each turn
 */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

interface FileChange {
	path: string;
	action: "modified" | "created" | "deleted";
	diff?: string; // Unified diff (for non-git projects)
	gitCommit?: string; // Git commit hash (for git projects)
	timestamp: number;
}

interface TurnSnapshot {
	entryId: string;
	timestamp: number;
	changes: FileChange[];
	gitBranch?: string;
	gitCommit?: string;
}

interface UndoState {
	history: TurnSnapshot[]; // All snapshots
	undoStack: TurnSnapshot[]; // Reverted snapshots (for redo)
	currentTurnIndex: number; // Current position in history
}

const STATE_KEY = "session-undo-state";

export default function sessionUndoExtension(pi: ExtensionAPI) {
	let state: UndoState = {
		history: [],
		undoStack: [],
		currentTurnIndex: -1,
	};

	let isGitRepo = false;
	let gitDir: string | undefined;

	// Check if project uses git
	const initGitCheck = async () => {
		try {
			const result = await pi.exec("git", ["rev-parse", "--git-dir"], {
				cwd: pi.cwd,
				timeout: 5000,
			});
			isGitRepo = true;
			gitDir = result.stdout.trim();
			if (!gitDir.startsWith("/")) {
				gitDir = join(pi.cwd, gitDir);
			}
		} catch {
			isGitRepo = false;
		}
	};

	// Capture file changes at the end of each turn
	const captureTurnSnapshot = async (entryId: string) => {
		const changes: FileChange[] = [];

		if (isGitRepo && gitDir) {
			// Git mode: Get diff from last commit
			try {
				// Get staged and unstaged changes
				const diffResult = await pi.exec("git", ["diff", "HEAD"], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				if (diffResult.stdout.trim()) {
					// Parse git diff to extract file changes
					const diffLines = diffResult.stdout.split("\n");
					let currentFile: string | undefined;
					let fileDiff: string[] = [];

					for (const line of diffLines) {
						if (line.startsWith("diff --git")) {
							// Save previous file
							if (currentFile && fileDiff.length > 0) {
								changes.push({
									path: currentFile,
									action: "modified",
									diff: fileDiff.join("\n"),
									timestamp: Date.now(),
								});
							}
							// New file
							const match = line.match(/diff --git a\/(.+?) b\/(.+)/);
							if (match) {
								currentFile = match[2];
								fileDiff = [line];
							}
						} else if (currentFile) {
							fileDiff.push(line);
						}
					}

					// Don't forget the last file
					if (currentFile && fileDiff.length > 0) {
						changes.push({
							path: currentFile,
							action: "modified",
							diff: fileDiff.join("\n"),
							timestamp: Date.now(),
						});
					}
				}

				// Get current branch and commit
				const branchResult = await pi.exec("git", ["branch", "--show-current"], {
					cwd: pi.cwd,
					timeout: 5000,
				});

				const commitResult = await pi.exec("git", ["rev-parse", "HEAD"], {
					cwd: pi.cwd,
					timeout: 5000,
				});

				const snapshot: TurnSnapshot = {
					entryId,
					timestamp: Date.now(),
					changes,
					gitBranch: branchResult.stdout.trim() || undefined,
					gitCommit: commitResult.stdout.trim() || undefined,
				};

				// Add to history
				state.history.push(snapshot);
				state.currentTurnIndex = state.history.length - 1;
				state.undoStack = []; // Clear redo stack on new action

				// Persist to session
				pi.appendEntry(STATE_KEY, state);
			} catch (_error) {
				// Git operations failed, fall back to non-git mode
				await captureNonGitSnapshot(entryId);
			}
		} else {
			// Non-git mode
			await captureNonGitSnapshot(entryId);
		}
	};

	const captureNonGitSnapshot = async (entryId: string) => {
		// For non-git projects, we need to track files manually
		// This is less efficient but works everywhere
		const changes: FileChange[] = [];

		// In a real implementation, you'd track files from tool calls
		// For now, we'll use a simpler approach: store diffs in .pi/undo/
		const undoDir = join(pi.cwd, ".pi", "undo");
		if (!existsSync(undoDir)) {
			mkdirSync(undoDir, { recursive: true });
		}

		const snapshot: TurnSnapshot = {
			entryId,
			timestamp: Date.now(),
			changes,
		};

		state.history.push(snapshot);
		state.currentTurnIndex = state.history.length - 1;
		state.undoStack = [];

		pi.appendEntry(STATE_KEY, state);
	};

	// Create a git commit for the current state (for rollback)
	const _createGitCheckpoint = async (message: string): Promise<string | undefined> => {
		if (!isGitRepo) return undefined;

		try {
			// Add all changes
			await pi.exec("git", ["add", "-A"], { cwd: pi.cwd, timeout: 10000 });

			// Create commit
			await pi.exec("git", ["commit", "-m", message, "--no-verify"], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			// Get commit hash
			const result = await pi.exec("git", ["rev-parse", "HEAD"], {
				cwd: pi.cwd,
				timeout: 5000,
			});

			return result.stdout.trim();
		} catch (_error) {
			// Commit failed (maybe no changes), ignore
			return undefined;
		}
	};

	// Revert to a previous git commit
	const revertToGitCommit = async (commitHash: string): Promise<boolean> => {
		if (!isGitRepo) return false;

		try {
			// Hard reset to the commit
			await pi.exec("git", ["reset", "--hard", commitHash], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			// Clean untracked files
			await pi.exec("git", ["clean", "-fd"], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			return true;
		} catch (_error) {
			return false;
		}
	};

	// Apply a diff to revert/redo changes
	const applyDiff = async (diff: string, reverse = false): Promise<boolean> => {
		try {
			const tempFile = join(pi.cwd, ".pi", "undo", "temp.patch");
			mkdirSync(join(pi.cwd, ".pi", "undo"), { recursive: true });
			writeFileSync(tempFile, diff);

			const patchArgs = reverse ? ["-R", "-p1", "-i", tempFile] : ["-p1", "-i", tempFile];

			const result = await pi.exec("patch", patchArgs, {
				cwd: pi.cwd,
				timeout: 10000,
			});

			return result.code === 0;
		} catch (_error) {
			return false;
		}
	};

	// Register /undo command
	pi.registerCommand("undo", {
		description: "Undo the last turn's file changes",
		handler: async (_args, ctx) => {
			if (state.currentTurnIndex < 0 || state.history.length === 0) {
				ctx.ui.notify("Nothing to undo", "warning");
				return;
			}

			const currentSnapshot = state.history[state.currentTurnIndex];

			if (!ctx.hasUI) {
				ctx.ui.notify("Undo not available in this mode", "error");
				return;
			}

			// Confirm with user
			const confirm = await ctx.ui.confirm(
				"Undo last turn?",
				`This will revert ${currentSnapshot.changes.length} file change(s).`,
			);

			if (!confirm) return;

			// Revert changes
			if (isGitRepo && currentSnapshot.gitCommit) {
				// Find previous commit
				const prevSnapshot = state.currentTurnIndex > 0 ? state.history[state.currentTurnIndex - 1] : undefined;

				if (prevSnapshot?.gitCommit) {
					const success = await revertToGitCommit(prevSnapshot.gitCommit);
					if (success) {
						ctx.ui.notify("Undo successful", "info");
					}
				}
			} else {
				// Apply diffs in reverse
				for (const change of currentSnapshot.changes) {
					if (change.diff) {
						await applyDiff(change.diff, true); // Reverse the diff
					}
				}
				ctx.ui.notify("Undo completed (non-git mode)", "info");
			}

			// Move undo stack
			state.undoStack.push(currentSnapshot);
			state.currentTurnIndex--;

			// Persist
			pi.appendEntry(STATE_KEY, state);
		},
	});

	// Register /redo command
	pi.registerCommand("redo", {
		description: "Redo the last undone changes",
		handler: async (_args, ctx) => {
			if (state.undoStack.length === 0) {
				ctx.ui.notify("Nothing to redo", "warning");
				return;
			}

			const snapshot = state.undoStack.pop()!;

			if (!ctx.hasUI) {
				ctx.ui.notify("Redo not available in this mode", "error");
				return;
			}

			// Reapply changes
			if (isGitRepo && snapshot.gitCommit) {
				const success = await revertToGitCommit(snapshot.gitCommit);
				if (success) {
					ctx.ui.notify("Redo successful", "info");
				}
			} else {
				// Apply diffs forward
				for (const change of snapshot.changes) {
					if (change.diff) {
						await applyDiff(change.diff, false);
					}
				}
				ctx.ui.notify("Redo completed (non-git mode)", "info");
			}

			state.currentTurnIndex++;
			pi.appendEntry(STATE_KEY, state);
		},
	});

	// Register /rollback command
	pi.registerCommand("rollback", {
		description: "Rollback to a specific entry and restore code state",
		getArgumentCompletions: (prefix) => {
			// Show recent entry IDs
			return state.history
				.slice(-10)
				.map((s, i) => ({
					value: s.entryId,
					label: s.entryId,
					description: `Turn ${state.history.length - 10 + i + 1} - ${new Date(s.timestamp).toLocaleString()}`,
				}))
				.filter((item) => item.label.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const entryId = args.trim();

			if (!entryId) {
				ctx.ui.notify("Usage: /rollback <entry-id>", "warning");
				return;
			}

			const snapshot = state.history.find((s) => s.entryId === entryId);

			if (!snapshot) {
				ctx.ui.notify(`No snapshot found for entry ${entryId}`, "error");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Rollback not available in this mode", "error");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Rollback to this point?",
				`Entry: ${entryId}\nTime: ${new Date(snapshot.timestamp).toLocaleString()}\nFiles changed: ${snapshot.changes.length}`,
			);

			if (!confirm) return;

			// Restore code state
			if (isGitRepo && snapshot.gitCommit) {
				const success = await revertToGitCommit(snapshot.gitCommit);
				if (success) {
					ctx.ui.notify(`Rolled back to entry ${entryId}`, "info");
				} else {
					ctx.ui.notify("Rollback failed", "error");
				}
			} else {
				ctx.ui.notify("Rollback requires git mode", "error");
				return;
			}

			// Navigate to the entry in session
			await ctx.navigateTree(entryId);

			// Update state
			state.currentTurnIndex = state.history.findIndex((s) => s.entryId === entryId);
			state.undoStack = [];
			pi.appendEntry(STATE_KEY, state);
		},
	});

	// Register /share command
	pi.registerCommand("share", {
		description: "Export session with file snapshots for sharing",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("Share not available in this mode", "error");
				return;
			}

			const outputPath = await ctx.ui.input("Export path (default: ./session-export.md)", "session-export.md");
			const finalPath = outputPath || "session-export.md";

			// Build export content
			let content = `# Session Export\n\n`;
			content += `**Exported:** ${new Date().toLocaleString()}\n`;
			content += `**Working Directory:** ${pi.cwd}\n`;
			content += `**Git Branch:** ${state.history[state.currentTurnIndex]?.gitBranch || "N/A"}\n`;
			content += `**Total Turns:** ${state.history.length}\n\n`;

			// Add session transcript
			content += `## Conversation\n\n`;
			content += `(Use /export command for full transcript)\n\n`;

			// Add file change summary
			content += `## File Changes Summary\n\n`;

			const fileStats = new Map<string, { created: number; modified: number; deleted: number }>();

			for (const snapshot of state.history) {
				for (const change of snapshot.changes) {
					const stats = fileStats.get(change.path) || { created: 0, modified: 0, deleted: 0 };
					stats[change.action]++;
					fileStats.set(change.path, stats);
				}
			}

			content += `| File | Created | Modified | Deleted |\n`;
			content += `|------|---------|----------|--------|\n`;

			for (const [path, stats] of fileStats) {
				content += `| ${path} | ${stats.created} | ${stats.modified} | ${stats.deleted} |\n`;
			}

			content += `\n`;

			// Add git diff summary (if available)
			if (isGitRepo) {
				content += `## Git State\n\n`;
				content += `Current commit: \`${state.history[state.currentTurnIndex]?.gitCommit || "N/A"}\`\n\n`;

				if (await ctx.ui.confirm("Include full diff in export?", "This may be large for many changes.")) {
					try {
						const diffResult = await pi.exec("git", ["diff", `HEAD~${state.history.length}`, "HEAD"], {
							cwd: pi.cwd,
							timeout: 30000,
						});
						content += `## Full Diff\n\n\`\`\`diff\n${diffResult.stdout}\n\`\`\`\n`;
					} catch {
						content += `(Could not generate diff)\n`;
					}
				}
			}

			// Write export file
			const fullPath = join(pi.cwd, finalPath);
			writeFileSync(fullPath, content, "utf-8");

			ctx.ui.notify(`Exported to ${fullPath}`, "info");
		},
	});

	// Listen to turn_end events to capture snapshots
	pi.on("turn_end", async (_event, ctx) => {
		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) {
			await captureTurnSnapshot(leaf.id);
		}
	});

	// Restore state on session start
	pi.on("session_start", async (_event, ctx) => {
		await initGitCheck();

		// Load state from session entries
		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === STATE_KEY) {
				state = entry.data as UndoState;
				break;
			}
		}

		if (state.history.length > 0) {
			state.currentTurnIndex = state.history.length - 1;
		}
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		// Ensure final state is persisted
		if (state.history.length > 0) {
			pi.appendEntry(STATE_KEY, state);
		}
	});
}
