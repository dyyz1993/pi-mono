/**
 * Safe Kill Extension - Unit Tests
 */

import { describe, it, expect } from "vitest";

const DANGEROUS_PATTERNS = [
	{
		pattern: /pkill\s+-f\s+["']([^"']+)["']/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程",
	},
	{
		pattern: /pkill\s+-f\s+([^\s"']+)/,
		command: "pkill -f <pattern>",
		description: "通过进程名称匹配杀死进程（无引号）",
	},
	{
		pattern: /killall\s+(\w+)/,
		command: "killall <name>",
		description: "通过进程名杀死所有匹配进程",
	},
];

function testCommand(command: string): { blocked: boolean; target?: string; pattern?: string } {
	for (const { pattern } of DANGEROUS_PATTERNS) {
		const match = command.match(pattern);
		if (match) {
			return { blocked: true, target: match[1], pattern: pattern.source };
		}
	}
	return { blocked: false };
}

describe("Safe Kill Extension", () => {
	describe("Dangerous pattern detection", () => {
		it("should block pkill -f with double quotes", () => {
			const result = testCommand('pkill -f "vite"');
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("vite");
		});

		it("should block pkill -f with single quotes", () => {
			const result = testCommand("pkill -f 'vite'");
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("vite");
		});

		it("should block pkill -f without quotes", () => {
			const result = testCommand("pkill -f vite");
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("vite");
		});

		it("should block pkill -f with regex pattern", () => {
			const result = testCommand('pkill -f "npm run.*dev"');
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("npm run.*dev");
		});

		it("should block killall", () => {
			const result = testCommand("killall vite");
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("vite");
		});

		it("should block killall with complex name", () => {
			const result = testCommand("killall node");
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("node");
		});
	});

	describe("Safe commands", () => {
		it("should allow kill with PID", () => {
			const result = testCommand("kill 12345");
			expect(result.blocked).toBe(false);
		});

		it("should allow kill -9 with PID", () => {
			const result = testCommand("kill -9 12345");
			expect(result.blocked).toBe(false);
		});

		it("should allow kill with signal", () => {
			const result = testCommand("kill -TERM 12345");
			expect(result.blocked).toBe(false);
		});

		it("should allow ps aux", () => {
			const result = testCommand("ps aux | grep vite");
			expect(result.blocked).toBe(false);
		});

		it("should allow pgrep", () => {
			const result = testCommand("pgrep -f vite");
			expect(result.blocked).toBe(false);
		});

		it("should allow lsof", () => {
			const result = testCommand("lsof -i :5173");
			expect(result.blocked).toBe(false);
		});

		it("should allow netstat", () => {
			const result = testCommand("netstat -tlnp | grep 5173");
			expect(result.blocked).toBe(false);
		});
	});

	describe("Edge cases", () => {
		it("should handle extra spaces", () => {
			const result = testCommand("pkill   -f   \"vite\"");
			expect(result.blocked).toBe(true);
		});

		it("should handle mixed quotes", () => {
			const result = testCommand('pkill -f "node dev"');
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("node dev");
		});

		it("should handle process name with path", () => {
			const result = testCommand('pkill -f "/usr/bin/node"');
			expect(result.blocked).toBe(true);
			expect(result.target).toBe("/usr/bin/node");
		});
	});
});
