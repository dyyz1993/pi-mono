import { describe, expect, it } from "vitest";
import { interpretHookOutput } from "../extensions/claude-hooks-compat/handler-runner.ts";

describe("claude-hooks-compat hook output interpretation", () => {
	it("uses stdout echo as the block reason for exit code 2", () => {
		const result = interpretHookOutput({
			exitCode: 2,
			stdout: "危险命令已被 hook 拒绝",
			stderr: "",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("危险命令已被 hook 拒绝");
	});

	it("uses parsed JSON reason before raw stdout for exit code 2", () => {
		const result = interpretHookOutput({
			exitCode: 2,
			stdout: '{"reason":"禁止跨项目写入"}',
			stderr: "",
		});

		expect(result.shouldBlock).toBe(true);
		expect(result.reason).toBe("禁止跨项目写入");
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
});
