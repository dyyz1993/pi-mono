import { describe, expect, it, vi } from "vitest";
import type {
	AgentSessionRuntimeDiagnostic,
	AgentSessionServices,
	CreateAgentSessionServicesOptions,
} from "../../src/core/agent-session-services.js";
import type { PathMetadata } from "../../src/core/package-manager.js";

describe("AgentSessionRuntimeDiagnostic", () => {
	it("should accept info type", () => {
		const diag: AgentSessionRuntimeDiagnostic = { type: "info", message: "info msg" };
		expect(diag.type).toBe("info");
		expect(diag.message).toBe("info msg");
	});

	it("should accept warning type", () => {
		const diag: AgentSessionRuntimeDiagnostic = { type: "warning", message: "warn msg" };
		expect(diag.type).toBe("warning");
	});

	it("should accept error type", () => {
		const diag: AgentSessionRuntimeDiagnostic = { type: "error", message: "err msg" };
		expect(diag.type).toBe("error");
	});
});

describe("CreateAgentSessionServicesOptions", () => {
	it("should accept minimal options with only cwd", () => {
		const opts: CreateAgentSessionServicesOptions = { cwd: "/test" };
		expect(opts.cwd).toBe("/test");
		expect(opts.agentDir).toBeUndefined();
		expect(opts.authStorage).toBeUndefined();
		expect(opts.settingsManager).toBeUndefined();
		expect(opts.modelRegistry).toBeUndefined();
		expect(opts.extensionFlagValues).toBeUndefined();
		expect(opts.resourceLoaderOptions).toBeUndefined();
	});

	it("should accept all options", () => {
		const flagValues = new Map<string, boolean | string>();
		flagValues.set("verbose", true);
		flagValues.set("output", "json");

		const opts: CreateAgentSessionServicesOptions = {
			cwd: "/test",
			agentDir: "/agent",
			extensionFlagValues: flagValues,
			resourceLoaderOptions: {},
		};

		expect(opts.cwd).toBe("/test");
		expect(opts.agentDir).toBe("/agent");
		expect(opts.extensionFlagValues).toBe(flagValues);
	});
});

describe("AgentSessionServices", () => {
	it("should define all required service fields", () => {
		const services: AgentSessionServices = {
			cwd: "/test",
			agentDir: "/agent",
			authStorage: {} as any,
			settingsManager: {} as any,
			modelRegistry: {} as any,
			resourceLoader: {} as any,
			diagnostics: [],
		};

		expect(services.cwd).toBe("/test");
		expect(services.agentDir).toBe("/agent");
		expect(services.diagnostics).toEqual([]);
	});

	it("should include diagnostics from service creation", () => {
		const diagnostics: AgentSessionRuntimeDiagnostic[] = [
			{ type: "warning", message: "deprecated model" },
			{ type: "error", message: "bad config" },
		];

		const services: AgentSessionServices = {
			cwd: "/test",
			agentDir: "/agent",
			authStorage: {} as any,
			settingsManager: {} as any,
			modelRegistry: {} as any,
			resourceLoader: {} as any,
			diagnostics,
		};

		expect(services.diagnostics).toHaveLength(2);
		expect(services.diagnostics[0].type).toBe("warning");
		expect(services.diagnostics[1].type).toBe("error");
	});
});
