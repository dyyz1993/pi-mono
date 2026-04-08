/**
 * Classifier: Message Intent Classification - TDD Tests
 *
 * Pattern-based intent classification without LLM calls.
 * Classifies messages into: bug, requirement, exploration, chitchat
 */

import { describe, expect, it } from "vitest";
import { type ClassifierConfig, IntentCategory } from "../../src/core/context-compression/types.js";

let classifyMessage: (
	text: string,
	config?: ClassifierConfig,
) => { intent: IntentCategory; confidence: number; reason: string };
let classifyConversation: (
	messages: Array<{ role: string; text: string }>,
	config?: ClassifierConfig,
) => { intent: IntentCategory; confidence: number; reason: string };

try {
	const mod = await import("../../src/core/context-compression/classifier.js");
	classifyMessage = mod.classifyMessage;
	classifyConversation = mod.classifyConversation;
} catch {
	classifyMessage = () => {
		throw new Error("classifier.ts not implemented yet");
	};
	classifyConversation = () => {
		throw new Error("classifier.ts not implemented yet");
	};
}

describe("Classifier: Message Intent Classification", () => {
	describe("classifyMessage - single message", () => {
		it("should detect bug-related messages", () => {
			const result = classifyMessage("fix the crash in login page");
			expect(result.intent).toBe(IntentCategory.BUG);
			expect(result.confidence).toBeGreaterThan(0.5);
		});

		it("should detect bug with error keywords", () => {
			const result = classifyMessage("TypeError: cannot read property of undefined");
			expect(result.intent).toBe(IntentCategory.BUG);
		});

		it("should detect requirement/feature messages", () => {
			const result = classifyMessage("add dark mode support to settings");
			expect(result.intent).toBe(IntentCategory.REQUIREMENT);
			expect(result.confidence).toBeGreaterThan(0.5);
		});

		it("should detect exploration/research messages", () => {
			const result = classifyMessage("how does the auth middleware work?");
			expect(result.intent).toBe(IntentCategory.EXPLORATION);
		});

		it("should detect chitchat/casual messages", () => {
			const result = classifyMessage("thanks for your help!");
			expect(result.intent).toBe(IntentCategory.CHITCHAT);
		});

		it("should handle empty input gracefully", () => {
			const result = classifyMessage("");
			expect(result.intent).toBeDefined();
			expect(typeof result.confidence).toBe("number");
		});

		it("should return confidence between 0 and 1", () => {
			const result = classifyMessage("some random message about code");
			expect(result.confidence).toBeGreaterThanOrEqual(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});

		it("should provide a reason for classification", () => {
			const result = classifyMessage("implement user authentication");
			expect(result.reason).toBeDefined();
			expect(result.reason.length).toBeGreaterThan(0);
		});

		it("should detect bug patterns: broken, fix, error, crash", () => {
			const bugPatterns = [
				"it's broken again",
				"fix this issue",
				"error on line 42",
				"the app crashes when I click submit",
				"bug report: logout doesn't work",
			];
			for (const pattern of bugPatterns) {
				const result = classifyMessage(pattern);
				expect(result.intent).toBe(IntentCategory.BUG, `Failed for: ${pattern}`);
			}
		});

		it("should detect requirement patterns: add, implement, create, feature", () => {
			const reqPatterns = [
				"implement a new API endpoint",
				"create a user profile component",
				"add pagination to the list",
				"we need a new feature for exporting data",
				"build a notification system",
			];
			for (const pattern of reqPatterns) {
				const result = classifyMessage(pattern);
				expect(result.intent).toBe(IntentCategory.REQUIREMENT, `Failed for: ${pattern}`);
			}
		});

		it("should detect exploration patterns: how, why, explain, understand", () => {
			const expPatterns = [
				"how does the database connection work?",
				"why is this variable undefined?",
				"explain the architecture",
				"what does this function do?",
				"show me the code flow for authentication",
			];
			for (const pattern of expPatterns) {
				const result = classifyMessage(pattern);
				expect(result.intent).toBe(IntentCategory.EXPLORATION, `Failed for: ${pattern}`);
			}
		});
	});

	describe("classifyConversation - multi-message context", () => {
		it("should classify conversation based on recent messages", () => {
			const messages = [
				{ role: "user", text: "fix the login bug" },
				{ role: "assistant", text: "I'll look into it" },
				{ role: "user", text: "it crashes on line 45" },
			];
			const result = classifyConversation(messages);
			expect(result.intent).toBe(IntentCategory.BUG);
		});

		it("should weight recent messages more heavily", () => {
			const messages = [
				{ role: "user", text: "thanks!" },
				{ role: "user", text: "implement OAuth2 support now" },
			];
			const result = classifyConversation(messages);
			expect(result.intent).toBe(IntentCategory.REQUIREMENT);
		});

		it("should handle empty conversation", () => {
			const result = classifyConversation([]);
			expect(result.intent).toBeDefined();
		});

		it("should handle single-message conversation", () => {
			const result = classifyConversation([{ role: "user", text: "how does this work?" }]);
			expect(result.intent).toBe(IntentCategory.EXPLORATION);
		});
	});

	describe("config handling", () => {
		it("should respect enabled=false by returning chitchat default", () => {
			const result = classifyMessage("fix this critical bug", { enabled: false });
			expect(result.intent).toBe(IntentCategory.CHITCHAT);
		});
	});
});
