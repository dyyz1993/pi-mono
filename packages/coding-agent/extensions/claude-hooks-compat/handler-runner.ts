import { spawn } from "node:child_process";
import type { HookHandler, HookOutput, HookStdinData } from "./types.js";

type CallLLMFn = (options: {
	systemPrompt?: string;
	messages: { role: "user" | "assistant"; content: string }[];
	tools?: string[];
	maxTurns?: number;
	maxTokens?: number;
	signal?: AbortSignal;
}) => Promise<string>;

export async function runHandler(
	handler: HookHandler,
	stdinData: HookStdinData,
	ctx: { cwd: string; hasUI: boolean },
	callLLM?: CallLLMFn,
): Promise<HookOutput> {
	switch (handler.type) {
		case "command":
			return runCommandHandler(handler, stdinData, ctx);
		case "http":
			return runHttpHandler(handler, stdinData);
		case "prompt":
			return runPromptHandler(handler, stdinData, callLLM);
		case "agent":
			return runAgentHandler(handler, stdinData, callLLM);
		case "mcp_tool":
			return { exitCode: 0, stdout: "", stderr: "" };
		default:
			return { exitCode: 0, stdout: "", stderr: "" };
	}
}

export function replaceVariables(command: string, stdinData: HookStdinData, cwd: string): string {
	return command
		.replace(/\$CLAUDE_PROJECT_DIR/g, cwd)
		.replace(/\$TOOL/g, stdinData.tool_name ?? "")
		.replace(/\$BASH_COMMAND/g, ((stdinData.tool_input as Record<string, unknown>)?.command as string) ?? "")
		.replace(/\$ARGUMENTS/g, JSON.stringify(stdinData.tool_input ?? {}));
}

export function replaceInputPlaceholders(
	template: Record<string, unknown>,
	stdinData: HookStdinData,
): Record<string, unknown> {
	const result: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(template)) {
		if (typeof value === "string") {
			result[key] = value.replace(/\$\{([^}]+)\}/g, (_, path) => {
				return String(resolvePath(stdinData, path) ?? "");
			});
		} else if (value && typeof value === "object" && !Array.isArray(value)) {
			result[key] = replaceInputPlaceholders(value as Record<string, unknown>, stdinData);
		} else {
			result[key] = value;
		}
	}
	return result;
}

function resolvePath(obj: unknown, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;
	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}
	return current;
}

export function replaceEnvVarsInHeaders(
	headers: Record<string, string>,
	allowedEnvVars: string[] | undefined,
): Record<string, string> {
	if (!allowedEnvVars || allowedEnvVars.length === 0) return headers;

	const allowed = new Set(allowedEnvVars);
	const result: Record<string, string> = {};

	for (const [key, value] of Object.entries(headers)) {
		result[key] = value.replace(/\$\{?(\w+)\}?/g, (match, varName) => {
			if (allowed.has(varName)) {
				return process.env[varName] ?? "";
			}
			return match;
		});
	}

	return result;
}

function buildHookEnv(cwd: string, eventName: string): NodeJS.ProcessEnv {
	const env = { ...process.env } as NodeJS.ProcessEnv;

	if (process.env.GITHUB_ACTIONS === "true") {
		for (const key of Object.keys(env)) {
			if (key.startsWith("ANTHROPIC_") || key.startsWith("CLAUDE_CODE_OAUTH")) {
				delete env[key];
			}
		}
	}

	env.CLAUDE_PROJECT_DIR = cwd;
	env.CLAUDE_CODE_SHELL_PREFIX = "";

	if (["SessionStart", "Setup", "CwdChanged", "FileChanged"].includes(eventName)) {
		env.CLAUDE_ENV_FILE = `/tmp/claude-env-${Date.now()}`;
	}

	return env;
}

function runCommandHandler(handler: HookHandler, stdinData: HookStdinData, ctx: { cwd: string }): Promise<HookOutput> {
	return new Promise((resolve) => {
		const timeout = (handler.timeout ?? 600) * 1000;
		const command = replaceVariables(handler.command ?? "", stdinData, ctx.cwd);
		let stdout = "";
		let stderr = "";
		let settled = false;

		const env = buildHookEnv(ctx.cwd, stdinData.hook_event_name);
		const proc = spawn("bash", ["-c", command], {
			cwd: ctx.cwd,
			env,
		});

		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			proc.kill("SIGTERM");
			resolve({ exitCode: 1, stdout: "", stderr: "Hook timed out" });
		}, timeout);

		proc.stdin.write(JSON.stringify(stdinData));
		proc.stdin.end();

		proc.stdout.on("data", (d: Buffer) => {
			stdout += d.toString();
		});
		proc.stderr.on("data", (d: Buffer) => {
			stderr += d.toString();
		});

		proc.on("close", (code) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);

			const result: HookOutput = {
				exitCode: code ?? 0,
				stdout: stdout.trim(),
				stderr: stderr.trim(),
			};

			if (result.exitCode === 0 && stdout.trim().startsWith("{")) {
				try {
					result.parsed = JSON.parse(stdout.trim());
				} catch {}
			}

			resolve(result);
		});

		proc.on("error", (err) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			resolve({ exitCode: 1, stdout: "", stderr: err.message });
		});
	});
}

