import { describe, it, expect } from "vitest";
import { loadConfig } from "../index.ts";
import type { ExtensionContext } from "../../../../src/core/extensions/types.ts";
import type { Settings } from "../../../../src/core/settings-manager.ts";

function makeCtx(settings: Partial<Settings> = {}): ExtensionContext {
  return {
    getSettings: () => settings as Settings,
  } as unknown as ExtensionContext;
}

describe("output-guard loadConfig", () => {
  it("returns defaults when settings has no outputGuard key", () => {
    const config = loadConfig(makeCtx({}));
    expect(config.maxLines).toBe(2000);
    expect(config.maxBytes).toBe(50 * 1024);
    expect(config.findLimit).toBe(100);
    expect(config.lsLimit).toBe(100);
    expect(config.saveToFile).toBe(true);
  });

  it("returns defaults when outputGuard is empty object", () => {
    const config = loadConfig(makeCtx({ outputGuard: {} } as unknown as Settings));
    expect(config.maxLines).toBe(2000);
    expect(config.maxBytes).toBe(50 * 1024);
  });

  it("overrides maxLines when provided", () => {
    const config = loadConfig(makeCtx({ outputGuard: { maxLines: 5000 } } as unknown as Settings));
    expect(config.maxLines).toBe(5000);
    expect(config.maxBytes).toBe(50 * 1024);
  });

  it("overrides maxBytes when provided", () => {
    const config = loadConfig(makeCtx({ outputGuard: { maxBytes: 102400 } } as unknown as Settings));
    expect(config.maxBytes).toBe(102400);
  });

  it("overrides all fields when all provided", () => {
    const config = loadConfig(makeCtx({
      outputGuard: { maxLines: 3000, maxBytes: 102400, findLimit: 200, lsLimit: 50, saveToFile: false },
    } as unknown as Settings));
    expect(config).toEqual({
      maxLines: 3000,
      maxBytes: 102400,
      findLimit: 200,
      lsLimit: 50,
      saveToFile: false,
    });
  });

  it("ignores unknown keys in outputGuard", () => {
    const config = loadConfig(makeCtx({
      outputGuard: { unknownKey: "ignored", maxLines: 999 },
    } as unknown as Settings));
    expect(config.maxLines).toBe(999);
  });

  it("respects saveToFile: false override", () => {
    const config = loadConfig(makeCtx({ outputGuard: { saveToFile: false } } as unknown as Settings));
    expect(config.saveToFile).toBe(false);
  });

  it("handles undefined outputGuard explicitly", () => {
    const config = loadConfig(makeCtx({ outputGuard: undefined } as unknown as Settings));
    expect(config.maxLines).toBe(2000);
  });
});
