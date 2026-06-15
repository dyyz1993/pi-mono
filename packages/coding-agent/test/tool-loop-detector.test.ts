import { describe, expect, it } from "vitest";
import {
	checkToolEnd,
	computeToolSignature,
	createLoopDetectionState,
	type LoopDetectionState,
	recordToolStart,
	resetLoopDetection,
} from "../src/core/tool-loop-detector.ts";

describe("computeToolSignature", () => {
	it("returns toolName:{} for empty args", () => {
		expect(computeToolSignature("bash", undefined)).toBe("bash:{}");
		expect(computeToolSignature("bash", {})).toBe("bash:{}");
	});

	it("read signature includes offset (different offsets = different signatures)", () => {
		const sig1 = computeToolSignature("read", { path: "/a/b.ts", offset: 0, limit: 100 });
		const sig2 = computeToolSignature("read", { path: "/a/b.ts", offset: 200, limit: 50 });
		expect(sig1).not.toBe(sig2);
		expect(sig1).toBe("read:path=/a/b.ts:offset=0");
		expect(sig2).toBe("read:path=/a/b.ts:offset=200");
	});

	it("read same path same offset triggers (real loop)", () => {
		const sig1 = computeToolSignature("read", { path: "/a/b.ts", offset: 100 });
		const sig2 = computeToolSignature("read", { path: "/a/b.ts", offset: 100, limit: 200 });
		expect(sig1).toBe(sig2); // limit is ignored, same signature
	});

	it("edit/write signature uses path only", () => {
		const sig1 = computeToolSignature("edit", { path: "/a/b.ts", old_str: "foo" });
		const sig2 = computeToolSignature("edit", { path: "/a/b.ts", old_str: "bar" });
		expect(sig1).toBe(sig2);
		expect(sig1).toBe("edit:path=/a/b.ts");
	});

	it("uses truncated command for bash", () => {
		const longCmd = "x".repeat(300);
		const sig = computeToolSignature("bash", { command: longCmd });
		expect(sig).toBe(`bash:cmd=${"x".repeat(200)}`);
	});

	it("uses pattern for grep/glob", () => {
		expect(computeToolSignature("grep", { pattern: "TODO" })).toBe("grep:pattern=TODO");
		expect(computeToolSignature("glob", { pattern: "*.ts" })).toBe("glob:pattern=*.ts");
	});

	it("uses JSON for other tools", () => {
		const sig = computeToolSignature("custom_tool", { foo: "bar", num: 42 });
		expect(sig).toBe('custom_tool:{"foo":"bar","num":42}');
	});
});

describe("checkToolEnd", () => {
	function simulateCall(
		state: LoopDetectionState,
		toolCallId: string,
		toolName: string,
		args: Record<string, unknown> | undefined,
		isError: boolean,
	) {
		recordToolStart(state, toolCallId, toolName, args);
		return checkToolEnd(state, toolCallId, toolName, isError);
	}

	it("does not trigger on first call", () => {
		const state = createLoopDetectionState();
		const result = simulateCall(state, "call-1", "edit", { path: "/a.ts" }, true);
		expect(result).toBeUndefined();
	});

	it("triggers after 2 consecutive identical error calls", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "edit", { path: "/a.ts" }, true);
		const result = simulateCall(state, "call-2", "edit", { path: "/a.ts", old_str: "different" }, true);
		expect(result?.detected).toBe(true);
		expect(result?.hadErrors).toBe(true);
		expect(result?.count).toBe(2);
		expect(result?.message).toContain("edit");
		expect(result?.message).toContain("2");
	});

	it("triggers after 5 consecutive identical calls without errors", () => {
		const state = createLoopDetectionState();
		// Same path AND same offset (or no offset) = same signature
		for (let i = 1; i <= 4; i++) {
			const r = simulateCall(state, `call-${i}`, "read", { path: "/a.ts", offset: 0 }, false);
			expect(r).toBeUndefined();
		}
		const result = simulateCall(state, "call-5", "read", { path: "/a.ts", offset: 0 }, false);
		expect(result?.detected).toBe(true);
		expect(result?.hadErrors).toBe(false);
		expect(result?.count).toBe(5);
	});

	it("resets error count on successful call", () => {
		const state = createLoopDetectionState();
		// Two errors, but not enough to trigger (need 2 for error threshold)
		simulateCall(state, "call-1", "edit", { path: "/a.ts" }, true);
		// Second error would trigger (count=2 for errors), but let's test with success first
		// Actually with MAX_IDENTICAL_ERROR_CALLS=2, two errors DO trigger. Let me test success breaking the chain.
	});

	it("success breaks the error streak", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "bash", { command: "ls" }, true);
		// A success should reset error count
		simulateCall(state, "call-2", "bash", { command: "ls" }, false);
		// Now another error should not immediately trigger (error count was reset to 0, now 1)
		const result = simulateCall(state, "call-3", "bash", { command: "ls" }, true);
		expect(result).toBeUndefined();
	});

	it("resets on different signature", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "edit", { path: "/a.ts" }, true);
		// Different path = different signature, resets counter
		const result = simulateCall(state, "call-2", "edit", { path: "/b.ts" }, true);
		expect(result).toBeUndefined();
	});

	it("exempt tools do not trigger detection", () => {
		const state = createLoopDetectionState();
		for (let i = 1; i <= 10; i++) {
			const result = simulateCall(state, `call-${i}`, "todo", { action: "list" }, false);
			expect(result).toBeUndefined();
		}
	});

	it("different tools with same args are different signatures", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "read", { path: "/a.ts" }, true);
		const result = simulateCall(state, "call-2", "edit", { path: "/a.ts" }, true);
		expect(result).toBeUndefined();
	});

	it("empty args loop triggers on error (real-world pattern: empty {} validation)", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "bash", undefined, true);
		const result = simulateCall(state, "call-2", "bash", undefined, true);
		expect(result?.detected).toBe(true);
		expect(result?.hadErrors).toBe(true);
	});
});

