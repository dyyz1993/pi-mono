import { describe, expect, it } from "vitest";
import type { GuardCheckResult, GuardConfig, CheckResult } from "./types.ts";
import {
    buildIncompleteSignature,
    checkKeywordGuardAgainstCode,
    isIncompleteSignatureSimilar,
    shouldAutoContinueFromGuards,
    shouldAutoContinueFromModelCheck,
} from "./decision.ts";

describe("session-supervisor decision helpers", () => {
    it("does not auto-continue from low-confidence incomplete guard results", () => {
        const guardResults: GuardCheckResult[] = [
            {
                guardName: "custom",
                completed: false,
                confidence: 0.4,
                remainingItems: ["maybe one thing is left"],
            },
        ];

        expect(shouldAutoContinueFromGuards(guardResults, 0.6)).toEqual({
            shouldContinue: false,
            incompleteResults: [],
        });
    });

    it("does auto-continue from high-confidence incomplete guard results", () => {
        const guardResults: GuardCheckResult[] = [
            {
                guardName: "custom",
                completed: false,
                confidence: 0.8,
                remainingItems: ["write the missing test"],
            },
        ];

        expect(shouldAutoContinueFromGuards(guardResults, 0.6)).toEqual({
            shouldContinue: true,
            incompleteResults: guardResults,
        });
    });

    it("treats reordered or lightly reworded incomplete signatures as similar", () => {
        const first = buildIncompleteSignature([
            {
                guardName: "spec",
                completed: false,
                confidence: 0.9,
                remainingItems: ["Create tmp file, then verify content"],
            },
        ]);
        const second = buildIncompleteSignature([
            {
                guardName: "spec",
                completed: false,
                confidence: 0.9,
                remainingItems: ["verify content then create the tmp file"],
            },
        ]);

        expect(isIncompleteSignatureSimilar(second, first)).toBe(true);
    });

    it("ignores natural-language TODO mentions for keyword guards", () => {
        const guard: Extract<GuardConfig, { type: "keyword" }> = {
            name: "keywords",
            type: "keyword",
            enable: true,
            keywords: ["TODO", "FIXME"],
        };

        const result = checkKeywordGuardAgainstCode(
            guard,
            "I noticed there is probably a TODO we may want to handle later.",
        );

        expect(result.completed).toBe(true);
        expect(result.remainingItems).toEqual([]);
    });

    it("still catches TODO markers inside fenced code blocks", () => {
        const guard: Extract<GuardConfig, { type: "keyword" }> = {
            name: "keywords",
            type: "keyword",
            enable: true,
            keywords: ["TODO", "FIXME"],
        };

        const result = checkKeywordGuardAgainstCode(
            guard,
            "Here is the current file:\n```ts\n// TODO: wire supervisor threshold\nexport const x = 1;\n```",
        );

        expect(result.completed).toBe(false);
        expect(result.confidence).toBeGreaterThanOrEqual(0.6);
        expect(result.remainingItems).toEqual(["Keywords found in code blocks: TODO"]);
    });

    it("does not auto-continue from low-confidence model incomplete checks", () => {
        const modelCheck: CheckResult = {
            completed: false,
            confidence: 0.5,
            incompleteTasks: [{ description: "possibly incomplete", severity: "low" }],
            modelResponse: "maybe incomplete",
        };

        expect(shouldAutoContinueFromModelCheck(modelCheck, 0.6)).toBe(false);
    });
});
