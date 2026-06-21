import { describe, expect, it } from "vitest";
import { interpretHookOutput } from "../extensions/pi-hooks/handler-runner.ts";

describe("pi-hooks hook output interpretation", () => {
	it("uses stderr as the block reason for exit code 2 (Claude Code compat)", () => {
		// Claude Code source: hooks.ts:2648-2668 — exit 2 uses stderr, stdout is ignored
		const result = interpretHookOutput({
			exitCode: 2,
			stdout: "this stdout should be ignored",
			stderr: "危险命令已被 hook 拒绝",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("危险命令已被 hook 拒绝");
	});

	it("uses parsed JSON reason even for exit code 2 (structured output takes priority)", () => {
		// When stdout contains valid JSON with reason field, it's used as structured output
		const result = interpretHookOutput({
			exitCode: 2,
			stdout: '{"reason":"禁止跨项目写入"}',
			stderr: "fallback stderr",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("禁止跨项目写入");
	});

	it("falls back to stderr when no parsed JSON is available for exit code 2", () => {
		const result = interpretHookOutput({
			exitCode: 2,
			stdout: "plain text stdout",
			stderr: "stderr message",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("stderr message");
	});

	it("uses parsed JSON question for exit code 3 approvals", () => {
		const result = interpretHookOutput({
			exitCode: 3,
			stdout: '{"question":"是否允许执行 npm run build？"}',
			stderr: "",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("是否允许执行 npm run build？");
	});

	it("uses parsed JSON message for exit code 3 approvals", () => {
		const result = interpretHookOutput({
			exitCode: 3,
			stdout: '{"message":"配置热更新第二次验证","allowText":"允许一次","denyText":"取消"}',
			stderr: "",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("配置热更新第二次验证");
	});
});
