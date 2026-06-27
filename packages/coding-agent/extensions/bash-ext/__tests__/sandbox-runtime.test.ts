import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
  buildSandboxRuntimeConfig,
  isSandboxRuntimeEnabled,
  wrapCommandWithSandboxRuntime,
} from "../sandbox-runtime.ts";

describe("bash-ext sandbox runtime", () => {
  it("is opt-in through PI_SANDBOX_RUNTIME", () => {
    expect(isSandboxRuntimeEnabled({})).toBe(false);
    expect(isSandboxRuntimeEnabled({ PI_SANDBOX_RUNTIME: "0" })).toBe(false);
    expect(isSandboxRuntimeEnabled({ PI_SANDBOX_RUNTIME: "1" })).toBe(true);
    expect(isSandboxRuntimeEnabled({ PI_SANDBOX_RUNTIME: "true" })).toBe(true);
  });

  it("allows cwd and temp directories by default", () => {
    const config = buildSandboxRuntimeConfig("/tmp/pi-sandbox-cwd", {
      PI_SANDBOX_ALLOW_WRITE: "/tmp/extra-one:/tmp/extra-two",
    });

    expect(config.filesystem.allowWrite).toContain("/tmp/pi-sandbox-cwd");
    expect(config.filesystem.allowWrite).toContain(tmpdir());
    expect(config.filesystem.allowWrite).toContain("/tmp");
    expect(config.filesystem.allowWrite).toContain("/private/tmp");
    expect(config.filesystem.allowWrite).toContain("/tmp/extra-one");
    expect(config.filesystem.allowWrite).toContain("/tmp/extra-two");
    expect(config.network.allowedDomains).toEqual([]);
  });

  it("wraps command only when enabled", async () => {
    const disabled = await wrapCommandWithSandboxRuntime("echo hello", "/tmp", undefined, {});
    expect(disabled).toEqual({ command: "echo hello", enabled: false });

    const enabled = await wrapCommandWithSandboxRuntime("echo hello", "/tmp", undefined, {
      PI_SANDBOX_RUNTIME: "1",
    });
    expect(enabled.enabled).toBe(true);
    expect(enabled.command).toContain("echo hello");
    if (process.platform === "darwin") {
      expect(enabled.command).toContain("sandbox-exec");
    } else {
      expect(enabled.command).toContain("bwrap");
    }
  });

  it("blocks writes outside the allowed roots on macOS", async () => {
    if (process.platform !== "darwin") return;

    const cwd = mkdtempSync(join(tmpdir(), "pi-sandbox-runtime-test-"));
    const denied = join(homedir(), `.pi-sandbox-denied-${Date.now()}.txt`);
    const allowed = join(cwd, "allowed.txt");
    try {
      const wrapped = await wrapCommandWithSandboxRuntime(
        `echo ok > ${JSON.stringify(allowed)}; echo no > ${JSON.stringify(denied)}; cat ${JSON.stringify(allowed)}`,
        cwd,
        undefined,
        { PI_SANDBOX_RUNTIME: "1" },
      );

      const output = execFileSync("/bin/bash", ["-lc", wrapped.command], {
        cwd,
        encoding: "utf8",
      });

      expect(output).toContain("ok");
      expect(readFileSync(allowed, "utf8").trim()).toBe("ok");
      expect(() => readFileSync(denied, "utf8")).toThrow();
    } finally {
      rmSync(cwd, { recursive: true, force: true });
      rmSync(denied, { force: true });
    }
  });
});
