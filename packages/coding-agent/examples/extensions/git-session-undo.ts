/**
 * Git-based Session Undo/Redo (Optimized)
 *
 * This version uses pure Git for versioning - ZERO file content stored in session.
 * Perfect for large projects where session file size matters.
 *
 * Key differences from session-undo.ts:
 * - Creates git commits for each turn (in .pi/undo branch)
 * - Stores ONLY commit hashes in session (no diffs, no file content)
 * - Session overhead: ~100 bytes per turn
 * - Full file history in git, not in session
 *
 * Usage:
 * 1. Copy to ~/.pi/agent/extensions/
 * 2. pi /reload
 * 3. Use /undo, /redo, /rollback, /snapshot
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const UNDO_BRANCH = "pi-undo-history";
const STATE_KEY = "git-undo-state";

interface GitUndoState {
	commits: Array<{
		entryId: string;
		gitCommit: string;
		timestamp: number;
		message: string;
	}>;
	undoStack: string[]; // Commit hashes for redo
	currentIndex: number;
	initialized: boolean;
}

export default function gitSessionUndoExtension(pi: ExtensionAPI) {
	let state: GitUndoState = {
		commits: [],
		undoStack: [],
		currentIndex: -1,
		initialized: false,
	};

	let isGitRepo = false;

	// Initialize git undo branch
	const initUndoBranch = async (): Promise<boolean> => {
		try {
			// Check if git repo
			const _checkResult = await pi.exec("git", ["rev-parse", "--git-dir"], {
				cwd: pi.cwd,
				timeout: 5000,
			});
			isGitRepo = true;

			// Check if undo branch exists
			const branchResult = await pi.exec("git", ["branch", "--list", UNDO_BRANCH], {
				cwd: pi.cwd,
				timeout: 5000,
			});

			if (!branchResult.stdout.trim()) {
				// Create undo branch
				await pi.exec("git", ["checkout", "-b", UNDO_BRANCH], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				// Return to original branch
				await pi.exec("git", ["checkout", "-"], {
					cwd: pi.cwd,
					timeout: 5000,
				});
			}

			return true;
		} catch (_error) {
			isGitRepo = false;
			return false;
		}
	};

	// Create a commit in the undo branch
	const createUndoCommit = async (entryId: string): Promise<string | undefined> => {
		if (!isGitRepo) return undefined;

		try {
			const timestamp = Date.now();
			const shortId = entryId.slice(0, 8);

			// Switch to undo branch
			await pi.exec("git", ["checkout", UNDO_BRANCH], {
				cwd: pi.cwd,
				timeout: 5000,
			});

			// Stage all changes
			await pi.exec("git", ["add", "-A"], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			// Check if there are changes to commit
			const statusResult = await pi.exec("git", ["status", "--porcelain"], {
				cwd: pi.cwd,
				timeout: 5000,
			});

			let commitHash: string;

			if (statusResult.stdout.trim()) {
				// Create commit with message
				await pi.exec(
					"git",
					["commit", "-m", `Turn ${shortId} at ${new Date(timestamp).toISOString()}`, "--no-verify"],
					{
						cwd: pi.cwd,
						timeout: 10000,
					},
				);

				// Get commit hash
				const hashResult = await pi.exec("git", ["rev-parse", "HEAD"], {
					cwd: pi.cwd,
					timeout: 5000,
				});
				commitHash = hashResult.stdout.trim();
			} else {
				// No changes, use previous commit
				const hashResult = await pi.exec("git", ["rev-parse", "HEAD"], {
					cwd: pi.cwd,
					timeout: 5000,
				});
				commitHash = hashResult.stdout.trim();
			}

			// Return to original branch
			await pi.exec("git", ["checkout", "-"], {
				cwd: pi.cwd,
				timeout: 5000,
			});

			return commitHash;
		} catch (_error) {
			// Try to return to original branch if we're stuck in undo branch
			try {
				await pi.exec("git", ["checkout", "-"], {
					cwd: pi.cwd,
					timeout: 5000,
				});
			} catch {}
			return undefined;
		}
	};

	// Reset working directory to a specific commit
	const resetToCommit = async (commitHash: string): Promise<boolean> => {
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

	// Register /undo command
	pi.registerCommand("undo", {
		description: "Undo last turn (git-based)",
		handler: async (_args, ctx) => {
			if (!isGitRepo) {
				ctx.ui.notify("Not a git project. Run 'git init' first.", "error");
				return;
			}

			if (state.currentIndex < 0) {
				ctx.ui.notify("Nothing to undo", "warning");
				return;
			}

			const currentCommit = state.commits[state.currentIndex];

			if (!ctx.hasUI) {
				ctx.ui.notify("Undo not available in this mode", "error");
				return;
			}

			// Confirm
			const confirm = await ctx.ui.confirm(
				"Undo last turn?",
				`Entry: ${currentCommit.entryId}\nTime: ${new Date(currentCommit.timestamp).toLocaleString()}`,
			);

			if (!confirm) return;

			// Find previous commit
			const prevCommit = state.currentIndex > 0 ? state.commits[state.currentIndex - 1] : undefined;

			if (prevCommit) {
				// Reset to previous commit
				const success = await resetToCommit(prevCommit.gitCommit);
				if (success) {
					ctx.ui.notify("Undo successful", "info");

					// Add to redo stack
					state.undoStack.push(currentCommit.gitCommit);
					state.currentIndex--;

					// Persist
					pi.appendEntry(STATE_KEY, state);
				} else {
					ctx.ui.notify("Undo failed", "error");
				}
			} else {
				ctx.ui.notify("Already at the beginning", "warning");
			}
		},
	});

	// Register /redo command
	pi.registerCommand("redo", {
		description: "Redo last undone turn",
		handler: async (_args, ctx) => {
			if (!isGitRepo) {
				ctx.ui.notify("Not a git project", "error");
				return;
			}

			if (state.undoStack.length === 0) {
				ctx.ui.notify("Nothing to redo", "warning");
				return;
			}

			const commitHash = state.undoStack.pop()!;

			if (!ctx.hasUI) return;

			const success = await resetToCommit(commitHash);
			if (success) {
				ctx.ui.notify("Redo successful", "info");
				state.currentIndex++;
				pi.appendEntry(STATE_KEY, state);
			} else {
				ctx.ui.notify("Redo failed", "error");
			}
		},
	});

	// Register /rollback command
	pi.registerCommand("rollback", {
		description: "Rollback to a specific entry",
		getArgumentCompletions: (prefix) => {
			return state.commits
				.slice(-10)
				.map((c) => ({
					value: c.entryId,
					label: c.entryId,
					description: `${new Date(c.timestamp).toLocaleString()} - ${c.message}`,
				}))
				.filter((item) => item.label.startsWith(prefix));
		},
		handler: async (args, ctx) => {
			const entryId = args.trim();

			if (!entryId) {
				ctx.ui.notify("Usage: /rollback <entry-id>", "warning");
				return;
			}

			const commit = state.commits.find((c) => c.entryId === entryId);

			if (!commit) {
				ctx.ui.notify(`No snapshot for entry ${entryId}`, "error");
				return;
			}

			if (!ctx.hasUI) {
				ctx.ui.notify("Rollback not available in this mode", "error");
				return;
			}

			const confirm = await ctx.ui.confirm(
				"Rollback to this point?",
				`Entry: ${entryId}\nTime: ${new Date(commit.timestamp).toLocaleString()}\nCommit: ${commit.gitCommit.slice(0, 8)}`,
			);

			if (!confirm) return;

			const success = await resetToCommit(commit.gitCommit);
			if (success) {
				ctx.ui.notify(`Rolled back to ${entryId}`, "info");

				// Update state
				state.currentIndex = state.commits.findIndex((c) => c.entryId === entryId);
				state.undoStack = [];
				pi.appendEntry(STATE_KEY, state);

				ctx.ui.notify("Tip: Use /tree to navigate to the conversation point", "info");
			} else {
				ctx.ui.notify("Rollback failed", "error");
			}
		},
	});

	// Register /snapshot command (manual checkpoint)
	pi.registerCommand("snapshot", {
		description: "Create a manual snapshot checkpoint",
		handler: async (args, ctx) => {
			if (!isGitRepo) {
				ctx.ui.notify("Not a git project", "error");
				return;
			}

			const message = args.trim() || `Manual snapshot at ${new Date().toLocaleString()}`;

			const leaf = ctx.sessionManager.getLeafEntry();
			if (!leaf) {
				ctx.ui.notify("No active session", "error");
				return;
			}

			const commitHash = await createUndoCommit(leaf.id);

			if (commitHash) {
				// Update state
				state.commits.push({
					entryId: leaf.id,
					gitCommit: commitHash,
					timestamp: Date.now(),
					message,
				});
				state.currentIndex = state.commits.length - 1;
				state.undoStack = [];

				// Persist
				pi.appendEntry(STATE_KEY, state);

				ctx.ui.notify(`Snapshot created: ${commitHash.slice(0, 8)}`, "info");
			} else {
				ctx.ui.notify("Failed to create snapshot", "error");
			}
		},
	});

	// Register /log command (show history)
	pi.registerCommand("log", {
		description: "Show undo history",
		handler: async (args, ctx) => {
			if (state.commits.length === 0) {
				ctx.ui.notify("No history", "info");
				return;
			}

			const limit = parseInt(args.trim(), 10) || 10;
			const recent = state.commits.slice(-limit);

			let output = `Undo History (last ${recent.length} of ${state.commits.length}):\n\n`;

			for (let i = 0; i < recent.length; i++) {
				const commit = recent[i];
				const isCurrent = i === state.commits.length - 1 - (state.commits.length - 1 - state.currentIndex);
				const marker = isCurrent ? " ← current" : "";
				output += `${commit.entryId} | ${commit.gitCommit.slice(0, 8)} | ${new Date(commit.timestamp).toLocaleString()}${marker}\n`;
			}

			ctx.ui.notify(output, "info");
		},
	});

	// Auto-capture at turn end
	pi.on("turn_end", async (_event, ctx) => {
		if (!isGitRepo) return;

		const leaf = ctx.sessionManager.getLeafEntry();
		if (!leaf) return;

		// Create git commit
		const commitHash = await createUndoCommit(leaf.id);

		if (commitHash) {
			state.commits.push({
				entryId: leaf.id,
				gitCommit: commitHash,
				timestamp: Date.now(),
				message: `Turn ${leaf.id.slice(0, 8)}`,
			});
			state.currentIndex = state.commits.length - 1;
			state.undoStack = [];

			// Persist
			pi.appendEntry(STATE_KEY, state);
		}
	});

	// Initialize on session start
	pi.on("session_start", async (_event, ctx) => {
		const success = await initUndoBranch();

		if (success) {
			// Load state from session
			const entries = ctx.sessionManager.getEntries();
			for (let i = entries.length - 1; i >= 0; i--) {
				const entry = entries[i];
				if (entry.type === "custom" && entry.customType === STATE_KEY) {
					state = entry.data as GitUndoState;
					break;
				}
			}
		}
	});

	// Cleanup on shutdown
	pi.on("session_shutdown", async () => {
		if (state.commits.length > 0) {
			pi.appendEntry(STATE_KEY, state);
		}
	});
}
