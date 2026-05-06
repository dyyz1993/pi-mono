import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	clearConfigValueCache,
	resolveConfigValue,
	resolveConfigValueOrThrow,
	resolveConfigValueUncached,
	resolveHeaders,
	resolveHeadersOrThrow,
} from "../src/core/resolve-config-value.js";

describe("resolveConfigValue", () => {
	beforeEach(() => {
		clearConfigValueCache();
	});
	afterEach(() => {
		clearConfigValueCache();
	});

	it("returns literal string as-is", () => {
		expect(resolveConfigValue("my-api-key")).toBe("my-api-key");
	});

	it("returns env var value when config matches an env var name", () => {
		process.env._TEST_RESOLVE_VAR = "env-value-123";
		try {
			expect(resolveConfigValue("_TEST_RESOLVE_VAR")).toBe("env-value-123");
		} finally {
			delete process.env._TEST_RESOLVE_VAR;
		}
	});

	it("returns literal when no matching env var exists", () => {
		expect(resolveConfigValue("SOME_NONEXISTENT_VAR_ABCXYZ")).toBe("SOME_NONEXISTENT_VAR_ABCXYZ");
	});

	it("executes shell command when config starts with !", () => {
		clearConfigValueCache();
		const result = resolveConfigValue("!echo hello");
		expect(result).toBe("hello");
	});

	it("trims whitespace from command output", () => {
		clearConfigValueCache();
		const result = resolveConfigValue("!echo '  spaced  '");
		expect(result).toBe("spaced");
	});

	it("returns undefined for failing command", () => {
		clearConfigValueCache();
		const result = resolveConfigValue("!false");
		expect(result).toBeUndefined();
	});

	it("caches command results", () => {
		clearConfigValueCache();
		const r1 = resolveConfigValue("!echo cached");
		expect(r1).toBe("cached");

		const r2 = resolveConfigValue("!echo cached");
		expect(r2).toBe("cached");
	});

	it("returns undefined for command with empty output", () => {
		clearConfigValueCache();
		const result = resolveConfigValue("!printf ''");
		expect(result).toBeUndefined();
	});
});

describe("resolveConfigValueUncached", () => {
	it("returns literal string as-is", () => {
		expect(resolveConfigValueUncached("literal")).toBe("literal");
	});

	it("returns env var value", () => {
		process.env._TEST_UNCACHED_VAR = "uncached-val";
		try {
			expect(resolveConfigValueUncached("_TEST_UNCACHED_VAR")).toBe("uncached-val");
		} finally {
			delete process.env._TEST_UNCACHED_VAR;
		}
	});

	it("executes shell command without caching", () => {
		const r1 = resolveConfigValueUncached("!echo uncached");
		expect(r1).toBe("uncached");
	});
});

describe("resolveConfigValueOrThrow", () => {
	it("returns resolved value on success", () => {
		const result = resolveConfigValueOrThrow("my-key", "API key");
		expect(result).toBe("my-key");
	});

	it("returns env var value on success", () => {
		process.env._TEST_THROW_VAR = "throw-val";
		try {
			expect(resolveConfigValueOrThrow("_TEST_THROW_VAR", "test var")).toBe("throw-val");
		} finally {
			delete process.env._TEST_THROW_VAR;
		}
	});

	it("throws for failing shell command with descriptive message", () => {
		expect(() => resolveConfigValueOrThrow("!false", "API key")).toThrow(
			/Failed to resolve API key from shell command: false/,
		);
	});

	it("throws for empty command output with generic message", () => {
		expect(() => resolveConfigValueOrThrow("!printf ''", "test config")).toThrow(/Failed to resolve test config/);
	});

	it("throws generic message for non-command resolution failure", () => {
		expect(() => resolveConfigValueOrThrow("!false", "my thing")).toThrow(/Failed to resolve my thing/);
	});
});

describe("resolveHeaders", () => {
	it("returns undefined for undefined input", () => {
		expect(resolveHeaders(undefined)).toBeUndefined();
	});

	it("returns undefined for empty object", () => {
		expect(resolveHeaders({})).toBeUndefined();
	});

	it("resolves literal header values", () => {
		const result = resolveHeaders({ "X-Custom": "value123" });
		expect(result).toEqual({ "X-Custom": "value123" });
	});

	it("resolves env var header values", () => {
		process.env._TEST_HEADER_VAR = "header-val";
		try {
			const result = resolveHeaders({ Authorization: "_TEST_HEADER_VAR" });
			expect(result).toEqual({ Authorization: "header-val" });
		} finally {
			delete process.env._TEST_HEADER_VAR;
		}
	});

	it("resolves shell command header values", () => {
		clearConfigValueCache();
		const result = resolveHeaders({ "X-Token": "!echo token123" });
		expect(result).toEqual({ "X-Token": "token123" });
	});

	it("skips headers with undefined resolved values", () => {
		clearConfigValueCache();
		const result = resolveHeaders({
			"X-Good": "literal-value",
			"X-Bad": "!false",
		});
		expect(result).toEqual({ "X-Good": "literal-value" });
	});

	it("returns undefined when all headers resolve to undefined", () => {
		clearConfigValueCache();
		const result = resolveHeaders({ "X-Bad": "!false" });
		expect(result).toBeUndefined();
	});
});

describe("resolveHeadersOrThrow", () => {
	it("returns undefined for undefined input", () => {
		expect(resolveHeadersOrThrow(undefined, "test")).toBeUndefined();
	});

	it("resolves all headers successfully", () => {
		const result = resolveHeadersOrThrow({ "X-Auth": "bearer-token" }, "test");
		expect(result).toEqual({ "X-Auth": "bearer-token" });
	});

	it("throws when any header fails to resolve", () => {
		expect(() => resolveHeadersOrThrow({ "X-Bad": "!false" }, "my service")).toThrow(
			/Failed to resolve my service header/,
		);
	});
});

describe("clearConfigValueCache", () => {
	it("clears cache so commands run again", () => {
		const r1 = resolveConfigValue("!echo first");
		expect(r1).toBe("first");

		clearConfigValueCache();

		const r2 = resolveConfigValue("!echo second");
		expect(r2).toBe("second");
	});
});
