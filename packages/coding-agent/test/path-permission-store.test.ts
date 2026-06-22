import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PathPermissionStore } from "../src/core/path-permission-store.ts";
import { encodeProjectPath } from "../src/core/storage.ts";

describe("PathPermissionStore", () => {
	let storeDir: string;
	let store: PathPermissionStore;

	beforeEach(() => {
		storeDir = mkdtempSync(join(tmpdir(), "pi-path-perm-test-"));
		store = new PathPermissionStore(storeDir);
	});

	afterEach(() => {
		rmSync(storeDir, { recursive: true, force: true });
	});

	it("returns undefined for unknown paths", () => {
		expect(store.check("/project", "/tmp/foo.txt", "write")).toBeUndefined();
	});

	it("stores and retrieves an allow decision", () => {
		store.allow("/project", "/tmp/**", "read");
		expect(store.check("/project", "/tmp/foo.txt", "read")).toBe("allow");
		const scopedPath = join(storeDir, "projects", encodeProjectPath("/project"), "path-permissions.json");
		expect(existsSync(scopedPath)).toBe(true);
		expect(JSON.parse(readFileSync(scopedPath, "utf-8"))).toEqual([
			{ pattern: "/tmp/**", scope: "read", decision: "allow" },
		]);
	});

	it("stores and retrieves a deny decision", () => {
		store.deny("/project", "/etc/shadow", "read");
		expect(store.check("/project", "/etc/shadow", "read")).toBe("deny");
	});

	it("scopes decisions by cwd", () => {
		store.allow("/project-a", "/tmp/**", "read");
		expect(store.check("/project-b", "/tmp/foo.txt", "read")).toBeUndefined();
	});

	it("scopes decisions by operation (read vs write)", () => {
		store.allow("/project", "/tmp/**", "read");
		expect(store.check("/project", "/tmp/foo.txt", "read")).toBe("allow");
		expect(store.check("/project", "/tmp/foo.txt", "write")).toBeUndefined();
	});

	it("persists across store instances", () => {
		store.allow("/project", "/tmp/**", "write");
		const store2 = new PathPermissionStore(storeDir);
		expect(store2.check("/project", "/tmp/foo.txt", "write")).toBe("allow");
	});

	it("removes a decision", () => {
		store.allow("/project", "/tmp/**", "read");
		store.remove("/project", "/tmp/**", "read");
		expect(store.check("/project", "/tmp/foo.txt", "read")).toBeUndefined();
	});

	it("reads legacy global decisions without writing new decisions there", () => {
		const legacyPath = join(storeDir, "path-permissions.json");
		const legacy = {
			"/project": [{ pattern: "/legacy/**", scope: "write", decision: "allow" }],
		};
		writeFileSync(legacyPath, JSON.stringify(legacy, null, 2));
		expect(store.check("/project", "/legacy/file.txt", "write")).toBe("allow");

		store.deny("/project", "/new/**", "write");
		expect(JSON.parse(readFileSync(legacyPath, "utf-8"))).toEqual(legacy);
		expect(store.check("/project", "/new/file.txt", "write")).toBe("deny");
	});
});
