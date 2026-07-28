import { describe, it, expect } from "vitest";
import {
	shannonEntropy,
	redactSecrets,
	redactSecretsInMessages,
} from "../secret-detector.ts";

describe("shannonEntropy", () => {
	it("returns 0 for empty input", () => {
		expect(shannonEntropy("")).toBe(0);
	});

	it("returns 0 for single repeated character", () => {
		expect(shannonEntropy("aaaa")).toBe(0);
	});

	it("returns ~2 for 'ababab'", () => {
		expect(shannonEntropy("ababab")).toBeCloseTo(1, 1);
	});

	it("returns high entropy for random base64", () => {
		expect(shannonEntropy("x9fK2pLm7QrT+Vsn8B/wYcA3ZbN0")).toBeGreaterThan(4.5);
	});

	it("returns lower entropy for English text", () => {
		expect(shannonEntropy("the quick brown fox jumps")).toBeLessThan(4.5);
	});
});

describe("redactSecrets — known patterns", () => {
	it("redacts AWS access key", () => {
		const r = redactSecrets("my key is AKIAIOSFODNN7EXAMPLE ok");
		expect(r.text).toBe("my key is [REDACTED:aws-access-key] ok");
		expect(r.count).toBe(1);
		expect(r.byLabel["aws-access-key"]).toBe(1);
	});

	it("redacts OpenAI key (sk- prefix)", () => {
		const r = redactSecrets("export OPENAI_API_KEY=sk-abc123def456ghi789jkl012mno345pqr678");
		expect(r.text).toContain("[REDACTED:openai-key]");
		expect(r.text).not.toContain("sk-abc123");
	});

	it("redacts Anthropic key (sk-ant- prefix)", () => {
		const r = redactSecrets("key: sk-ant-api03-1234567890abcdefghijklmnopqrstuvwxyz");
		expect(r.text).toContain("[REDACTED:anthropic-key]");
	});

	it("redacts GitHub PAT (ghp_ prefix)", () => {
		const r = redactSecrets("GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD");
		expect(r.text).toContain("[REDACTED:github-pat]");
	});

	it("redacts RSA private key block", () => {
		const input = `config:
-----BEGIN RSA PRIVATE KEY-----
MIIEpAIBAAKCAQEA1234567890abcdefghijklmnopqrstuvwxyz
-----END RSA PRIVATE KEY-----
done`;
		const r = redactSecrets(input);
		expect(r.text).toContain("[REDACTED:private-key]");
		expect(r.text).not.toContain("MIIEpAIB");
		expect(r.text).toContain("done");
	});

	it("redacts JWT", () => {
		const r = redactSecrets("token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
		expect(r.text).toContain("[REDACTED:jwt]");
	});

	it("redacts mongodb connection string with embedded password", () => {
		const r = redactSecrets("url: mongodb://user:s3cr3tP@ss@cluster0.example.mongodb.net/db");
		expect(r.text).toContain("[REDACTED:db-connection-string]");
		expect(r.text).not.toContain("s3cr3tP");
	});

	it("redacts Bearer authorization header", () => {
		const r = redactSecrets("Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c");
		expect(r.count).toBeGreaterThan(0);
		expect(r.text).not.toContain("Bearer eyJ");
	});

	it("redacts multiple different secrets in one pass", () => {
		const input = "aws=AKIAIOSFODNN7EXAMPLE github=ghp_abcdefghijklmnopqrstuvwxyz0123456789ABCD";
		const r = redactSecrets(input);
		expect(r.count).toBe(2);
		expect(r.byLabel["aws-access-key"]).toBe(1);
		expect(r.byLabel["github-pat"]).toBe(1);
	});
});

describe("redactSecrets — entropy-based", () => {
	it("redacts long high-entropy base64 string", () => {
		const secret = "x9fK2pLm7QrT+Vsn8B/wYcA3ZbN0hIuDeR1gS2tU7vWxYzAb";
		const r = redactSecrets(`password: ${secret}`);
		expect(r.text).toContain("[REDACTED:high-entropy]");
		expect(r.text).not.toContain(secret);
	});

	it("does NOT redact ordinary prose", () => {
		const r = redactSecrets("the quick brown fox jumps over the lazy dog");
		expect(r.count).toBe(0);
		expect(r.text).toBe("the quick brown fox jumps over the lazy dog");
	});

	it("does NOT redact short identifiers even if high entropy", () => {
		// 23 chars - below ENTROPY_MIN_LENGTH
		const r = redactSecrets("id=abcDEF1234567890123");
		expect(r.count).toBe(0);
	});

	it("does NOT redact [REDACTED:...] placeholders from phase 1", () => {
		const input = "key is sk-abc123def456ghi789jkl012mno345pqr678";
		const r = redactSecrets(input);
		// Phase 1 already replaced; phase 2 should not double-count
		expect(r.count).toBe(1);
	});
});

describe("redactSecrets — edge cases", () => {
	it("returns input unchanged when no secrets", () => {
		const r = redactSecrets("just ordinary text with no secrets");
		expect(r.text).toBe("just ordinary text with no secrets");
		expect(r.count).toBe(0);
		expect(r.byLabel).toEqual({});
	});

	it("handles empty string", () => {
		const r = redactSecrets("");
		expect(r.text).toBe("");
		expect(r.count).toBe(0);
	});

	it("replaces all occurrences of same secret", () => {
		const r = redactSecrets("AKIAIOSFODNN7EXAMPLE and again AKIAIOSFODNN7EXAMPLE");
		expect(r.count).toBe(2);
		expect(r.byLabel["aws-access-key"]).toBe(2);
	});
});

describe("redactSecretsInMessages", () => {
	it("returns messages unchanged when no secrets", () => {
		const messages = [{ role: "user", content: "hello world" }];
		const r = redactSecretsInMessages<{ role: string; content: unknown }>(messages);
		expect(r.redactionCount).toBe(0);
		expect(r.messages).toEqual(messages);
	});

	it("redacts text content blocks", () => {
		const messages = [
			{ role: "user", content: [{ type: "text", text: "key AKIAIOSFODNN7EXAMPLE" }] },
		];
		const r = redactSecretsInMessages<{ role: string; content: unknown }>(messages);
		expect(r.redactionCount).toBe(1);
		expect((r.messages[0]!.content as Array<{ text: string }>)[0]!.text).toContain("[REDACTED:aws-access-key]");
	});

	it("redacts thinking blocks", () => {
		const messages = [
			{ role: "assistant", content: [{ type: "thinking", thinking: "the key sk-abc123def456ghi789jkl012mno345pqr678" }] },
		];
		const r = redactSecretsInMessages<{ role: string; content: unknown }>(messages);
		expect(r.redactionCount).toBe(1);
	});

	it("redacts tool-call arguments", () => {
		const messages = [
			{
				role: "assistant",
				content: [
					{
						type: "toolCall",
						name: "write",
						arguments: { path: "config.txt", content: "aws_key=AKIAIOSFODNN7EXAMPLE" },
					},
				],
			},
		];
		const r = redactSecretsInMessages<{ role: string; content: unknown }>(messages);
		expect(r.redactionCount).toBe(1);
		const block = (r.messages[0]!.content as Array<{ arguments: { content: string } }>)[0]!;
		expect(block.arguments.content).toContain("[REDACTED:aws-access-key]");
	});

	it("redacts string content at top level", () => {
		const messages = [{ role: "user", content: "see AKIAIOSFODNN7EXAMPLE" }];
		const r = redactSecretsInMessages<{ role: string; content: unknown }>(messages);
		expect(r.redactionCount).toBe(1);
		expect(r.messages[0]!.content).toContain("[REDACTED:aws-access-key]");
	});

	it("does not mutate input array", () => {
		const original = [{ role: "user", content: "key AKIAIOSFODNN7EXAMPLE" }];
		const originalCopy = JSON.parse(JSON.stringify(original));
		redactSecretsInMessages<{ role: string; content: unknown }>(original);
		expect(original).toEqual(originalCopy);
	});
});
