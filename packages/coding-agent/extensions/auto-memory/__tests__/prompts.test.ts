import { describe, it, expect } from "vitest";
import { SELECT_MEMORIES_PROMPT } from "../prompts.js";

describe("SELECT_MEMORIES_PROMPT", () => {
	it('contains "userMarkedIrrelevant" section', () => {
		expect(SELECT_MEMORIES_PROMPT).toContain("userMarkedIrrelevant");
	});

	it('contains "用户反馈净化" section', () => {
		expect(SELECT_MEMORIES_PROMPT).toContain("用户反馈净化");
	});

	it("mentions minimum 2 marks needed for rules", () => {
		expect(SELECT_MEMORIES_PROMPT).toMatch(/至少.*2.*不相关标记/);
	});

	it('still contains "文件选择" section', () => {
		expect(SELECT_MEMORIES_PROMPT).toContain("文件选择");
	});

	it('still contains "关键词净化" section', () => {
		expect(SELECT_MEMORIES_PROMPT).toContain("关键词净化");
	});

	it("has correct task numbering", () => {
		expect(SELECT_MEMORIES_PROMPT).toContain("## 任务 1：");
		expect(SELECT_MEMORIES_PROMPT).toContain("## 任务 2：");
	});
});
