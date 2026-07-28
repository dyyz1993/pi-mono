/**
 * Tokenizer module: provider-specific content token estimation.
 *
 * OpenAI/GPT models use `gpt-tokenizer` for accurate token counting.
 * DeepSeek uses a calibrated factor (0.29 tokens/char) since no official JS
 * tokenizer is available. Factor measured from DeepSeek API responses
 * showing ~3.45 chars/token for Chinese + code mixed content.
 *
 * Fallback (Anthropic, unknown): chars/4 (0.25 tokens/char, suitable for English).
 */
import { encode } from "gpt-tokenizer";

export type TokenizerProvider = "openai" | "deepseek" | "fallback";

/**
 * Determine the tokenizer provider from a model object.
 */
export function identifyProvider(model?: { provider?: string; id?: string } | null): TokenizerProvider {
	const provider = model?.provider ?? "";
	const modelId = model?.id ?? "";
	if (provider.includes("openai") || modelId.includes("openai") || modelId.includes("o1") || modelId.includes("o3")) {
		return "openai";
	}
	if (provider.includes("deepseek") || modelId.includes("deepseek")) {
		return "deepseek";
	}
	return "fallback";
}

/**
 * The content token-to-char ratio for each provider.
 * Used for quick estimation from char counts (e.g. per-category breakdown).
 *
 *   fallback: 0.25 (4.0 chars/token, English)
 *   deepseek: 0.29 (3.45 chars/token, Chinese + code mix)
 *   openai   : 0.286 (3.5 chars/token, GPT models)
 */
const CONTENT_TOKEN_FACTOR: Record<TokenizerProvider, number> = {
	fallback: 0.25,
	deepseek: 0.29,
	openai: 0.286,
};

/**
 * Estimate tokens from character count using provider-specific factor.
 * Used for breakdown categories where we have char counts, not full text.
 */
export function estimateContentTokensFromChars(chars: number, provider: TokenizerProvider): number {
	if (!chars) return 0;
	return Math.ceil(chars * CONTENT_TOKEN_FACTOR[provider]);
}

/**
 * Estimate tokens from actual text string.
 * - OpenAI: uses `gpt-tokenizer` for accurate counting
 * - Others: uses calibrated factor
 */
export function estimateContentTokens(text: string, provider: TokenizerProvider): number {
	if (!text) return 0;

	switch (provider) {
		case "openai": {
			return encode(text).length;
		}
		case "deepseek": {
			return Math.ceil(text.length * 0.29);
		}
		case "fallback":
		default: {
			return Math.ceil(text.length / 4);
		}
	}
}

/**
 * Estimate tokens from content characters using chars/4 heuristic.
 * Used for structure overhead and system/tool definitions estimation
 * where provider matches the standard chars/4.
 */
export function estimateCharsAsTokens(chars: number): number {
	return Math.ceil(Math.max(chars, 0) / 4);
}
