import { describe, it, expect } from "vitest";
import {
  createLearningTestRuntime,
  createFakeChannel,
  createFakePi,
  emit,
  resetMocks,
} from "./testkit.ts";

describe("testkit", () => {
  describe("createFakeChannel", () => {
    it("records sent messages", () => {
      const outputs: Array<{ type: string; payload: unknown }> = [];
      const channel = createFakeChannel(outputs);
      channel.send("event1", { foo: 1 });
      channel.send("event2", { bar: 2 });
      expect(outputs).toEqual([
        { type: "event1", payload: { foo: 1 } },
        { type: "event2", payload: { bar: 2 } },
      ]);
    });

    it("invoke returns empty object by default", async () => {
      const channel = createFakeChannel();
      const result = await channel.invoke({} as never);
      expect(result).toEqual({});
    });
  });

  describe("createFakePi", () => {
    it("registers on() handlers", () => {
      const handlers: Record<string, Array<(e: unknown) => unknown>> = {};
      const channel = createFakeChannel();
      const pi = createFakePi(handlers, channel);
      const handler = () => "ok";
      pi.on("test_event", handler as never);
      expect(handlers.test_event).toEqual([handler]);
    });

    it("callLLM returns default JSON", async () => {
      const pi = createFakePi({}, createFakeChannel());
      const result = await pi.callLLM({ systemPrompt: "", messages: [] });
      expect(JSON.parse(result)).toEqual({ selected: [] });
    });

    it("callLLMSafe returns same default as callLLM", async () => {
      const pi = createFakePi({}, createFakeChannel());
      const result = await pi.callLLMSafe({ systemPrompt: "", messages: [] });
      expect(JSON.parse(result)).toEqual({ selected: [] });
    });

    it("overrides take precedence over defaults", async () => {
      const customLLM = async () => "custom-response";
      const pi = createFakePi({}, createFakeChannel(), {
        callLLM: customLLM as never,
      });
      const result = await pi.callLLM({ systemPrompt: "", messages: [] });
      expect(result).toBe("custom-response");
    });

    it("registerChannel returns the provided channel", () => {
      const channel = createFakeChannel();
      const pi = createFakePi({}, channel);
      const result = pi.registerChannel("name" as never);
      expect(result).toBe(channel);
    });
  });

  describe("createLearningTestRuntime", () => {
    it("returns pi, handlers, channel, outputs in one call", () => {
      const runtime = createLearningTestRuntime();
      expect(runtime.pi).toBeDefined();
      expect(runtime.handlers).toEqual({});
      expect(runtime.channel).toBeDefined();
      expect(Array.isArray(runtime.outputs)).toBe(true);
    });

    it("outputs capture channel.send", () => {
      const runtime = createLearningTestRuntime();
      runtime.channel.send("evt", { x: 42 });
      expect(runtime.outputs).toEqual([{ type: "evt", payload: { x: 42 } }]);
    });
  });

  describe("emit", () => {
    it("invokes all registered handlers for the event", async () => {
      const handlers: Record<string, Array<(e: unknown) => unknown>> = {};
      const calls: string[] = [];
      handlers.test = [
        () => {
          calls.push("first");
        },
        () => {
          calls.push("second");
        },
      ];
      await emit(handlers as never, "test", {});
      expect(calls).toEqual(["first", "second"]);
    });

    it("awaits async handlers", async () => {
      const handlers: Record<string, Array<(e: unknown) => Promise<unknown>>> = {};
      let resolved = false;
      handlers.async = [
        async () => {
          await new Promise((r) => setTimeout(r, 10));
          resolved = true;
        },
      ];
      await emit(handlers as never, "async", {});
      expect(resolved).toBe(true);
    });

    it("passes payload and ctx to handler", async () => {
      const handlers: Record<string, Array<(e: unknown, ctx: unknown) => unknown>> = {};
      let received: { payload: unknown; ctx: unknown } | null = null;
      handlers.evt = [
        (payload, ctx) => {
          received = { payload, ctx };
        },
      ];
      await emit(handlers as never, "evt", { data: "x" }, { cwd: "/tmp" } as never);
      expect(received).not.toBeNull();
      expect(received!.payload).toEqual({ data: "x" });
      expect((received!.ctx as { cwd: string }).cwd).toBe("/tmp");
    });

    it("no-op for unknown event", async () => {
      await emit({}, "unknown", {});
    });
  });

  describe("resetMocks", () => {
    it("clears mock call history", () => {
      const runtime = createLearningTestRuntime();
      runtime.channel.send("a", null);
      runtime.channel.send("b", null);
      expect(runtime.channel.send).toHaveBeenCalledTimes(2);

      resetMocks(runtime);
      expect(runtime.channel.send).toHaveBeenCalledTimes(0);
    });
  });
});
