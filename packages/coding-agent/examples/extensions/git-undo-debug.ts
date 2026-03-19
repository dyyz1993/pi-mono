/**
 * Git Undo/Redo - Debug Version
 *
 * Simplified version for testing - logs everything to console
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATE_KEY = "git-undo-debug";

interface DebugState {
	commits: Array<{
		entryId: string;
		gitCommit: string;
		timestamp: number;
	}>;
	currentIndex: number;
}

export default function gitUndoDebugExtension(pi: ExtensionAPI) {
	let state: DebugState = {
		commits: [],
		currentIndex: -1,
	};

	let isGitRepo = false;

	// Check git
	const checkGit = async (): Promise<boolean> => {
		try {
			await pi.exec("git", ["rev-parse", "--git-dir"], { cwd: pi.cwd, timeout: 5000 });
			isGitRepo = true;
			console.log("[git-undo] ✅ Git repo detected");
			return true;
		} catch {
			isGitRepo = false;
			console.log("[git-undo] ❌ Not a git repo");
			return false;
		}
	};

	// Create checkpoint
	const createCheckpoint = async (entryId: string) => {
		if (!isGitRepo) return;

		try {
			console.log(`[git-undo] Creating checkpoint for ${entryId}`);

			// Add all changes
			await pi.exec("git", ["add", "-A"], { cwd: pi.cwd, timeout: 10000 });

			// Check if there are changes
			const status = await pi.exec("git", ["status", "--porcelain"], { cwd: pi.cwd, timeout: 5000 });

			if (!status.stdout.trim()) {
				console.log("[git-undo] No changes to commit");
				return;
			}

			// Commit
			const msg = `Undo checkpoint ${entryId.slice(0, 8)}`;
			await pi.exec("git", ["commit", "-m", msg, "--no-verify"], { cwd: pi.cwd, timeout: 10000 });

			// Get hash
			const hashResult = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: pi.cwd, timeout: 5000 });
			const hash = hashResult.stdout.trim();

			console.log(`[git-undo] ✅ Checkpoint created: ${hash.slice(0, 8)}`);

			// Save state
			state.commits.push({
				entryId,
				gitCommit: hash,
				timestamp: Date.now(),
			});
			state.currentIndex = state.commits.length - 1;
			pi.appendEntry(STATE_KEY, state);
		} catch (error) {
			console.error("[git-undo] ❌ Checkpoint failed:", error);
		}
	};

	// Register /gundo (git undo)
	pi.registerCommand("gundo", {
		description: "Git undo - debug version",
		handler: async (args, ctx) => {
			console.log("[git-undo] /gundo called");

			if (!(await checkGit())) {
				ctx.ui.notify("Not a git repo", "error");
				return;
			}

			if (state.currentIndex < 0) {
				ctx.ui.notify("Nothing to undo", "warning");
				console.log("[git-undo] Nothing to undo");
				return;
			}

			const current = state.commits[state.currentIndex];
			console.log(`[git-undo] Current: ${current.entryId} @ ${current.gitCommit.slice(0, 8)}`);

			if (state.currentIndex === 0) {
				ctx.ui.notify("Already at first checkpoint", "warning");
				return;
			}

			const prev = state.commits[state.currentIndex - 1];
			console.log(`[git-undo] Previous: ${prev.entryId} @ ${prev.gitCommit.slice(0, 8)}`);

			const confirm = await ctx.ui.confirm("Undo?", `Revert to ${prev.gitCommit.slice(0, 8)}?`);

			if (!confirm) {
				console.log("[git-undo] Cancelled");
				return;
			}

			try {
				console.log(`[git-undo] Resetting to ${prev.gitCommit}`);

				await pi.exec("git", ["reset", "--hard", prev.gitCommit], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				await pi.exec("git", ["clean", "-fd"], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				state.currentIndex--;
				pi.appendEntry(STATE_KEY, state);

				ctx.ui.notify(`✅ Undone to ${prev.gitCommit.slice(0, 8)}`, "success");
				console.log("[git-undo] ✅ Undo successful");
			} catch (error) {
				ctx.ui.notify("Undo failed", "error");
				console.error("[git-undo] ❌ Undo failed:", error);
			}
		},
	});

	// Register /glog (git log)
	pi.registerCommand("glog", {
		description: "Git undo log - debug version",
		handler: async (args, ctx) => {
			await checkGit();

			if (state.commits.length === 0) {
				ctx.ui.notify("No checkpoints", "info");
				return;
			}

			let msg = `Checkpoints (${state.commits.length}):\n\n`;
			for (let i = 0; i < state.commits.length; i++) {
				const c = state.commits[i];
				const marker = i === state.currentIndex ? " ← CURRENT" : "";
				msg += `${i}: ${c.entryId} | ${c.gitCommit.slice(0, 8)} | ${new Date(c.timestamp).toLocaleTimeString()}${marker}\n`;
			}

			ctx.ui.notify(msg, "info");
			console.log("[git-undo] /glog:", msg);
		},
	});

	// Auto-capture on turn_end
	pi.on("turn_end", async (event, ctx) => {
		console.log("[git-undo] turn_end event");
		await checkGit();

		const leaf = ctx.sessionManager.getLeafEntry();
		if (leaf) {
			console.log(`[git-undo] Leaf: ${leaf.id}`);
			await createCheckpoint(leaf.id);
		}
	});

	// Load state on start
	pi.on("session_start", async (event, ctx) => {
		console.log("[git-undo] session_start");
		await checkGit();

		const entries = ctx.sessionManager.getEntries();
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "custom" && entry.customType === STATE_KEY) {
				state = entry.data as DebugState;
				console.log(`[git-undo] Loaded state: ${state.commits.length} commits`);
				break;
			}
		}
	});
}
