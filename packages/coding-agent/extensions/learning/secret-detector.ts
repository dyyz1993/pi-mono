/**
 * Secret detection and redaction.
 *
 * Two complementary strategies:
 * 1. High-signal regex patterns — known formats (API keys, private keys,
 *    JWTs, connection strings). Zero false-positive risk because we match
 *    the well-known prefixes/structures.
 * 2. Shannon entropy — catches unknown formats (base64/hex-encoded secrets
 *    with no recognizable prefix). Threshold tuned to flag long high-entropy
 *    runs while avoiding short technical identifiers.
 *
 * Replacements use the form `[REDACTED:type]` to preserve type information
 * for downstream LLM processing while removing the actual secret value.
 */

/** A redaction pattern: regex + a short label identifying what was removed. */
interface SecretPattern {
	/** Regex matching the secret. Should capture the full secret in group 0. */
	pattern: RegExp;
	/** Short label used in the `[REDACTED:label]` placeholder. */
	label: string;
}

/**
 * Known-format secret patterns. Ordered roughly by frequency in real code.
 * Each pattern is anchored to a specific prefix or structure to avoid
 * false positives on ordinary prose.
 */
const SECRET_PATTERNS: readonly SecretPattern[] = [
	{ pattern: /\bAKIA[0-9A-Z]{16}\b/g, label: "aws-access-key" },
	{ pattern: /\bsk-ant-[a-zA-Z0-9-_]{20,}\b/g, label: "anthropic-key" },
	{ pattern: /\bsk-or-[a-zA-Z0-9-_]{20,}\b/g, label: "openrouter-key" },
	{ pattern: /\bsk-[a-zA-Z0-9]{20,}\b/g, label: "openai-key" },
	{ pattern: /\bdeepseek-[a-zA-Z0-9]{20,}\b/g, label: "deepseek-key" },
	{ pattern: /\bghp_[a-zA-Z0-9]{36,}\b/g, label: "github-pat" },
	{ pattern: /\bgho_[a-zA-Z0-9]{36,}\b/g, label: "github-oauth" },
	{ pattern: /\bghs_[a-zA-Z0-9]{36,}\b/g, label: "github-app" },
	{ pattern: /\bghr_[a-zA-Z0-9]{36,}\b/g, label: "github-refresh" },
	{ pattern: /\bglpat-[a-zA-Z0-9_-]{20,}\b/g, label: "gitlab-pat" },
	{
		pattern: /-----BEGIN (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |PGP |DSA )?PRIVATE KEY-----/g,
		label: "private-key",
	},
	{ pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/g, label: "jwt" },
	{ pattern: /(?:Bearer|Authorization|X-Api-Key)\s*[:=]\s*["']?[a-zA-Z0-9_\-./+=]{20,}["']?/gi, label: "auth-header" },
	{ pattern: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|redis|amqp|mysql|mssql):\/\/[^\s:/@]+:[^\s/@]+@[^\s]+/g, label: "db-connection-string" },
] as const;

const ENTROPY_THRESHOLD = 4.5;
const ENTROPY_MIN_LENGTH = 24;
const HIGH_ENTROPY_TOKEN_PATTERN = /\b[a-zA-Z0-9+/=_-]{24,}\b/g;

/** Compute Shannon entropy (base-2) of a string. Higher = more random. */
export function shannonEntropy(input: string): number {
	if (input.length === 0) return 0;
	const frequencies = new Map<string, number>();
	for (const char of input) {
		frequencies.set(char, (frequencies.get(char) ?? 0) + 1);
	}
	let entropy = 0;
	const total = input.length;
	for (const count of frequencies.values()) {
		const p = count / total;
		entropy -= p * Math.log2(p);
	}
	return entropy;
}

/** Result of a redaction operation. */
export interface RedactionResult {
	text: string;
	count: number;
	byLabel: Record<string, number>;
}

/**
 * Redact all detected secrets from a string. Replaces each secret with
 * `[REDACTED:label]` and returns metadata about what was removed. Safe to
 * call on any text; returns input unchanged (count=0) if no secrets found.
 */
export function redactSecrets(input: string): RedactionResult {
	let text = input;
	let count = 0;
	const byLabel: Record<string, number> = {};

	for (const { pattern, label } of SECRET_PATTERNS) {
		const regex = new RegExp(pattern.source, pattern.flags);
		const matches = text.match(regex);
		if (matches && matches.length > 0) {
			text = text.replace(regex, `[REDACTED:${label}]`);
			byLabel[label] = (byLabel[label] ?? 0) + matches.length;
			count += matches.length;
		}
	}

	text = text.replace(HIGH_ENTROPY_TOKEN_PATTERN, (token) => {
		if (token.startsWith("[REDACTED:") && token.endsWith("]")) return token;
		const entropy = shannonEntropy(token);
		if (entropy >= ENTROPY_THRESHOLD) {
			count += 1;
			byLabel["high-entropy"] = (byLabel["high-entropy"] ?? 0) + 1;
			return `[REDACTED:high-entropy]`;
		}
		return token;
	});

	return { text, count, byLabel };
}

/**
 * Redact secrets in an AgentMessage[]-like structure. Walks each message's
 * content blocks and redacts text-bearing parts (text, thinking, serialized
 * tool-call arguments, tool-result content). Returns a new array; does not
 * mutate input.
 */
export function redactSecretsInMessages<T extends { role: unknown }>(
	messages: readonly T[],
): { messages: T[]; redactionCount: number } {
	let totalRedactions = 0;
	const out = messages.map((msg) => {
		const content = (msg as { content?: unknown }).content;
		if (!Array.isArray(content)) {
			if (typeof content === "string") {
				const r = redactSecrets(content);
				totalRedactions += r.count;
				return { ...msg, content: r.text };
			}
			return msg;
		}
		const newContent = content.map((block: unknown) => {
			if (!block || typeof block !== "object") return block;
			const b = block as Record<string, unknown>;
			if (typeof b.text === "string") {
				const r = redactSecrets(b.text);
				totalRedactions += r.count;
				return { ...b, text: r.text };
			}
			if (typeof b.thinking === "string") {
				const r = redactSecrets(b.thinking);
				totalRedactions += r.count;
				return { ...b, thinking: r.text };
			}
			if (b.arguments && typeof b.arguments === "object") {
				try {
					const serialized = JSON.stringify(b.arguments);
					const r = redactSecrets(serialized);
					totalRedactions += r.count;
					if (r.count > 0) {
						return { ...b, arguments: JSON.parse(r.text) };
					}
				} catch {
					// Not serializable, skip
				}
			}
			return block;
		});
		return { ...msg, content: newContent };
	});
	return { messages: out as T[], redactionCount: totalRedactions };
}
