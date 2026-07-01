import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	createLocalFileSystemCapability,
	type FileSystemCapability,
	type FileSystemWalkResult,
} from "../src/core/filesystem-capability.ts";
import { FileSnapshotManager } from "../src/core/file-store/file-snapshot-manager.ts";
import { InternalGit } from "../src/core/file-store/internal-git.ts";

function routedFs(localRoot: string, remoteRoot: string): FileSystemCapability {
	const local = createLocalFileSystemCapability();
	const toRemote = (path: string) => (path === localRoot ? remoteRoot : path.replace(`${localRoot}/`, `${remoteRoot}/`));
	return {
		readFile: (path) => local.readFile(toRemote(path)),
		readFileText: (path) => local.readFileText(toRemote(path)),
		writeFile: (path, content) => local.writeFile(toRemote(path), content),
		mkdir: (path) => local.mkdir(toRemote(path)),
		delete: (path) => local.delete(toRemote(path)),
		exists: (path) => local.exists(toRemote(path)),
		stat: (path) => local.stat(toRemote(path)),
		readdir: (path) => local.readdir(toRemote(path)),
		readdirWithTypes: (path) => local.readdirWithTypes(toRemote(path)),
		async walk(path, options): Promise<FileSystemWalkResult> {
			const result = await local.walk(toRemote(path), options);
			return {
				...result,
				entries: result.entries.map((entry) => ({
					...entry,
					path: entry.path === remoteRoot ? localRoot : entry.path.replace(`${remoteRoot}/`, `${localRoot}/`),
				})),
			};
		},
		readBatch: (paths) => local.readBatch(paths.map(toRemote)),
	};
}

describe("FileSnapshotManager workspace fs routing", () => {
	it("reads live project files from injected workspace fs instead of local disk", async () => {
		const root = await mkdtemp(join(tmpdir(), "pi-workspace-fs-"));
		const localCwd = join(root, "local");
		const remoteCwd = join(root, "remote");
		const storeDir = join(root, "store");
		const fs = routedFs(localCwd, remoteCwd);
		try {
			await mkdir(localCwd, { recursive: true });
			await mkdir(remoteCwd, { recursive: true });
			await writeFile(join(localCwd, "local-only.txt"), "local should be invisible", "utf-8");
			await writeFile(join(remoteCwd, "tracked.txt"), "v1", "utf-8");

			const mgr = new FileSnapshotManager(new InternalGit(storeDir), { workspaceFs: fs });
			await mgr.initializeAsync(localCwd);
			await writeFile(join(remoteCwd, "tracked.txt"), "v2", "utf-8");
			await writeFile(join(remoteCwd, "remote-only.txt"), "new", "utf-8");

			const changes = await mgr.getLiveChangesAsync(localCwd);
			expect(changes.map((change) => `${change.status}:${change.path}`).sort()).toEqual([
				"added:remote-only.txt",
				"modified:tracked.txt",
			]);
			expect(changes.some((change) => change.path === "local-only.txt")).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
