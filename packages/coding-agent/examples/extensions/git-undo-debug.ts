/**
 * Git Undo/Redo - Debug Version
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

	const getFileChanges = async (fromCommit: string, toCommit: string): Promise<FileChangeInfo[]> => {
		try {
			// Get diff with status (A=added, M=modified, D=deleted)
			const statusResult = await pi.exec("git", ["diff", "--name-status", fromCommit, toCommit], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			// Get numstat for line counts
			const numstatResult = await pi.exec("git", ["diff", "--numstat", fromCommit, toCommit], {
				cwd: pi.cwd,
				timeout: 10000,
			});

			const changes: FileChangeInfo[] = [];
			const statusLines = statusResult.stdout
				.trim()
				.split("\n")
				.filter((l) => l);
			const numstatLines = numstatResult.stdout
				.trim()
				.split("\n")
				.filter((l) => l);

			// Build numstat map
			const numstatMap = new Map<string, { additions: number; deletions: number }>();
			for (const line of numstatLines) {
				const parts = line.split(/\s+/);
				if (parts.length >= 3) {
					const additions = parseInt(parts[0]) || 0;
					const deletions = parseInt(parts[1]) || 0;
					let path = parts[2];
					if (path.includes(" => ")) {
						path = path.split(" => ")[1];
					}
					numstatMap.set(path, { additions, deletions });
				}
			}

			for (const line of statusLines) {
				const parts = line.split(/\s+/);
				if (parts.length >= 2) {
					const statusChar = parts[0];
					let path = parts[1];

					if (path.includes(" => ")) {
						path = path.split(" => ")[1];
					}

					let status: FileChangeInfo["status"] = "modified";
					if (statusChar === "A") {
						status = "added";
					} else if (statusChar === "D") {
						status = "deleted";
					} else if (statusChar === "R") {
						// Renamed file - treat as deleted + added
						status = "added";
					}

					const numstat = numstatMap.get(path) || { additions: 0, deletions: 0 };

					changes.push({
						path,
						status,
						additions: numstat.additions,
						deletions: numstat.deletions,
					});
				}
			}

			return changes;
		} catch {
			return [];
		}
	};

	const getUserMessagePreview = async (entryId: string): Promise<string> => {
		try {
			const entries = (pi as any).sessionManager?.getEntries?.() || [];
			const entryIndex = entries.findIndex((e: any) => e.id === entryId);
			if (entryIndex <= 0) return `Entry: ${entryId.slice(0, 8)}`;

			for (let i = entryIndex - 1; i >= 0; i--) {
				const prevEntry = entries[i];
				if (prevEntry.type === "message" && prevEntry.message?.role === "user") {
					const content = prevEntry.message.content;
					const text =
						typeof content === "string"
							? content
							: Array.isArray(content)
								? content
										.filter((c: any) => c.type === "text")
										.map((c: any) => c.text)
										.join(" ")
								: "";

					if (text) {
						const preview = text.length > 40 ? text.slice(0, 37) + "..." : text;
						return `User: ${preview}`;
					}
				}
			}

			return `Entry: ${entryId.slice(0, 8)}`;
		} catch {
			return `Entry: ${entryId.slice(0, 8)}`;
		}
	};

	const getFileDiff = async (fromCommit: string, toCommit: string, filePath: string): Promise<string> => {
		try {
			const diffResult = await pi.exec("git", ["diff", fromCommit, toCommit, "--", filePath], {
				cwd: pi.cwd,
				timeout: 10000,
			});
			return diffResult.stdout || "No diff available";
		} catch {
			return "Unable to get diff";
		}
	};

	const createCheckpoint = async (entryId: string) => {
		if (!isGitRepo) return;

		try {
			console.log(`[git-undo] Creating checkpoint for ${entryId}`);

			const currentHashResult = await pi.exec("git", ["rev-parse", "HEAD"], { cwd: pi.cwd, timeout: 5000 });
			const currentHash = currentHashResult.stdout.trim();

			const alreadyExists = state.commits.some((c) => c.gitCommit === currentHash);
			if (alreadyExists) {
				console.log(`[git-undo] ℹ️ Checkpoint already exists: ${currentHash.slice(0, 8)}`);
				return;
			}

			const prevCommit =
				state.commits.length > 0 ? state.commits[state.commits.length - 1].gitCommit : `${currentHash}~1`;

			const changes = await getFileChanges(prevCommit, currentHash);

			if (changes.length === 0) {
				console.log(`[git-undo] ℹ️ No changes, recording current: ${currentHash.slice(0, 8)}`);
			} else {
				console.log(`[git-undo] Changes detected: ${changes.length} file(s)`);
			}

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

	pi.registerCommand("gundo", {
		description: "Git undo - select checkpoint to restore",
		handler: async (args, ctx) => {
			console.log("[git-undo] /gundo called");
			console.log(`[git-undo] State: ${state.commits.length} checkpoints, currentIndex=${state.currentIndex}`);

			if (!(await checkGit())) {
				ctx.ui.notify("Not a git repo", "error");
				return;
			}

			if (state.commits.length === 0) {
				console.log("[git-undo] No checkpoints available");
				ctx.ui.notify("Nothing to undo - no checkpoints captured yet. Make some file changes first!", "warning");
				return;
			}

			// Get current leaf to verify path
			const currentLeaf = ctx.sessionManager.getLeafId();
			console.log(`[git-undo] Current leaf: ${currentLeaf}`);

			// Build tree-like display (similar to /tree)
			const checkpointItems = state.commits.map((c, i) => {
				const time = new Date(c.timestamp).toLocaleTimeString();
				const fileCount = c.changes.length;
				const filesText = fileCount === 0 ? "no changes" : `${fileCount} file(s)`;
				const marker = i === state.currentIndex ? " ← CURRENT" : "";

				// Build file summary
				let fileSummary = "";
				if (fileCount > 0) {
					const added = c.changes.filter((ch) => ch.status === "added").length;
					const modified = c.changes.filter((ch) => ch.status === "modified").length;
					const deleted = c.changes.filter((ch) => ch.status === "deleted").length;
					const parts = [];
					if (added > 0) parts.push(`🟢+${added}`);
					if (modified > 0) parts.push(`🟡~${modified}`);
					if (deleted > 0) parts.push(`🔴-${deleted}`);
					fileSummary = ` | ${parts.join(" ")}`;
				}

				return {
					index: i,
					label: `│ │ ${c.gitCommit.slice(0, 8)} | ${time} | ${filesText}${fileSummary}${marker}`,
					commit: c,
				};
			});

			// Show tree-like selector
			const selected = await ctx.ui.select(
				"Git Undo - Select checkpoint to restore:",
				checkpointItems.map((item) => item.label),
			);

			if (!selected) {
				console.log("[git-undo] Selection cancelled");
				return;
			}

			// Find selected checkpoint
			const selectedItem = checkpointItems.find((item) => item.label === selected);
			if (!selectedItem) return;

			const selectedIndex = selectedItem.index;
			if (selectedIndex === state.currentIndex) {
				ctx.ui.notify("Already at selected checkpoint", "info");
				return;
			}

			const target = state.commits[selectedIndex];
			const changes = await getFileChanges(target.gitCommit, state.commits[state.currentIndex].gitCommit);

			const time = new Date(target.timestamp).toLocaleString();
			const userPreview = await getUserMessagePreview(target.entryId);

			let fileList = ``;

			if (changes.length === 0) {
				fileList = `  No file changes`;
			} else {
				const added = changes.filter((c) => c.status === "added");
				const modified = changes.filter((c) => c.status === "modified");
				const deleted = changes.filter((c) => c.status === "deleted");

				if (added.length > 0) {
					fileList += `🟢 Added (${added.length}):\n`;
					for (const f of added) {
						const pathDisplay = f.path.length > 50 ? `...${f.path.slice(-47)}` : f.path;
						fileList += `   + ${pathDisplay}\n`;
					}
				}

				if (modified.length > 0) {
					fileList += `🟡 Modified (${modified.length}):\n`;
					for (const f of modified) {
						const pathDisplay = f.path.length > 45 ? `...${f.path.slice(-42)}` : f.path;
						fileList += `   ~ ${pathDisplay} (+${f.additions}/-${f.deletions})\n`;
					}
				}

				if (deleted.length > 0) {
					fileList += `🔴 Deleted (${deleted.length}):\n`;
					for (const f of deleted) {
						const pathDisplay = f.path.length > 50 ? `...${f.path.slice(-47)}` : f.path;
						fileList += `   - ${pathDisplay}\n`;
					}
				}
			}

			const summary = `${userPreview}\nTime: ${time}\n\n${fileList}\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\nTotal: ${changes.length} file(s)`;

			// Ask for action
			const action = await ctx.ui.select("What would you like to do?", [
				"✅ Confirm Restore",
				"👁️ View File Diffs",
				"❌ Cancel",
			]);

			if (!action || action.includes("Cancel")) {
				console.log("[git-undo] Restore cancelled");
				return;
			}

			// View diffs
			if (action.includes("View")) {
				if (changes.length === 0) {
					ctx.ui.notify("No file changes to view", "info");
					return;
				}

				// Let user select which file to view
				const fileOptions = changes.map((c) => {
					const icon = c.status === "added" ? "🟢" : c.status === "deleted" ? "🔴" : "🟡";
					const changesText = c.status === "modified" ? `(+${c.additions}/-${c.deletions})` : "";
					return `${icon} ${c.path} ${changesText}`;
				});

				const selectedFile = await ctx.ui.select("Select file to view diff:", fileOptions);

				if (!selectedFile) return;

				const fileIndex = fileOptions.indexOf(selectedFile);
				if (fileIndex >= 0) {
					const file = changes[fileIndex];
					const diff = await getFileDiff(target.gitCommit, state.commits[state.currentIndex].gitCommit, file.path);

					// Show diff in a scrollable view
					ctx.ui.notify(`Diff for ${file.path}:\n\n${diff}`, "info");
				}

				// Go back to restore menu (recursive call)
				return await this.handler(args, ctx);
			}

			// Confirm restore
			const confirm = await ctx.ui.confirm(`Restore to ${target.gitCommit.slice(0, 8)}?`, summary);

			if (!confirm) {
				console.log("[git-undo] Restore cancelled");
				return;
			}

			// Ask for restore mode
			const mode = await ctx.ui.select("Restore mode:", [
				"🔄 Files + Context (restore files and conversation)",
				"📄 Files Only (restore files, keep conversation)",
			]);

			if (!mode) {
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

	const selectedFile = await ctx.ui.select("Select file to view diff:", fileOptions);

	if (!selectedFile) return;

	const fileIndex = fileOptions.indexOf(selectedFile);
	if (fileIndex >= 0) {
		const file = changes[fileIndex];
		const diff = await getFileDiff(target.gitCommit, state.commits[state.currentIndex].gitCommit, file.path);

		// Show diff in a scrollable view
		ctx.ui.notify(`Diff for ${file.path}:\n\n${diff}`, "info");
	}

	// Go back to restore menu
	return await this.handler(args, ctx);
}

// Confirm restore
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
	})

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
			const fileCount = c.changes.length;
			const filesText = fileCount === 0 ? "no changes" : `${fileCount} file(s)`;
			msg += `${i}: ${c.gitCommit.slice(0, 8)} | ${new Date(c.timestamp).toLocaleTimeString()} | ${filesText}${marker}\n`;
		}

		ctx.ui.notify(msg, "info");
		console.log("[git-undo] /glog:", msg);
	},
});

pi.on("turn_end", async (event, ctx) => {
	console.log("[git-undo] turn_end event");
	await checkGit();

	const leaf = ctx.sessionManager.getLeafEntry();
	if (leaf) {
		console.log(`[git-undo] Leaf: ${leaf.id}`);
		await createCheckpoint(leaf.id);
	}
});

// Update checkpoints when navigating tree
pi.on("session_tree", async (event, ctx) => {
	console.log("[git-undo] session_tree event - navigation detected");

	// Filter checkpoints to only include those on current path
	const currentLeaf = ctx.sessionManager.getLeafId();
	if (!currentLeaf) return;

	// Get all entries on current path
	const pathEntries = ctx.sessionManager.getBranch(currentLeaf);
	const pathEntryIds = new Set(pathEntries.map((e: any) => e.id));

	// Filter checkpoints to only include those on current path
	const filteredCommits = state.commits.filter((c) => pathEntryIds.has(c.entryId));

	if (filteredCommits.length !== state.commits.length) {
		console.log(`[git-undo] Filtered checkpoints: ${state.commits.length} → ${filteredCommits.length}`);
		state.commits = filteredCommits;
		state.currentIndex = filteredCommits.length - 1;
		pi.appendEntry(STATE_KEY, state);
	}
});

pi.on("session_start", async (event, ctx) => {
	console.log("[git-undo] session_start");
	await checkGit();

	const entries = ctx.sessionManager.getEntries();
	console.log(`[git-undo] Session has ${entries.length} entries`);

	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "custom" && entry.customType === STATE_KEY) {
			state = entry.data as DebugState;
			console.log(
				`[git-undo] ✅ Loaded state: ${state.commits.length} checkpoints, currentIndex=${state.currentIndex}`,
			);
			break;
		}
	}

	if (state.commits.length === 0) {
		console.log("[git-undo] ⚠️ No checkpoints loaded");
	}
});
}
