/**
 * Classifier: Message Intent Classification
 *
 * Pattern-based intent classification without LLM calls.
 * Classifies messages into: bug, requirement, exploration, chitchat
 */

import {
	type ClassificationResult,
	type ClassifierConfig,
	DEFAULT_CLASSIFIER_CONFIG,
	IntentCategory,
} from "./types.js";

// ============================================================================
// Pattern definitions
// ============================================================================

interface IntentPatterns {
	keywords: RegExp[];
	weight: number;
}

const PATTERNS: Record<IntentCategory, IntentPatterns> = {
	[IntentCategory.BUG]: {
		keywords: [
			/\bfix\b/i,
			/\bbug\b/i,
			/\berror\b/i,
			/\bcrash(es|ed|ing)?\b/i,
			/\bbroken\b/i,
			/\bfail(s|ed|ure)?\b/i,
			/\bissue\b/i,
			/\bwrong\b/i,
			/\bnot work/i,
			/\bexception\b/i,
			/\bundefined\b.*\b(not|is)\b/i,
			/\bTypeError\b/i,
			/\bReferenceError\b/i,
			/\bSyntaxError\b/i,
			/\breproduc/i,
			/\bregression\b/i,
		],
		weight: 1.2,
	},
	[IntentCategory.REQUIREMENT]: {
		keywords: [
			/\badd\b/i,
			/\bimplement\b/i,
			/\bcreate\b/i,
			/\bbuild\b/i,
			/\bfeature\b/i,
			/\bsupport\b/i,
			/\bneed\b.*\b(to|for)\b/i,
			/\bwant\b.*\b(to|for)\b/i,
			/\bshould\b/i,
			/\bnew\b.*(component|api|endpoint|page|module|function)/i,
			/\benable\b/i,
			/\bintegrate\b/i,
		],
		weight: 1.0,
	},
	[IntentCategory.EXPLORATION]: {
		keywords: [
			/\bhow\b/i,
			/\bwhy\b/i,
			/\bwhat\b/i,
			/\bexplain\b/i,
			/\bunderstand\b/i,
			/\bshow (me )?\b/i,
			/\bwhere\b/i,
			/\bwhich\b/i,
			/\bdoes .+ work\b/i,
			/\bis there\b/i,
			/\bcan you tell\b/i,
			/\bdescribe\b/i,
			/\boverview\b/i,
		],
		weight: 1.0,
	},
	[IntentCategory.CHITCHAT]: {
		keywords: [
			/\bthanks\b/i,
			/\bthank you\b/i,
			/\bgood job\b/i,
			/\bnice\b/i,
			/\bgreat\b/i,
			/\bawesome\b/i,
			/\bhello\b/i,
			/\bhi\b/i,
			/\bhey\b/i,
			/\bye[s]\b/i,
			/\bbye\b/i,
			/\bcontinue\b/i,
			/\bgo ahead\b/i,
			/\bok(ay)?\b/i,
			/\bsure\b/i,
			/\byes\b/i,
			/\bno\b/,
		],
		weight: 0.8,
	},
};

// ============================================================================
// Scoring
// ============================================================================

function scoreIntent(text: string, category: IntentCategory): { score: number; matched: string[] } {
	const patterns = PATTERNS[category];
	const matched: string[] = [];
	let score = 0;

	for (const pattern of patterns.keywords) {
		if (pattern.test(text)) {
			score += patterns.weight;
			matched.push(pattern.source);
		}
	}

	return { score, matched };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Classify a single message's intent.
 */
export function classifyMessage(
	text: string,
	config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): ClassificationResult {
	if (!config.enabled) {
		return {
			intent: IntentCategory.CHITCHAT,
			confidence: 0,
			reason: "classifier disabled",
		};
	}

	const trimmed = text.trim();
	if (!trimmed) {
		return {
			intent: IntentCategory.CHITCHAT,
			confidence: 0,
			reason: "empty input",
		};
	}

	const scores: Array<{ intent: IntentCategory; score: number; reason: string }> = [];

	for (const category of Object.values(IntentCategory)) {
		const { score, matched } = scoreIntent(trimmed, category);
		if (score > 0) {
			scores.push({
				intent: category,
				score,
				reason: `matched patterns: ${matched.slice(0, 3).join(", ")}`,
			});
		}
	}

	if (scores.length === 0) {
		return {
			intent: IntentCategory.CHITCHAT,
			confidence: 0.3,
			reason: "no patterns matched, default to chitchat",
		};
	}

	scores.sort((a, b) => b.score - a.score);
	const best = scores[0];
	const totalScore = scores.reduce((sum, s) => sum + s.score, 0);
	const confidence = totalScore > 0 ? best.score / totalScore : 0;

	return {
		intent: best.intent,
		confidence: Math.min(confidence, 1),
		reason: best.reason,
	};
}

/**
 * Classify conversation intent from multiple messages.
 * Recent messages are weighted more heavily.
 */
export function classifyConversation(
	messages: Array<{ role: string; text: string }>,
	config: ClassifierConfig = DEFAULT_CLASSIFIER_CONFIG,
): ClassificationResult {
	if (!config.enabled || messages.length === 0) {
		return {
			intent: IntentCategory.CHITCHAT,
			confidence: 0,
			reason: config.enabled ? "empty conversation" : "classifier disabled",
		};
	}

	const userMessages = messages.filter((m) => m.role === "user" && m.text?.trim());
	if (userMessages.length === 0) {
		return classifyMessage("", config);
	}

	// Weight recent messages more (last message gets weight 1.0, earlier get less)
	const weightedScores: Record<IntentCategory, number> = {
		[IntentCategory.BUG]: 0,
		[IntentCategory.REQUIREMENT]: 0,
		[IntentCategory.EXPLORATION]: 0,
		[IntentCategory.CHITCHAT]: 0,
	};

	for (let i = 0; i < userMessages.length; i++) {
		const weight = (i + 1) / userMessages.length;
		const result = classifyMessage(userMessages[i].text, config);
		weightedScores[result.intent] += result.confidence * weight;
	}

	const sorted = Object.entries(weightedScores).sort((a, b) => b[1] - a[1]);
	const [bestIntent, bestScore] = sorted[0];
	const totalWeighted = sorted.reduce((sum, [, s]) => sum + s, 0);

	return {
		intent: bestIntent as IntentCategory,
		confidence: totalWeighted > 0 ? Math.min(bestScore / totalWeighted, 1) : 0,
		reason: `conversation classification (${userMessages.length} user messages analyzed)`,
	};
}
