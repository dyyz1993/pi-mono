import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getEnvApiKey } from "../src/env-api-keys.js";

describe("getEnvApiKey", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = { ...originalEnv };
	});

	describe("envMap providers", () => {
		it("resolves openai from OPENAI_API_KEY", () => {
			process.env.OPENAI_API_KEY = "sk-test-openai";
			expect(getEnvApiKey("openai")).toBe("sk-test-openai");
		});

		it("resolves google from GEMINI_API_KEY", () => {
			process.env.GEMINI_API_KEY = "gemini-test-key";
			expect(getEnvApiKey("google")).toBe("gemini-test-key");
		});

		it("resolves groq from GROQ_API_KEY", () => {
			process.env.GROQ_API_KEY = "groq-test-key";
			expect(getEnvApiKey("groq")).toBe("groq-test-key");
		});

		it("resolves openrouter from OPENROUTER_API_KEY", () => {
			process.env.OPENROUTER_API_KEY = "or-test-key";
			expect(getEnvApiKey("openrouter")).toBe("or-test-key");
		});

		it("resolves huggingface from HF_TOKEN", () => {
			process.env.HF_TOKEN = "hf-test-token";
			expect(getEnvApiKey("huggingface")).toBe("hf-test-token");
		});

		it("resolves azure-openai-responses from AZURE_OPENAI_API_KEY", () => {
			process.env.AZURE_OPENAI_API_KEY = "azure-test-key";
			expect(getEnvApiKey("azure-openai-responses")).toBe("azure-test-key");
		});

		it("resolves xai from XAI_API_KEY", () => {
			process.env.XAI_API_KEY = "xai-test-key";
			expect(getEnvApiKey("xai")).toBe("xai-test-key");
		});

		it("resolves opencode and opencode-go from same OPENCODE_API_KEY", () => {
			process.env.OPENCODE_API_KEY = "oc-test-key";
			expect(getEnvApiKey("opencode")).toBe("oc-test-key");
			expect(getEnvApiKey("opencode-go")).toBe("oc-test-key");
		});
	});

	describe("anthropic", () => {
		it("prefers ANTHROPIC_OAUTH_TOKEN over ANTHROPIC_API_KEY", () => {
			process.env.ANTHROPIC_OAUTH_TOKEN = "oauth-token";
			process.env.ANTHROPIC_API_KEY = "api-key";
			expect(getEnvApiKey("anthropic")).toBe("oauth-token");
		});

		it("falls back to ANTHROPIC_API_KEY when OAUTH_TOKEN absent", () => {
			delete process.env.ANTHROPIC_OAUTH_TOKEN;
			process.env.ANTHROPIC_API_KEY = "api-key";
			expect(getEnvApiKey("anthropic")).toBe("api-key");
		});

		it("returns undefined when neither token is set", () => {
			delete process.env.ANTHROPIC_OAUTH_TOKEN;
			delete process.env.ANTHROPIC_API_KEY;
			expect(getEnvApiKey("anthropic")).toBeUndefined();
		});
	});

	describe("github-copilot", () => {
		it("prefers COPILOT_GITHUB_TOKEN", () => {
			process.env.COPILOT_GITHUB_TOKEN = "copilot-token";
			process.env.GH_TOKEN = "gh-token";
			process.env.GITHUB_TOKEN = "github-token";
			expect(getEnvApiKey("github-copilot")).toBe("copilot-token");
		});

		it("falls back to GH_TOKEN", () => {
			delete process.env.COPILOT_GITHUB_TOKEN;
			process.env.GH_TOKEN = "gh-token";
			process.env.GITHUB_TOKEN = "github-token";
			expect(getEnvApiKey("github-copilot")).toBe("gh-token");
		});

		it("falls back to GITHUB_TOKEN", () => {
			delete process.env.COPILOT_GITHUB_TOKEN;
			delete process.env.GH_TOKEN;
			process.env.GITHUB_TOKEN = "github-token";
			expect(getEnvApiKey("github-copilot")).toBe("github-token");
		});

		it("returns undefined when no token set", () => {
			delete process.env.COPILOT_GITHUB_TOKEN;
			delete process.env.GH_TOKEN;
			delete process.env.GITHUB_TOKEN;
			expect(getEnvApiKey("github-copilot")).toBeUndefined();
		});
	});

	describe("amazon-bedrock", () => {
		afterEach(() => {
			delete process.env.AWS_PROFILE;
			delete process.env.AWS_ACCESS_KEY_ID;
			delete process.env.AWS_SECRET_ACCESS_KEY;
			delete process.env.AWS_BEARER_TOKEN_BEDROCK;
			delete process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI;
			delete process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI;
			delete process.env.AWS_WEB_IDENTITY_TOKEN_FILE;
		});

		it("returns authenticated via AWS_PROFILE", () => {
			process.env.AWS_PROFILE = "test-profile";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("returns authenticated via AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY", () => {
			process.env.AWS_ACCESS_KEY_ID = "AKID";
			process.env.AWS_SECRET_ACCESS_KEY = "SECRET";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("returns authenticated via AWS_BEARER_TOKEN_BEDROCK", () => {
			process.env.AWS_BEARER_TOKEN_BEDROCK = "bearer-token";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("returns authenticated via AWS_CONTAINER_CREDENTIALS_RELATIVE_URI", () => {
			process.env.AWS_CONTAINER_CREDENTIALS_RELATIVE_URI = "/creds";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("returns authenticated via AWS_CONTAINER_CREDENTIALS_FULL_URI", () => {
			process.env.AWS_CONTAINER_CREDENTIALS_FULL_URI = "http://169.254.170.23/creds";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("returns authenticated via AWS_WEB_IDENTITY_TOKEN_FILE", () => {
			process.env.AWS_WEB_IDENTITY_TOKEN_FILE = "/var/run/secrets/token";
			expect(getEnvApiKey("amazon-bedrock")).toBe("<authenticated>");
		});

		it("requires both ACCESS_KEY_ID and SECRET_ACCESS_KEY", () => {
			process.env.AWS_ACCESS_KEY_ID = "AKID";
			delete process.env.AWS_SECRET_ACCESS_KEY;
			expect(getEnvApiKey("amazon-bedrock")).toBeUndefined();
		});

		it("returns undefined when no credentials configured", () => {
			expect(getEnvApiKey("amazon-bedrock")).toBeUndefined();
		});
	});

	describe("google-vertex", () => {
		afterEach(() => {
			delete process.env.GOOGLE_CLOUD_API_KEY;
			delete process.env.GOOGLE_CLOUD_PROJECT;
			delete process.env.GCLOUD_PROJECT;
			delete process.env.GOOGLE_CLOUD_LOCATION;
		});

		it("returns GOOGLE_CLOUD_API_KEY when set", () => {
			process.env.GOOGLE_CLOUD_API_KEY = "gcp-key";
			expect(getEnvApiKey("google-vertex")).toBe("gcp-key");
		});

		it("returns undefined when no credentials or incomplete ADC config", () => {
			expect(getEnvApiKey("google-vertex")).toBeUndefined();
		});
	});

	describe("unknown provider", () => {
		it("returns undefined for unmapped provider", () => {
			expect(getEnvApiKey("nonexistent-provider")).toBeUndefined();
		});

		it("returns undefined for empty string provider", () => {
			expect(getEnvApiKey("")).toBeUndefined();
		});
	});

	describe("returns undefined when env var not set", () => {
		it("returns undefined for openai without env var", () => {
			delete process.env.OPENAI_API_KEY;
			expect(getEnvApiKey("openai")).toBeUndefined();
		});
	});
});
