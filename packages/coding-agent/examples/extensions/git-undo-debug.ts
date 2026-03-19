/**
 * Git Undo/Redo - Debug Version
 *
 * Simplified version for testing - logs everything to console
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

const STATE_KEY = "git-undo-debug";

interface FileChangeInfo {
	path: string;
	status: "added" | "modified" | "deleted";
	additions: number;
	deletions: number;
}

interface CheckpointInfo {
	entryId: string;
	gitCommit: string;
	timestamp: number;
	changes: FileChangeInfo[];
}

interface DebugState {
	commits: CheckpointInfo[];
	currentIndex: number;
}

export default function gitUndoDebugExtension(pi: ExtensionAPI) {
	const state: DebugState = {
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

	// Get file changes between two commits
	const getFileChanges = async (fromCommit: string, toCommit: string): Promise<FileChangeInfo[]> => {
		try {
			// Get diff stats
			const diffResult = await pi.exec("git", ["diff", "--numstat", fromCommit, toCommit], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			const changes: FileChangeInfo[] = [];
			const lines = diffResult.stdout
				.trim()
				.split("\n")
				.filter((l) => l);

			for (const line of lines) {
				const parts = line.split(/\s+/);
				if (parts.length >= 3) {
					const additions = parseInt(parts[0]) || 0;
					const deletions = parseInt(parts[1]) || 0;
					let path = parts[2];

					// Handle renamed files
					if (path.includes(" => ")) {
						path = path.split(" => ")[1];
					}

					let status: FileChangeInfo["status"] = "modified";
					if (additions > 0 && deletions === 0 && path.startsWith("/dev/null")) {
						status = "added";
					} else if (additions === 0 && deletions > 0 && path.endsWith("/dev/null")) {
						status = "deleted";
						path = path.replace("/dev/null", "");
					}

					changes.push({ path, status, additions, deletions });
				}
			}

			return changes;
		} catch {
			return [];
		}
	};

	// Create checkpoint
	const createCheckpoint = async (entryId: string) => {
		if (!isGitRepo) return;

		try {
			console.log(`[git-undo] Creating checkpoint for ${entryId}`);

			// Get current commit hash
			const currentHashResult = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: pi.cwd, timeout: 5000 });
			const currentHash = currentHashResult.stdout.trim();

			// Check if we already have this commit
			const alreadyExists = state.commits.some((c) => c.gitCommit === currentHash);
			if (alreadyExists) {
				console.log(`[git-undo] ℹ️ Checkpoint already exists: ${currentHash.slice(0, 8)}`);
				return;
			}

			// Get previous commit for diff
			const prevCommit =
				state.commits.length > 0 ? state.commits[state.commits.length - 1].gitCommit : `${currentHash}~1`;

			// Get file changes
			const changes = await getFileChanges(prevCommit, currentHash);

			// Even if no changes, record the state
			if (changes.length === 0) {
				console.log(`[git-undo] ℹ️ No changes, recording current: ${currentHash.slice(0, 8)}`);
			} else {
				console.log(`[git-undo] Changes detected: ${changes.length} file(s)`);
			}

			// Save state with changes
			state.commits.push({
				entryId,
				gitCommit: currentHash,
				timestamp: Date.now(),
				changes,
			});
			state.currentIndex = state.commits.length - 1;
			pi.appendEntry(STATE_KEY, state);
		} catch (error) {
			console.error("[git-undo] ❌ Checkpoint failed:", error);
		}
	};

	// Register /gundo (git undo) - with selector like /tree
	pi.registerCommand("gundo", {
		description: "Git undo - select checkpoint to restore",
		handler: async (args, ctx) => {
			console.log("[git-undo] /gundo called");

			if (!(await checkGit())) {
				ctx.ui.notify("Not a git repo", "error");
				return;
			}

			if (state.commits.length === 0) {
				ctx.ui.notify("Nothing to undo", "warning");
				console.log("[git-undo] Nothing to undo");
				return;
			}

			// Build checkpoint list for selection
			const checkpoints = state.commits.map((c, i) => ({
				info: c,
				index: i,
				isCurrent: i === state.currentIndex,
			}));

			// Show selector (like /tree)
			const selected = await ctx.ui.select(
				"Select checkpoint to restore:",
				checkpoints.map((c) => {
					const time = new Date(c.info.timestamp).toLocaleTimeString();
					const marker = c.isCurrent ? " ← CURRENT" : "";
					const fileCount = c.info.changes.length;
					const filesText = fileCount === 0 ? "no changes" : `${fileCount} file(s)`;
					return `${c.info.gitCommit.slice(0, 8)} | ${time} | Entry: ${c.info.entryId} | ${filesText}${marker}`;
				}),
			);

			if (!selected) {
				console.log("[git-undo] Selection cancelled");
				return;
			}

			// Find selected checkpoint
			const selectedIndex = checkpoints.findIndex(
				(c) =>
					`${c.info.gitCommit.slice(0, 8)} | ${new Date(c.info.timestamp).toLocaleTimeString()} | Entry: ${c.info.entryId} | ${c.info.changes.length} file(s)${c.isCurrent ? " ← CURRENT" : ""}` ===
					selected,
			);

			if (selectedIndex === -1 || selectedIndex === state.currentIndex) {
				ctx.ui.notify("Already at selected checkpoint", "info");
				return;
			}

			const current = state.commits[state.currentIndex];
			const target = state.commits[selectedIndex];

			// Get changes between current and target
			const changes = await getFileChanges(target.gitCommit, current.gitCommit);

			// Build detailed change summary
			let summary = `Entry: ${target.entryId}\nTime: ${new Date(target.timestamp).toLocaleString()}\n\n`;

			if (changes.length === 0) {
				summary += "No file changes";
			} else {
				const added = changes.filter((c) => c.status === "added");
				const modified = changes.filter((c) => c.status === "modified");
				const deleted = changes.filter((c) => c.status === "deleted");

				if (added.length > 0) {
					summary += `📁 Added (${added.length}):\n`;
					for (const f of added.slice(0, 10)) {
						summary += `  + ${f.path}\n`;
					}
					if (added.length > 10) summary += `  ... and ${added.length - 10} more\n`;
				}

				if (modified.length > 0) {
					summary += `✏️ Modified (${modified.length}):\n`;
					for (const f of modified.slice(0, 10)) {
						summary += `  ~ ${f.path} (+${f.additions}/-${f.deletions})\n`;
					}
					if (modified.length > 10) summary += `  ... and ${modified.length - 10} more\n`;
				}

				if (deleted.length > 0) {
					summary += `🗑️ Deleted (${deleted.length}):\n`;
					for (const f of deleted.slice(0, 10)) {
						summary += `  - ${f.path}\n`;
					}
					if (deleted.length > 10) summary += `  ... and ${deleted.length - 10} more\n`;
				}
			}

			// Ask for restore mode
			const mode = await ctx.ui.select("Restore mode:", [
				"🔄 Files + Context (restore files and conversation)",
				"📄 Files Only (restore files, keep conversation)",
				"❌ Cancel",
			]);

			if (!mode || mode.includes("Cancel")) {
				console.log("[git-undo] Restore cancelled");
				return;
			}

			const confirm = await ctx.ui.confirm(`Restore to ${target.gitCommit.slice(0, 8)}?`, summary);

			if (!confirm) {
				console.log("[git-undo] Restore cancelled");
				return;
			}

			try {
				console.log(`[git-undo] Resetting to ${target.gitCommit}`);

				await pi.exec("git", ["reset", "--hard", target.gitCommit], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				await pi.exec("git", ["clean", "-fd"], {
					cwd: pi.cwd,
					timeout: 10000,
				});

				state.currentIndex = selectedIndex;
				pi.appendEntry(STATE_KEY, state);

				// Build result message
				const totalFiles = changes.length;
				const resultMsg = mode.includes("Files + Context")
					? `✅ Restored ${totalFiles} file(s) + conversation`
					: `✅ Restored ${totalFiles} file(s)`;

				ctx.ui.notify(resultMsg, "success");
				console.log(`[git-undo] ✅ Restore successful: ${totalFiles} file(s)`);
			} catch (error) {
				ctx.ui.notify("Restore failed", "error");
				console.error("[git-undo] ❌ Restore failed:", error);
			}
		},
	});

	await pi.exec("git", ["clean", "-fd"], {
					cwd: pi.cwd,
					timeout: 10000,
				});

	state.currentIndex = selectedIndex;
	pi.appendEntry(STATE_KEY, state);

	ctx.ui.notify(`✅ Restored to ${target.gitCommit.slice(0, 8)}`, "success");
	console.log("[git-undo] ✅ Restore successful");
}
catch (error)
{
	ctx.ui.notify("Restore failed", "error");
	console.error("[git-undo] ❌ Restore failed:", error);
}
},
	})

await pi.exec("git", ["clean", "-fd"], {
	cwd: pi.cwd,
	timeout: 10000,
});

state.currentIndex--;
pi.appendEntry(STATE_KEY, state);

ctx.ui.notify(`✅ Undone to ${prev.gitCommit.slice(0, 8)}`, "success");
console.log("[git-undo] ✅ Undo successful");
}
catch (error)
{
	ctx.ui.notify("Undo failed", "error");
	console.error("[git-undo] ❌ Undo failed:", error);
}
},
	})

// Register /glog (git log)
pi.registerCommand("glog",
{
	description: "Git undo log - debug version", handler;
	: async (args, ctx) =>
	{
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
	}
	,
}
)

// Auto-capture on turn_end
pi.on("turn_end", async (event, ctx) =>
{
	console.log("[git-undo] turn_end event");
	await checkGit();

	const leaf = ctx.sessionManager.getLeafEntry();
	if (leaf) {
		console.log(`[git-undo] Leaf: ${leaf.id}`);
		await createCheckpoint(leaf.id);
	}
}
)

// Load state on start
pi.on("session_start", async (event, ctx) =>
{
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
}
)
}
