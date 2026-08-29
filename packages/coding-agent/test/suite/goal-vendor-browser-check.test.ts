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
