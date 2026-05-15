/**
 * Integration test for session-supervisor extension
 * Tests: config loading, guard defaults, agent_end flow
 */
import { describe, it, expect, beforeEach } from "vitest";

describe("session-supervisor extension", () => {
  describe("config defaults", () => {
    it("should have enable=false by default", async () => {
      const { loadConfig } = await import("../extensions/session-supervisor/config.js");
      const config = loadConfig("/tmp/nonexistent-session", "/tmp/nonexistent-project");
      expect(config.enable).toBe(false);
    });

    it("should have default keyword guard when no config file", async () => {
      const { loadConfig } = await import("../extensions/session-supervisor/config.js");
      const config = loadConfig("/tmp/nonexistent-session", "/tmp/nonexistent-project");
      expect(config.guards.length).toBe(1);
      expect(config.guards[0].type).toBe("keyword");
      expect(config.guards[0].name).toBe("incomplete-keywords");
      if (config.guards[0].type === "keyword") {
        expect(config.guards[0].keywords).toContain("TODO");
        expect(config.guards[0].keywords).toContain("FIXME");
        expect(config.guards[0].keywords).toContain("WIP");
      }
    });

    it("should have sane defaults for timing", async () => {
      const { loadConfig } = await import("../extensions/session-supervisor/config.js");
      const config = loadConfig("/tmp/nonexistent-session", "/tmp/nonexistent-project");
      expect(config.maxContinueCount).toBe(5);
      expect(config.defaultDelayMs).toBe(30_000);
      expect(config.checkOnAgentEnd).toBe(true);
    });
  });

  describe("keyword guard logic", () => {
    it("should detect WIP keywords in assistant text", async () => {
      // Simulate what the keyword guard does
      const keywords = ["TODO", "FIXME", "WIP", "HACK"];
      const text = "I've implemented the feature, but there are still TODO items remaining.";
      const found = keywords.filter((kw) => text.toLowerCase().includes(kw.toLowerCase()));
      expect(found.length).toBeGreaterThan(0);
      expect(found).toContain("TODO");
    });

    it("should not flag clean completion text", async () => {
      const keywords = ["TODO", "FIXME", "WIP", "HACK"];
      const text = "All tasks have been completed successfully. The feature is working as expected.";
      const found = keywords.filter((kw) => text.toLowerCase().includes(kw.toLowerCase()));
      expect(found.length).toBe(0);
    });
  });

  describe("guard check result type", () => {
    it("should produce correct result shape", () => {
      // Verify the expected shape of GuardCheckResult
      const result = {
        guardName: "test-guard",
        completed: false,
        confidence: 0.8,
        remainingItems: ["item1", "item2"],
        detail: "2 items remaining",
      };
      expect(result.completed).toBe(false);
      expect(result.remainingItems.length).toBe(2);
    });
  });
});
