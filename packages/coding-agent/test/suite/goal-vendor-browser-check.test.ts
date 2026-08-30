/**
 * browser_check tests: URL validation (file:// containment, localhost-only
 * http) and the live xbrowser runner (skipped when xbrowser is unavailable —
 * CI has no browser).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VerificationCheck } from "../../extensions/goal-vendor/types.ts";
import {
	createCallLLMVisionJudge,
	runVerificationCheck,
	validateVerificationCheckDefinition,
} from "../../extensions/goal-vendor/verification.ts";

function makeBrowserCheck(url: string, extra: Record<string, unknown> = {}): VerificationCheck {
	return {
		id: "BC1",
		kind: "browser_check",
		label: "page loads",
		url,
		...extra,
	} as VerificationCheck;
}

describe("goal-vendor browser_check validation", () => {
	let workspace: string;

	beforeEach(() => {
		workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-bc-")));
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("accepts a file:// url inside the workspace", () => {
		const check = makeBrowserCheck(`file://${workspace}/index.html`);
		expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
	});

	it("rejects a file:// url outside the workspace", () => {
		const check = makeBrowserCheck(`file://${path.join(workspace, "..", "evil.html")}`);
		expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/leaves|outside|workspace/i);
	});

	it("accepts a localhost http url", () => {
		const check = makeBrowserCheck("http://127.0.0.1:5173/");
		expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
	});

	it("rejects an external http url", () => {
		const check = makeBrowserCheck("https://example.com/");
		expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/localhost/i);
	});

	it("rejects out-of-range waitMs", () => {
		const check = makeBrowserCheck("http://127.0.0.1/", { waitMs: 20000 });
		expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/waitMs/);
	});
});

describe("goal-vendor browser_check live runner (xbrowser required)", () => {
	let workspace: string;
	let xbrowserAvailable = false;

	beforeEach(() => {
		workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-bc-live-")));
		try {
			const { execSync } = require("node:child_process") as typeof import("node:child_process");
			execSync("which xbrowser", { stdio: "ignore" });
			xbrowserAvailable = true;
		} catch {
			xbrowserAvailable = false;
		}
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("passes on a clean fixture page (live xbrowser)", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
		const check = makeBrowserCheck(`file://${workspace}/index.html`);
		const result = await runVerificationCheck(check, workspace, undefined, [workspace]);
		console.log("CLEAN RESULT:", result.summary);
		expect(result.passed).toBe(true);
		expect(result.summary).toContain("browser check passed");
	}, 90_000);

	it("fails when the page throws console errors beyond the budget (live xbrowser)", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(
			path.join(workspace, "index.html"),
			"<h1>PI_GOAL_BC_OK</h1><script>undefinedFnThatDoesNotExist()</script>",
		);
		const check = makeBrowserCheck(`file://${workspace}/index.html`, { maxConsoleErrors: 0 });
		const result = await runVerificationCheck(check, workspace, undefined, [workspace]);
		expect(result.passed).toBe(false);
	}, 90_000);

	it("fails when expectTextContains is missing from the page (live xbrowser)", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>something else entirely</h1>");
		const check = makeBrowserCheck(`file://${workspace}/index.html`, {
			expectTextContains: "PI_GOAL_BC_OK",
		});
		const result = await runVerificationCheck(check, workspace, undefined, [workspace]);
		expect(result.passed).toBe(false);
	}, 90_000);
});

describe("goal-vendor browser_check expectVisual validation", () => {
	let workspace: string;

	beforeEach(() => {
		workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-bc-vis-")));
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("accepts a well-formed expectVisual", () => {
		const check = makeBrowserCheck(`file://${workspace}/index.html`, {
			expectVisual: "grid canvas with a visible snake and score HUD",
		});
		expect(() => validateVerificationCheckDefinition(check, workspace)).not.toThrow();
	});

	it("rejects expectVisual longer than 300 chars", () => {
		const check = makeBrowserCheck(`file://${workspace}/index.html`, { expectVisual: "x".repeat(301) });
		expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/expectVisual/);
	});

	it("rejects empty/whitespace expectVisual", () => {
		const check = makeBrowserCheck(`file://${workspace}/index.html`, { expectVisual: "   " });
		expect(() => validateVerificationCheckDefinition(check, workspace)).toThrow(/expectVisual/);
	});
});

describe("goal-vendor browser_check expectVisual runner (xbrowser required, mocked judge)", () => {
	let workspace: string;
	let xbrowserAvailable = false;

	beforeEach(() => {
		workspace = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-goal-bc-visrun-")));
		try {
			const { execSync } = require("node:child_process") as typeof import("node:child_process");
			execSync("which xbrowser", { stdio: "ignore" });
			xbrowserAvailable = true;
		} catch {
			xbrowserAvailable = false;
		}
	});

	afterEach(() => {
		fs.rmSync(workspace, { recursive: true, force: true });
	});

	it("passes when mechanical probe and visual judge both pass", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
		const judgeCalls: string[] = [];
		const check = makeBrowserCheck(`file://${workspace}/index.html`, {
			expectVisual: "big heading reading PI_GOAL_BC_OK",
		});
		const result = await runVerificationCheck(check, workspace, undefined, [workspace], {
			visionJudge: async (imagePath, expectation) => {
				judgeCalls.push(`${imagePath}|${expectation}`);
				return { passed: true, reason: "heading clearly visible" };
			},
		});
		expect(result.passed).toBe(true);
		expect(result.summary).toContain("visual=true");
		expect(result.summary).toContain("visualReason=heading clearly visible");
		expect(judgeCalls).toHaveLength(1);
		expect(judgeCalls[0]).toContain(".png");
		expect(judgeCalls[0]).toContain("big heading reading PI_GOAL_BC_OK");
	}, 90_000);

	it("fails when the visual judge rejects the screenshot", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
		const check = makeBrowserCheck(`file://${workspace}/index.html`, {
			expectVisual: "a playable snake grid",
		});
		const result = await runVerificationCheck(check, workspace, undefined, [workspace], {
			visionJudge: async () => ({ passed: false, reason: "no grid visible, only a heading" }),
		});
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("visual=false");
		expect(result.summary).toContain("no grid visible");
	}, 90_000);

	it("fails with an actionable message when the judge throws (e.g. model rejects images)", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
		const check = makeBrowserCheck(`file://${workspace}/index.html`, { expectVisual: "anything" });
		const result = await runVerificationCheck(check, workspace, undefined, [workspace], {
			visionJudge: async () => {
				throw new Error("provider rejected image content");
			},
		});
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("visual assertion could not run");
		expect(result.summary).toContain("provider rejected image content");
	}, 90_000);

	it("fails when expectVisual is set but no judge is injected", async () => {
		if (!xbrowserAvailable) return expect(true, "xbrowser not installed").toBe(true);
		fs.writeFileSync(path.join(workspace, "index.html"), "<h1>PI_GOAL_BC_OK</h1>");
		const check = makeBrowserCheck(`file://${workspace}/index.html`, { expectVisual: "anything" });
		const result = await runVerificationCheck(check, workspace, undefined, [workspace]);
		expect(result.passed).toBe(false);
		expect(result.summary).toContain("vision judge unavailable");
	}, 90_000);
});

describe("createCallLLMVisionJudge", () => {
	it("parses a fenced JSON verdict and forwards image blocks", async () => {
		const seen: Array<unknown> = [];
		const judge = createCallLLMVisionJudge(async (options) => {
			seen.push(options.messages);
			return '```json\n{"passed":true,"reason":"snake grid visible"}\n```';
		});
		const png = path.join(os.tmpdir(), `judge-${Date.now()}.png`);
		fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
		try {
			const verdict = await judge(png, "snake grid with HUD");
			expect(verdict.passed).toBe(true);
			expect(verdict.reason).toBe("snake grid visible");
			// message content must contain an image block carrying the file bytes as base64
			const first = seen[0] as Array<{
				role: string;
				content: Array<{ type: string; data?: string; mimeType?: string; text?: string }>;
			}>;
			const blocks = first[0].content;
			expect(
				blocks.some(
					(b) =>
						b.type === "image" && typeof b.data === "string" && b.data.length > 0 && b.mimeType === "image/png",
				),
			).toBe(true);
			expect(blocks.some((b) => b.type === "text" && (b.text ?? "").includes("snake grid with HUD"))).toBe(true);
		} finally {
			fs.rmSync(png, { force: true });
		}
	});

	it("returns passed=false on unparseable judge output", async () => {
		const judge = createCallLLMVisionJudge(async () => "I think the page looks great!");
		const png = path.join(os.tmpdir(), `judge2-${Date.now()}.png`);
		fs.writeFileSync(png, Buffer.from("89504e470d0a1a0a", "hex"));
		try {
			const verdict = await judge(png, "anything");
			expect(verdict.passed).toBe(false);
			expect(verdict.reason).toContain("unparseable");
		} finally {
			fs.rmSync(png, { force: true });
		}
	});
});
