import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadAgentsFromDir } from "../src/core/agent-types.ts";

const tempDirs: string[] = [];

afterEach(() => {
	vi.restoreAllMocks();
	while (tempDirs.length > 0) {
		rmSync(tempDirs.pop()!, { recursive: true, force: true });
	}
});

function makeDir(): string {
	const dir = mkdtempSync(join(tmpdir(), "pi-agent-types-"));
	tempDirs.push(dir);
	return dir;
}

function writeAgent(dir: string, name: string, frontmatter: string): void {
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, `${name}.md`),
		`---\nname: ${name}\ndescription: Test agent\ntier: fast\nthinkingLevel: low\neffort: low\ntools: read\n${frontmatter}---\nBody\n`,
	);
}

describe("agent frontmatter permission profile parsing", () => {
	it("keeps existing permissionMode parsing", () => {
		const dir = makeDir();
		writeAgent(dir, "legacy-mode", "permissionMode: always-allow\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionMode).toBe("always-allow");
		expect(agent?.permissionProfile).toBeUndefined();
	});

	it("accepts permissionProfile and mirrors it to effective permissionMode", () => {
		const dir = makeDir();
		writeAgent(dir, "profile-mode", "permissionProfile: yolo\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionProfile).toBe("yolo");
		expect(agent?.permissionMode).toBe("yolo");
	});

	it("lets permissionProfile win when both profile fields are present", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const dir = makeDir();
		writeAgent(dir, "both-mode", "permissionMode: normal\npermissionProfile: yolo\n");

		const [agent] = loadAgentsFromDir(dir, "project");

		expect(agent?.permissionProfile).toBe("yolo");
		expect(agent?.permissionMode).toBe("yolo");
		expect(warn).toHaveBeenCalledWith(
			expect.stringContaining('defines both "permissionMode" and "permissionProfile"'),
		);
	});

	it("does not report permissionProfile as an unknown field", () => {
		const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
		const dir = makeDir();
		writeAgent(dir, "known-profile", "permissionProfile: normal\n");

		loadAgentsFromDir(dir, "project");

		expect(warn.mock.calls.some(([message]) => String(message).includes("unrecognized frontmatter"))).toBe(false);
	});
});
