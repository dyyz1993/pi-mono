import type { CheckResult, GuardCheckResult, GuardConfig } from "./types.ts";

export const DEFAULT_CONTINUE_CONFIDENCE_THRESHOLD = 0.6;

interface GuardContinueDecision {
    shouldContinue: boolean;
    incompleteResults: GuardCheckResult[];
}

export function shouldAutoContinueFromGuards(
    results: GuardCheckResult[],
    minConfidence = DEFAULT_CONTINUE_CONFIDENCE_THRESHOLD,
): GuardContinueDecision {
    const incompleteResults = results.filter(
        (result) =>
            !result.completed &&
            result.remainingItems.length > 0 &&
            result.confidence >= minConfidence,
    );

    return {
        shouldContinue: incompleteResults.length > 0,
        incompleteResults,
    };
}

export function shouldAutoContinueFromModelCheck(
    modelCheck: CheckResult,
    minConfidence = DEFAULT_CONTINUE_CONFIDENCE_THRESHOLD,
): boolean {
    const hasIncomplete =
        modelCheck.completed === false || modelCheck.incompleteTasks.length > 0;
    return hasIncomplete && modelCheck.confidence >= minConfidence;
}

export function getDecisionConfidence(results: GuardCheckResult[]): number {
    const incompleteConfidences = results
        .filter((result) => !result.completed && result.remainingItems.length > 0)
        .map((result) => result.confidence);
    if (incompleteConfidences.length === 0) return 1;
    return Math.min(...incompleteConfidences);
}

export function buildIncompleteSignature(results: GuardCheckResult[]): string {
    return results
        .filter((result) => !result.completed && result.remainingItems.length > 0)
        .map((result) => {
            const items = result.remainingItems
                .map(normalizeSignatureItem)
                .filter(Boolean)
                .sort()
                .join(",");
            return `${normalizeGuardName(result.guardName)}:${items}`;
        })
        .sort()
        .join("|");
}

export function isIncompleteSignatureSimilar(
    currentSignature: string,
    previousSignature: string,
): boolean {
    if (!currentSignature || !previousSignature) return false;
    if (currentSignature === previousSignature) return true;

    const currentTokens = tokenizeSignature(currentSignature);
    const previousTokens = tokenizeSignature(previousSignature);
    if (currentTokens.size === 0 || previousTokens.size === 0) return false;

    let intersection = 0;
    for (const token of currentTokens) {
        if (previousTokens.has(token)) intersection++;
    }
    const union = new Set([...currentTokens, ...previousTokens]).size;
    return intersection / union >= 0.82;
}

export function checkKeywordGuardAgainstCode(
    guard: Extract<GuardConfig, { type: "keyword" }>,
    context: string,
): GuardCheckResult {
    const codeContext = extractFencedCodeBlocks(context).join("\n");
    const found =
        codeContext.length === 0
            ? []
            : guard.keywords.filter((kw) =>
                  codeContext.toLowerCase().includes(kw.toLowerCase()),
              );

    return {
        guardName: guard.name,
        completed: found.length === 0,
        confidence: found.length === 0 ? 1 : 0.7,
        remainingItems:
            found.length > 0 ? [`Keywords found in code blocks: ${found.join(", ")}`] : [],
        detail: found.length > 0 ? `Found in code blocks: ${found.join(", ")}` : "No incomplete keywords in code blocks",
    };
}

function normalizeGuardName(value: string): string {
    return value.toLowerCase().replace(/\s+/g, "-").trim();
}

function normalizeSignatureItem(value: string): string {
    return Array.from(tokenizeSignature(value)).sort().join(" ");
}

function tokenizeSignature(value: string): Set<string> {
    const normalized = value
        .toLowerCase()
        .normalize("NFKC")
        .replace(/[`"'“”‘’.,;:!?()[\]{}<>|/\\_-]+/g, " ");
    const tokens = normalized.match(/[\p{Script=Han}]|[a-z0-9]+/gu) ?? [];
    return new Set(tokens.filter((token) => !STOP_WORDS.has(token)));
}

function extractFencedCodeBlocks(value: string): string[] {
    const blocks: string[] = [];
    const fencePattern = /```[^\n`]*\n([\s\S]*?)```/g;
    let match: RegExpExecArray | null;
    while ((match = fencePattern.exec(value)) !== null) {
        blocks.push(match[1] ?? "");
    }
    return blocks;
}

const STOP_WORDS = new Set([
    "a",
    "an",
    "and",
    "be",
    "is",
    "of",
    "the",
    "then",
    "to",
]);
