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

			if (!(await checkGit())) {
				ctx.ui.notify("Not a git repo", "error");
				return;
			}

			if (state.commits.length === 0) {
				ctx.ui.notify("Nothing to undo", "warning");
				return;
			}

			const checkpoints = state.commits.map((c, i) => ({
				info: c,
				index: i,
				isCurrent: i === state.currentIndex,
			}));

			const selected = await ctx.ui.select(
				"Select checkpoint to restore:",
				await Promise.all(
					checkpoints.map(async (c) => {
						const time = new Date(c.info.timestamp).toLocaleTimeString();
						const marker = c.isCurrent ? " ← CURRENT" : "";
						const fileCount = c.info.changes.length;
						const filesText = fileCount === 0 ? "no changes" : `${fileCount} file(s)`;
						const userPreview = await getUserMessagePreview(c.info.entryId);
						return `${c.info.gitCommit.slice(0, 8)} | ${time} | ${userPreview} | ${filesText}${marker}`;
					}),
				),
			);

			if (!selected) {
				console.log("[git-undo] Selection cancelled");
				return;
			}

			const selectedIndex = checkpoints.findIndex(
				(c) =>
					`${c.info.gitCommit.slice(0, 8)} | ${new Date(c.info.timestamp).toLocaleTimeString()} | ${await getUserMessagePreview(c.info.entryId)} | ${c.info.changes.length} file(s)${c.isCurrent ? " ← CURRENT" : ""}` ===
					selected,
			);

			if (selectedIndex === -1 || selectedIndex === state.currentIndex) {
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
