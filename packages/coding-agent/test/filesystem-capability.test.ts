import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createLocalFileSystemCapability } from "../src/core/filesystem-capability.ts";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = join(tmpdir(), `pi-fs-cap-${Date.now()}-${Math.random().toString(36).slice(2)}`);
	mkdirSync(dir, { recursive: true });
	tempDirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of tempDirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe("LocalFileSystemCapability", () => {
	it("reads, writes, stats, and deletes files", async () => {
		const fs = createLocalFileSystemCapability();
		const root = makeTempDir();
		const filePath = join(root, "nested", "hello.txt");

		await fs.writeFile(filePath, "hello");

		expect(await fs.exists(filePath)).toBe(true);
		expect(await fs.readFileText(filePath)).toBe("hello");
		expect((await fs.readFile(filePath)).toString("utf-8")).toBe("hello");
		const stat = await fs.stat(filePath);
		expect(stat.size).toBe(5);
		expect(stat.isFile()).toBe(true);
		expect(stat.isDirectory()).toBe(false);

		await fs.delete(filePath);
		await fs.delete(filePath);
		expect(await fs.exists(filePath)).toBe(false);
	});

	it("returns typed directory entries including symlinks", async () => {
		const fs = createLocalFileSystemCapability();
		const root = makeTempDir();
		writeFileSync(join(root, "a.txt"), "a");
		mkdirSync(join(root, "dir"));
		symlinkSync(join(root, "a.txt"), join(root, "a-link"));

		const entries = await fs.readdirWithTypes(root);
		const byName = new Map(entries.map((entry) => [entry.name, entry]));

		expect(byName.get("a.txt")?.isFile()).toBe(true);
		expect(byName.get("dir")?.isDirectory()).toBe(true);
		expect(byName.get("a-link")?.isSymbolicLink()).toBe(true);
	});

	it("walks the workspace with depth, ignore, and file-count limits", async () => {
		const fs = createLocalFileSystemCapability();
		const root = makeTempDir();
		writeFileSync(join(root, "a.txt"), "a");
		mkdirSync(join(root, "nested"));
		writeFileSync(join(root, "nested", "b.txt"), "b");
		mkdirSync(join(root, "ignored"));
		writeFileSync(join(root, "ignored", "c.txt"), "c");

		const full = await fs.walk(root);
		expect(full.entries.some((entry) => entry.path.endsWith("/nested/b.txt"))).toBe(true);

		const shallow = await fs.walk(root, { maxDepth: 0 });
		expect(shallow.entries.some((entry) => entry.path.endsWith("/nested/b.txt"))).toBe(false);

		const ignored = await fs.walk(root, { ignore: ["ignored"] });
		expect(ignored.entries.some((entry) => entry.path.endsWith("/ignored/c.txt"))).toBe(false);

		const limited = await fs.walk(root, { maxFiles: 1 });
		expect(limited.limitReached).toBe(true);
		expect(limited.entries.filter((entry) => entry.type === "file")).toHaveLength(1);
	});

	it("reads batches without throwing for missing files", async () => {
		const fs = createLocalFileSystemCapability();
		const root = makeTempDir();
		const a = join(root, "a.txt");
		const missing = join(root, "missing.txt");
		writeFileSync(a, "a");

		const results = await fs.readBatch([a, missing]);
		expect(results[0]).toMatchObject({ path: a });
		expect(results[0]?.content?.toString("utf-8")).toBe("a");
		expect(results[1]?.path).toBe(missing);
		expect(results[1]?.content).toBeNull();
		expect(results[1]?.error).toBeTruthy();
	});
});