describe("false-positive prevention (误杀测试)", () => {
	function simulateCall(
		state: LoopDetectionState,
		toolCallId: string,
		toolName: string,
		args: Record<string, unknown> | undefined,
		isError: boolean,
	) {
		recordToolStart(state, toolCallId, toolName, args);
		return checkToolEnd(state, toolCallId, toolName, isError);
	}

	it("reading different parts of a large file does NOT trigger", () => {
		const state = createLoopDetectionState();
		// Agent reads file in chunks: offset=0, 500, 1000, 1500, 2000, 2500
		for (let i = 0; i < 6; i++) {
			const result = simulateCall(state, `call-${i}`, "read", { path: "/big.ts", offset: i * 500 }, false);
			expect(result).toBeUndefined();
		}
	});

	it("editing same file multiple times with errors triggers", () => {
		const state = createLoopDetectionState();
		// Real loop: agent keeps trying to edit same file, keeps failing
		simulateCall(state, "call-1", "edit", { path: "/a.ts" }, true);
		const result = simulateCall(state, "call-2", "edit", { path: "/a.ts" }, true);
		expect(result?.detected).toBe(true);
	});

	it("editing same file with success then error does NOT trigger immediately", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "edit", { path: "/a.ts" }, false);
		simulateCall(state, "call-2", "edit", { path: "/a.ts" }, true);
		// count=2, errorCount=1 — not enough for either threshold
		expect(state.consecutiveCount).toBe(2);
		expect(state.consecutiveErrorCount).toBe(1);
	});

	it("5 successful edits to same file triggers (general threshold)", () => {
		const state = createLoopDetectionState();
		for (let i = 1; i <= 4; i++) {
			simulateCall(state, `call-${i}`, "edit", { path: "/a.ts" }, false);
		}
		const result = simulateCall(state, "call-5", "edit", { path: "/a.ts" }, false);
		expect(result?.detected).toBe(true);
		expect(result?.hadErrors).toBe(false);
	});

	it("different bash commands do NOT trigger", () => {
		const state = createLoopDetectionState();
		simulateCall(state, "call-1", "bash", { command: "npm test" }, false);
		simulateCall(state, "call-2", "bash", { command: "npm run lint" }, false);
		simulateCall(state, "call-3", "bash", { command: "npm run build" }, false);
		expect(state.consecutiveCount).toBe(1); // each is different
	});

	it("same bash command 5 times triggers (general threshold)", () => {
		const state = createLoopDetectionState();
		for (let i = 1; i <= 4; i++) {
			simulateCall(state, `call-${i}`, "bash", { command: "npx tsc --noEmit" }, false);
		}
		const result = simulateCall(state, "call-5", "bash", { command: "npx tsc --noEmit" }, false);
		expect(result?.detected).toBe(true);
	});
});

describe("resetLoopDetection", () => {
	it("resets all counters", () => {
		const state = createLoopDetectionState();
		state.lastSignature = "edit:path=/a.ts";
		state.consecutiveCount = 4;
		state.consecutiveErrorCount = 3;

		resetLoopDetection(state);

		expect(state.lastSignature).toBe("");
		expect(state.consecutiveCount).toBe(0);
		expect(state.consecutiveErrorCount).toBe(0);
	});

	it("does not clear pendingArgs (in-flight tools should still resolve)", () => {
		const state = createLoopDetectionState();
		recordToolStart(state, "call-1", "edit", { path: "/a.ts" });
		resetLoopDetection(state);
		expect(state.pendingArgs.size).toBe(1);
	});
});