async function runHttpHandler(handler: HookHandler, stdinData: HookStdinData): Promise<HookOutput> {
	const timeout = (handler.timeout ?? 600) * 1000;

	try {
		const urlStr = handler.url ?? "";
		let parsedUrl: URL;
		try {
			parsedUrl = new URL(urlStr);
		} catch {
			return { exitCode: 1, stdout: "", stderr: `Invalid URL: ${urlStr}` };
		}

		if (parsedUrl.protocol !== "https:") {
			return { exitCode: 1, stdout: "", stderr: "Only HTTPS URLs are allowed" };
		}

		const hostname = parsedUrl.hostname.toLowerCase();
		if (isPrivateIP(hostname)) {
			return { exitCode: 1, stdout: "", stderr: `Requests to private addresses are not allowed: ${hostname}` };
		}

		const rawHeaders = handler.headers ?? {};
		const headers = replaceEnvVarsInHeaders(rawHeaders, handler.allowedEnvVars);
		headers["Content-Type"] = headers["Content-Type"] ?? "application/json";

		const resp = await fetch(urlStr, {
			method: "POST",
			headers,
			body: JSON.stringify(stdinData),
			signal: AbortSignal.timeout(timeout),
		});

		if (resp.ok) {
			const text = await resp.text();
			let parsed: HookOutput["parsed"];
			try {
				parsed = JSON.parse(text);
			} catch {}
			return { exitCode: 0, stdout: text, stderr: "", parsed };
		}

		if (resp.status === 403) {
			const body = await resp.text().catch(() => "");
			return { exitCode: 2, stdout: "", stderr: body || `HTTP ${resp.status}` };
		}

		return { exitCode: 1, stdout: "", stderr: `HTTP ${resp.status}` };
	} catch (err) {
		return { exitCode: 1, stdout: "", stderr: (err as Error).message };
	}
}

function isPrivateIP(hostname: string): boolean {
	if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "0.0.0.0") {
		return true;
	}

	if (hostname === "::1" || hostname === "[::1]") {
		return true;
	}

	const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
	if (ipv4Match) {
		const [, a, b] = ipv4Match.map(Number);
		if (a === 10) return true;
		if (a === 172 && b >= 16 && b <= 31) return true;
		if (a === 192 && b === 168) return true;
		if (a === 169 && b === 254) return true;
		if (a === 127) return true;
		if (a === 0) return true;
	}

	if (hostname.startsWith("fc") || hostname.startsWith("fd") || hostname.startsWith("fe80")) {
		return true;
	}

	return false;
}

async function runPromptHandler(
	handler: HookHandler,
	stdinData: HookStdinData,
	callLLM?: CallLLMFn,
): Promise<HookOutput> {
	if (!callLLM || !handler.prompt) {
		return { exitCode: 0, stdout: "", stderr: "" };
	}

	const timeout = (handler.timeout ?? 30) * 1000;

	try {
		const promptText = handler.prompt.replace(/\$ARGUMENTS/g, JSON.stringify(stdinData));

		const response = await callLLM({
			systemPrompt:
				"You are a hook evaluator. Respond with a JSON object. If the action should proceed, respond with {\"ok\":true}. If it should be blocked, respond with {\"ok\":false,\"reason\":\"...\"}.",
			messages: [{ role: "user", content: promptText }],
			maxTokens: 1024,
			signal: AbortSignal.timeout(timeout),
		});

		let parsed: HookOutput["parsed"];
		try {
			parsed = JSON.parse(response);
		} catch {}

		return { exitCode: 0, stdout: response, stderr: "", parsed };
	} catch (err) {
		return { exitCode: 1, stdout: "", stderr: (err as Error).message };
	}
}

async function runAgentHandler(
	handler: HookHandler,
	stdinData: HookStdinData,
	callLLM?: CallLLMFn,
): Promise<HookOutput> {
	if (!callLLM || !handler.prompt) {
		return { exitCode: 0, stdout: "", stderr: "" };
	}

	const timeout = (handler.timeout ?? 60) * 1000;

	try {
		const promptText = handler.prompt.replace(/\$ARGUMENTS/g, JSON.stringify(stdinData));

		const response = await callLLM({
			systemPrompt:
				"You are a hook evaluator agent. You can use tools to verify conditions. Respond with a JSON object. If the action should proceed, respond with {\"ok\":true}. If it should be blocked, respond with {\"ok\":false,\"reason\":\"...\"}.",
			messages: [{ role: "user", content: promptText }],
			maxTurns: 50,
			maxTokens: 4096,
			signal: AbortSignal.timeout(timeout),
		});

		let parsed: HookOutput["parsed"];
		try {
			parsed = JSON.parse(response);
		} catch {}

		return { exitCode: 0, stdout: response, stderr: "", parsed };
	} catch (err) {
		return { exitCode: 1, stdout: "", stderr: (err as Error).message };
	}
}

export function interpretHookOutput(output: HookOutput): {
	shouldBlock: boolean;
	reason: string;
	updatedInput?: Record<string, unknown>;
	additionalContext?: string;
	systemMessage?: string;
	suppressOutput?: boolean;
	retry?: boolean;
} {
	if (output.exitCode === 2) {
		return { shouldBlock: true, reason: output.stderr || "Blocked by hook" };
	}

	if (output.parsed) {
		const p = output.parsed;

		if (p.continue === false) {
			return { shouldBlock: true, reason: p.stopReason || "Hook stopped execution" };
		}

		if (p.ok === false) {
			return { shouldBlock: true, reason: p.reason || "Blocked by hook" };
		}

		if (p.decision === "block") {
			return { shouldBlock: true, reason: p.reason || "Blocked by hook" };
		}

		const hso = p.hookSpecificOutput;
		if (hso?.permissionDecision === "deny") {
			return { shouldBlock: true, reason: hso.permissionDecisionReason || "Denied by hook" };
		}

		return {
			shouldBlock: false,
			reason: "",
			updatedInput: hso?.updatedInput ?? hso?.modifiedToolInput,
			additionalContext: hso?.additionalContext,
			systemMessage: p.systemMessage,
			suppressOutput: p.suppressOutput,
			retry: hso?.retry === true,
		};
	}

	return { shouldBlock: false, reason: "" };
}
