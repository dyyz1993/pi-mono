import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { McpLogger } from "../../src/core/mcp/logger.js";

describe("McpLogger", () => {
	let logSpy: ReturnType<typeof vi.spyOn>;
	let warnSpy: ReturnType<typeof vi.spyOn>;
	let errorSpy: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
		warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
		errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		warnSpy.mockRestore();
		errorSpy.mockRestore();
	});

	describe("log level prefixes", () => {
		it("debug outputs [mcp:debug] prefix", () => {
			const logger = new McpLogger("debug");
			logger.debug("srv", "msg");
			expect(logSpy).toHaveBeenCalledWith("[mcp:debug] [srv] msg");
		});

		it("info outputs [mcp:info] prefix", () => {
			const logger = new McpLogger("info");
			logger.info("srv", "msg");
			expect(logSpy).toHaveBeenCalledWith("[mcp:info] [srv] msg");
		});

		it("warn outputs [mcp:warn] prefix via console.warn", () => {
			const logger = new McpLogger("info");
			logger.warn("srv", "msg");
			expect(warnSpy).toHaveBeenCalledWith("[mcp:warn] [srv] msg");
		});

		it("error outputs [mcp:error] prefix via console.error", () => {
			const logger = new McpLogger("info");
			logger.error("srv", "msg");
			expect(errorSpy).toHaveBeenCalledWith("[mcp:error] [srv] msg");
		});
	});

	describe("extra args are passed through", () => {
		it("passes extra arguments to console.log", () => {
			const logger = new McpLogger("debug");
			logger.info("srv", "msg", { key: 1 }, 42);
			expect(logSpy).toHaveBeenCalledWith("[mcp:info] [srv] msg", { key: 1 }, 42);
		});
	});

	describe("minLevel filtering", () => {
		it("debug level suppressed when minLevel is info", () => {
			const logger = new McpLogger("info");
			logger.debug("srv", "msg");
			expect(logSpy).not.toHaveBeenCalled();
		});

		it("debug level allowed when minLevel is debug", () => {
			const logger = new McpLogger("debug");
			logger.debug("srv", "msg");
			expect(logSpy).toHaveBeenCalled();
		});

		it("info and warn suppressed when minLevel is error", () => {
			const logger = new McpLogger("error");
			logger.info("srv", "msg");
			logger.warn("srv", "msg");
			expect(logSpy).not.toHaveBeenCalled();
			expect(warnSpy).not.toHaveBeenCalled();
		});

		it("error always outputs when minLevel is error", () => {
			const logger = new McpLogger("error");
			logger.error("srv", "msg");
			expect(errorSpy).toHaveBeenCalled();
		});

		it("all levels output when minLevel is debug", () => {
			const logger = new McpLogger("debug");
			logger.debug("s", "m");
			logger.info("s", "m");
			logger.warn("s", "m");
			logger.error("s", "m");
			expect(logSpy).toHaveBeenCalledTimes(2);
			expect(warnSpy).toHaveBeenCalledTimes(1);
			expect(errorSpy).toHaveBeenCalledTimes(1);
		});
	});
});
