import { describe, expect, it } from "vitest";
import { McpConnectionError, McpError, McpTimeoutError, McpToolCallError } from "../../src/core/mcp/errors.js";

describe("McpError", () => {
	it("sets code, message, serverName, toolName", () => {
		const err = new McpError("TEST_CODE", "test message", "srv", "tool1");
		expect(err.code).toBe("TEST_CODE");
		expect(err.message).toBe("test message");
		expect(err.serverName).toBe("srv");
		expect(err.toolName).toBe("tool1");
		expect(err.name).toBe("McpError");
	});

	it("is instance of Error", () => {
		const err = new McpError("X", "msg");
		expect(err).toBeInstanceOf(Error);
	});

	it("defaults serverName and toolName to undefined", () => {
		const err = new McpError("X", "msg");
		expect(err.serverName).toBeUndefined();
		expect(err.toolName).toBeUndefined();
	});
});

describe("McpConnectionError", () => {
	it("has code CONNECTION_ERROR", () => {
		const err = new McpConnectionError("myServer", "conn failed");
		expect(err.code).toBe("CONNECTION_ERROR");
		expect(err.message).toBe("conn failed");
		expect(err.serverName).toBe("myServer");
		expect(err.name).toBe("McpConnectionError");
	});

	it("is instance of McpError and Error", () => {
		const err = new McpConnectionError("s", "m");
		expect(err).toBeInstanceOf(McpError);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("McpToolCallError", () => {
	it("has code TOOL_CALL_ERROR with serverName and toolName", () => {
		const err = new McpToolCallError("srv", "myTool", "call failed");
		expect(err.code).toBe("TOOL_CALL_ERROR");
		expect(err.message).toBe("call failed");
		expect(err.serverName).toBe("srv");
		expect(err.toolName).toBe("myTool");
		expect(err.name).toBe("McpToolCallError");
	});

	it("is instance of McpError and Error", () => {
		const err = new McpToolCallError("s", "t", "m");
		expect(err).toBeInstanceOf(McpError);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("McpTimeoutError", () => {
	it("has code TIMEOUT with formatted message", () => {
		const err = new McpTimeoutError("connect", "srv", 30000);
		expect(err.code).toBe("TIMEOUT");
		expect(err.message).toBe("connect timed out after 30000ms");
		expect(err.serverName).toBe("srv");
		expect(err.name).toBe("McpTimeoutError");
	});

	it("is instance of McpError and Error", () => {
		const err = new McpTimeoutError("op", "s", 1000);
		expect(err).toBeInstanceOf(McpError);
		expect(err).toBeInstanceOf(Error);
	});
});

describe("instanceof hierarchy", () => {
	it("all subtypes are instanceof McpError", () => {
		const conn = new McpConnectionError("s", "m");
		const tool = new McpToolCallError("s", "t", "m");
		const timeout = new McpTimeoutError("op", "s", 1000);
		expect(conn).toBeInstanceOf(McpError);
		expect(tool).toBeInstanceOf(McpError);
		expect(timeout).toBeInstanceOf(McpError);
	});

	it("subtypes are not instanceof each other", () => {
		const conn = new McpConnectionError("s", "m");
		const tool = new McpToolCallError("s", "t", "m");
		expect(conn).not.toBeInstanceOf(McpToolCallError);
		expect(tool).not.toBeInstanceOf(McpConnectionError);
	});
});
