import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative } from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isSensitivePath, redactText, resolvedPathWithinWorkspaces, safeEvidencePath, workspaceRootForCwd } from "./state.ts";
import type { GoalState, VerificationCheck, VerificationResult } from "./types.ts";

const DENIED_EXECUTABLES = new Set([
	"bash", "sh", "zsh", "fish", "sudo", "su", "doas", "ssh", "scp", "rsync",
	"curl", "wget", "systemctl", "service", "docker", "podman", "kubectl", "helm",
]);

function safeEnvironment(): NodeJS.ProcessEnv {
	const allowed = /^(?:PATH|HOME|USER|LOGNAME|SHELL|TMPDIR|TMP|TEMP|LANG|LC_[A-Z_]+|TERM|COLORTERM|CI|NO_COLOR|FORCE_COLOR|NODE_[A-Z_]+|npm_config_[A-Za-z_]+)$/;
	return Object.fromEntries(
		Object.entries(process.env).filter(([key, value]) => value !== undefined && key !== "NODE_OPTIONS" && allowed.test(key) && !/(?:token|secret|password|credential|auth|cookie|key)/i.test(key)),
	);
}

function runProcess(
	executable: string,
	args: string[],
	cwd: string,
	timeoutMs: number,
	signal?: AbortSignal,
): Promise<{ exitCode: number; durationMs: number; stdout: string; stderr: string; stdoutBytes: number; stderrBytes: number; stdoutTruncated: boolean; stderrTruncated: boolean; timedOut: boolean; aborted: boolean; signal?: string }> {
	return new Promise((resolvePromise, reject) => {
		const started = Date.now();
		let settled = false;
		let timedOut = false;
		let aborted = false;
		let forceKill: NodeJS.Timeout | undefined;
		const child = spawn(executable, args, {
			cwd,
			shell: false,
			stdio: ["ignore", "pipe", "pipe"],
			env: safeEnvironment(),
		});
		const captureLimit = 8_192;
		let stdout = "";
		let stderr = "";
		let stdoutBytes = 0;
		let stderrBytes = 0;
		let stdoutTruncated = false;
		let stderrTruncated = false;
		const terminate = () => {
			child.kill("SIGTERM");
			forceKill = setTimeout(() => child.kill("SIGKILL"), 1_000);
		};
		const consume = (chunk: Buffer, stream: "stdout" | "stderr") => {
			const text = chunk.toString("utf8");
			if (stream === "stdout") {
				stdoutBytes += chunk.length;
				if (stdout.length < captureLimit) stdout += text.slice(0, captureLimit - stdout.length);
				if (stdoutBytes > captureLimit) stdoutTruncated = true;
			} else {
				stderrBytes += chunk.length;
				if (stderr.length < captureLimit) stderr += text.slice(0, captureLimit - stderr.length);
				if (stderrBytes > captureLimit) stderrTruncated = true;
			}
			// Stay below typical pipe capacity so a flooding child cannot block before
			// the parent observes enough bytes to terminate it.
			if (stdoutBytes + stderrBytes > 131_072) terminate();
		};
		child.stdout?.on("data", (chunk: Buffer) => consume(chunk, "stdout"));
		child.stderr?.on("data", (chunk: Buffer) => consume(chunk, "stderr"));
		const timer = setTimeout(() => { timedOut = true; terminate(); }, timeoutMs);
		const abort = () => { aborted = true; terminate(); };
		signal?.addEventListener("abort", abort, { once: true });
		const cleanup = () => {
			clearTimeout(timer);
			if (forceKill) clearTimeout(forceKill);
			signal?.removeEventListener("abort", abort);
		};
		child.on("error", (error) => {
			if (settled) return;
			settled = true;
			cleanup();
			reject(error);
		});
		child.on("close", (code, closeSignal) => {
			if (settled) return;
			settled = true;
			cleanup();
			resolvePromise({ exitCode: typeof code === "number" ? code : 128, durationMs: Date.now() - started, stdout, stderr, stdoutBytes, stderrBytes, stdoutTruncated, stderrTruncated, timedOut, aborted, signal: closeSignal ?? undefined });
		});
	});
}

function jsonPointer(value: unknown, pointer: string): unknown {
	if (pointer === "") return value;
	if (!pointer.startsWith("/")) return undefined;
	let current = value;
	for (const raw of pointer.slice(1).split("/")) {
		const key = raw.replace(/~1/g, "/").replace(/~0/g, "~");
		if (!current || typeof current !== "object" || !(key in current)) return undefined;
		current = (current as Record<string, unknown>)[key];
	}
	return current;
}

function checkedPath(cwd: string, path: string, workspaceRoots: string[] = [cwd]): string {
	if (isSensitivePath(path)) throw new Error("verification path is secret-like and cannot be inspected");
	const resolved = resolvedPathWithinWorkspaces(cwd, workspaceRoots, path);
	if (!resolved) throw new Error("verification path leaves the approved workspace");
	if (isSensitivePath(resolved)) throw new Error("verification path resolves to a secret-like target");
	return resolved;
}

export function validateVerificationCheckDefinition(check: VerificationCheck, workspace: string, workspaceRoots: string[] = [workspace]): void {
	switch (check.kind) {
		case "file_exists":
		case "file_contains":
		case "json_equals":
			checkedPath(workspace, check.path, workspaceRoots);
			if (check.kind === "file_contains" && check.regex) {
				try { new RegExp(check.pattern, "m"); }
				catch { throw new Error("verification regex is invalid"); }
			}
			if (check.kind === "json_equals" && check.pointer !== "" && !check.pointer.startsWith("/")) throw new Error("verification JSON pointer is invalid");
			return;
		case "browser_check": {
			if (!check.url || typeof check.url !== "string") throw new Error("browser_check requires url");
			if (check.url.startsWith("file://")) {
				checkedPath(workspace, fileURLToPath(check.url), workspaceRoots);
			} else {
				const parsed = new URL(check.url);
				if (parsed.protocol !== "http:" && parsed.protocol !== "https:") throw new Error(`browser_check url scheme must be file: or http(s): — got ${parsed.protocol}`);
				const host = parsed.hostname;
				if (host !== "localhost" && host !== "127.0.0.1" && host !== "[::1]") throw new Error("browser_check http(s) url must target localhost/127.0.0.1 (external network is denied)");
			}
			if (check.waitMs !== undefined && (check.waitMs < 0 || check.waitMs > 15000)) throw new Error("browser_check waitMs must be within 0..15000");
			if (check.maxConsoleErrors !== undefined && check.maxConsoleErrors < 0) throw new Error("browser_check maxConsoleErrors must be >= 0");
			if (check.expectVisual !== undefined && (typeof check.expectVisual !== "string" || check.expectVisual.trim().length < 1 || check.expectVisual.length > 300)) throw new Error("browser_check expectVisual must be a non-empty string of at most 300 characters");
			return;
		}
		case "command_exit": {
			if (!check.executable || /[\s;&|<>`$\n\r]/.test(check.executable)) throw new Error("verification executable is invalid");
			const basename = check.executable.split(/[\\/]/).at(-1) ?? check.executable;
			if (DENIED_EXECUTABLES.has(basename)) throw new Error(`verification executable is denied: ${basename}. Verification checks cannot run a shell. Use a native check kind instead (file_exists, file_contains, json_equals, git_status, git_diff) or a command_exit check with a single allowlisted executable such as node or python3.`);
			if (check.args.some((arg) => typeof arg !== "string" || /[\u0000\n\r]/.test(arg))) throw new Error("verification argv contains an invalid value");
			if (["npm", "pnpm", "yarn"].includes(basename)) {
				const operation = check.args[0] ?? "";
				if (/^(?:install|i|add|publish|unpublish|deprecate|login|logout|pack|exec|explore|x|init)$/.test(operation)) throw new Error(`verification package operation is denied: ${operation}`);
				if (operation === "run" && !/^(?:test|check|lint|build|typecheck|verify)(?::[A-Za-z0-9._-]+)?$/.test(check.args[1] ?? "")) throw new Error("verification npm script is outside the test/check/lint/build allowlist");
			}
			if (basename === "git") {
				if (check.args[0] === "-C") throw new Error("verification git -C is unsupported; use check.cwd for the approved root and args beginning with the read-only operation, for example [\"diff\",\"--quiet\",\"HEAD\",\"--\"]");
				if (!["status", "diff", "show", "log", "rev-parse", "ls-files", "grep"].includes(check.args[0] ?? "")) throw new Error("verification git operation is not read-only");
			}
			const commandCwd = check.cwd ? checkedPath(workspace, check.cwd, workspaceRoots) : workspace;
			if (isAbsolute(check.executable) || /[\\/]/.test(check.executable)) checkedPath(commandCwd, check.executable, workspaceRoots);
			return;
		}
		case "git_status":
			if (check.cwd && !workspaceRootForCwd(workspace, workspaceRoots, check.cwd)) throw new Error("verification Git cwd must be an exact approved workspace root");
			return;
		case "git_diff": {
			const gitCwd = check.cwd ? workspaceRootForCwd(workspace, workspaceRoots, check.cwd) : workspaceRootForCwd(workspace, workspaceRoots, workspace);
			if (!gitCwd) throw new Error("verification Git cwd must be an exact approved workspace root");
			for (const path of check.paths ?? []) checkedPath(gitCwd, path, [gitCwd]);
		}
	}
}

function validateExecutable(check: Extract<VerificationCheck, { kind: "command_exit" }>, workspace: string, workspaceRoots: string[]): { executable: string; cwd: string } {
	validateVerificationCheckDefinition(check, workspace, workspaceRoots);
	const cwd = check.cwd ? checkedPath(workspace, check.cwd, workspaceRoots) : workspaceRootForCwd(workspace, workspaceRoots, workspace)!;
	const executable = isAbsolute(check.executable) || /[\\/]/.test(check.executable) ? checkedPath(cwd, check.executable, workspaceRoots) : check.executable;
	return { executable, cwd };
}

	const BROWSER_CHECK_TIMEOUT_MS = 60_000;

	// ── Visual assertion (browser_check.expectVisual) ────────────────────

	export interface VisionJudgeVerdict {
		passed: boolean;
		reason: string;
	}

	/** Judges a captured screenshot against a natural-language expectation.
	 *  Injected as a dependency so tests can mock it; production wires it to
	 *  the session's model via pi.callLLMSafe (image content blocks). */
	export type VisionJudge = (imagePath: string, expectation: string, signal?: AbortSignal) => Promise<VisionJudgeVerdict>;

	export interface VerificationDeps {
		visionJudge?: VisionJudge;
	}

	const VISION_JUDGE_SYSTEM_PROMPT =
		"You are a strict visual acceptance judge for a rendered web page screenshot. " +
		"Compare the screenshot against the stated visual expectation. Judge only what is visibly rendered — " +
		"do not speculate about code or behavior. Reply with ONE minified JSON object and nothing else: " +
		'{"passed":boolean,"reason":"short factual justification"}';

	function parseVisionVerdict(response: string): VisionJudgeVerdict | null {
		const cleaned = response.replace(/```(?:json)?/g, "").trim();
		const match = /\{[^{}]*"passed"[^{}]*\}/.exec(cleaned);
		if (!match) return null;
		try {
			const parsed = JSON.parse(match[0]) as { passed?: unknown; reason?: unknown };
			return { passed: parsed.passed === true, reason: String(parsed.reason ?? "").slice(0, 200) };
		} catch {
			return null;
		}
	}

	export function createCallLLMVisionJudge(
		callLLM: (options: {
			systemPrompt?: string;
			messages: Array<{ role: "user" | "assistant"; content: string | Array<{ type: "text"; text: string } | { type: "image"; data: string; mimeType: string }> }>;
			maxTokens?: number;
			signal?: AbortSignal;
		}) => Promise<string>,
	): VisionJudge {
		return async (imagePath, expectation, signal) => {
			const data = readFileSync(imagePath).toString("base64");
			const response = await callLLM({
				systemPrompt: VISION_JUDGE_SYSTEM_PROMPT,
				messages: [{
					role: "user",
					content: [
						{ type: "image", data, mimeType: "image/png" },
						{ type: "text", text: `Visual expectation:\n${expectation}\n\nJudge the screenshot against it. Reply only the JSON verdict.` },
					],
				}],
				maxTokens: 300,
				signal,
			});
			const verdict = parseVisionVerdict(response);
			if (!verdict) return { passed: false, reason: `visual judge returned unparseable output: ${response.slice(0, 120)}` };
			return verdict;
		};
	}

	/**
	 * Executes a browser_check: drives the xbrowser CLI through an isolated
	 * session to load the page, settle, and probe the rendered DOM. All argv
	 * are fixed strings (no shell interpolation) — the script itself travels
	 * base64url-encoded through the router's --script-b64 channel.
	 */
	async function runBrowserCheck(
		check: Extract<VerificationCheck, { kind: "browser_check" }>,
		workspace: string,
		workspaceRoots: string[],
		started: number,
		signal?: AbortSignal,
		deps?: VerificationDeps,
	): Promise<VerificationResult> {
		const waitMs = check.waitMs ?? 3000;
		const maxErrors = check.maxConsoleErrors ?? 0;
		const session = `goal-bc-${Date.now().toString(36)}`;

		const finish = (passed: boolean, summary: string): VerificationResult => ({
			checkId: check.id,
			passed,
			summary,
			durationMs: Date.now() - started,
		});

		const xb = async (args: string[], timeoutMs: number) => {
			const run = await runProcess("xbrowser", ["--session", session, ...args], workspace, timeoutMs, signal);
			if (run.exitCode !== 0) throw new Error(`xbrowser ${args[0]} exited ${run.exitCode}: ${(run.stderr || run.stdout).slice(0, 200)}`);
			return run;
		};

		try {
			// 1. console-error collector injected BEFORE the page loads
			const initScript = "window.addEventListener('error',function(e){(window.__bcE=window.__bcE||[]).push(String(e.message||e.type))})";
			await xb(["addinitscript", "--script", initScript], 15_000);

			// 2. load the page and let it settle
			await xb(["open", check.url], 30_000);
			await xb(["waitForTimeout", String(waitMs)], waitMs + 20_000);

			// 3. probe the rendered DOM — base64url keeps the script intact
			//    through chain parsing (semicolons/newlines would otherwise
			//    be treated as chain separators)
			const expectJson = JSON.stringify(check.expectTextContains ?? "");
			const probe = `(() => { const t = (document.body && document.body.innerText) || ""; const errs = window.__bcE || []; return JSON.stringify({ bodyLen: t.length, errors: errs, hasText: t.includes(${expectJson}) }); })()`;
			const probeB64 = Buffer.from(probe, "utf8").toString("base64url");
			const probeRun = await xb(["eval", "--script-b64", probeB64], 20_000);

			// 4. screenshot evidence (best effort)
			let shotPath = "";
			try {
				const shot = await xb(["screenshot"], 15_000);
				const m = /output:\s*(\S+\.png)/.exec(shot.stdout.replace(/\x1b\[[0-9;]*m/g, ""));
				if (m) shotPath = m[1]!;
			} catch { /* evidence is optional */ }

			// 5. parse the probe result (strip ANSI, take the result line)
			const clean = probeRun.stdout.replace(/\x1b\[[0-9;]*m/g, "");
			const resultLine = clean.split("\n").reverse().find((line) => line.trim().startsWith("result:"));
			if (!resultLine) return finish(false, "browser_check probe produced no result (page did not render?)");
			const parsed = JSON.parse(resultLine.trim().slice("result:".length).trim()) as { bodyLen: number; errors: string[]; hasText: boolean };
			const consoleErrors = parsed.errors || [];
			let passed = parsed.bodyLen > 0 && parsed.hasText && consoleErrors.length <= maxErrors;
			const bits = [`bodyLen=${parsed.bodyLen}`, `hasText=${parsed.hasText}`, `consoleErrors=${consoleErrors.length}/${maxErrors}`];
			if (shotPath) bits.push(`screenshot=${shotPath}`);

			// 6. optional visual assertion — judge the screenshot with a vision model
			if (check.expectVisual) {
				if (!shotPath) {
					return finish(false, `browser check visual assertion failed: no screenshot was captured for judging (expectation: ${redactText(check.expectVisual, 120).text})`);
				}
				if (!deps?.visionJudge) {
					return finish(false, "browser check visual assertion failed: vision judge unavailable in this runtime");
				}
				try {
					const verdict = await deps.visionJudge(shotPath, check.expectVisual, signal);
					bits.push(`visual=${verdict.passed}`);
					if (verdict.reason) bits.push(`visualReason=${verdict.reason}`);
					passed = passed && verdict.passed;
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					return finish(false, `browser check visual assertion could not run: ${message.slice(0, 240)}`);
				}
			}
			return finish(passed, passed ? `browser check passed (${bits.join(", ")})` : `browser check failed: ${bits.join(", ")}`);
		} catch (error) {
			// best-effort session cleanup on any failure path
			try { await runProcess("xbrowser", ["--session", session, "session", "close", "--session", session], workspace, 10_000, undefined); } catch { /* ignore */ }
			const message = error instanceof Error ? error.message : String(error);
			return finish(false, `browser check could not run: ${message.slice(0, 300)}`);
		}
	}

	export async function runVerificationCheck(check: VerificationCheck, workspace: string, signal?: AbortSignal, workspaceRoots: string[] = [workspace], deps?: VerificationDeps): Promise<VerificationResult> {
	const started = Date.now();
	try {
		switch (check.kind) {
			case "file_exists": {
				const passed = existsSync(checkedPath(workspace, check.path, workspaceRoots));
				return { checkId: check.id, passed, summary: passed ? "required file exists" : "required file is missing", durationMs: Date.now() - started };
			}
			case "file_contains": {
				const text = readFileSync(checkedPath(workspace, check.path, workspaceRoots), "utf8");
				const passed = check.regex ? new RegExp(check.pattern, "m").test(text) : text.includes(check.pattern);
				return { checkId: check.id, passed, summary: passed ? "required content found" : "required content not found", durationMs: Date.now() - started };
			}
			case "json_equals": {
				const document = JSON.parse(readFileSync(checkedPath(workspace, check.path, workspaceRoots), "utf8"));
				const passed = JSON.stringify(jsonPointer(document, check.pointer)) === JSON.stringify(check.value);
				return { checkId: check.id, passed, summary: passed ? "JSON value matches" : "JSON value differs", durationMs: Date.now() - started };
			}
			case "command_exit": {
				const { executable, cwd } = validateExecutable(check, workspace, workspaceRoots);
				const result = await runProcess(executable, check.args, cwd, Math.max(1_000, Math.min(check.timeoutMs ?? 120_000, 900_000)), signal);
				const expected = check.expectedExitCode ?? 0;
				const passed = !result.timedOut && !result.aborted && result.exitCode === expected;
				const summary = result.timedOut
					? `command timed out after ${result.durationMs}ms`
					: result.aborted
						? "command aborted"
						: result.signal
							? `command terminated by ${result.signal}`
							: passed ? `command exited ${expected}` : `command exited ${result.exitCode}; expected ${expected}`;
				const safeStdout = redactText(result.stdout, 8_192);
				const safeStderr = redactText(result.stderr, 8_192);
				return {
					checkId: check.id, passed, summary, exitCode: result.exitCode,
					timedOut: result.timedOut || undefined, aborted: result.aborted || undefined,
					signal: result.signal, durationMs: result.durationMs,
					...(!passed ? {
						stdout: safeStdout.text, stderr: safeStderr.text,
						stdoutBytes: result.stdoutBytes, stderrBytes: result.stderrBytes,
						stdoutTruncated: result.stdoutTruncated || safeStdout.redacted || undefined,
						stderrTruncated: result.stderrTruncated || safeStderr.redacted || undefined,
						outputRedacted: safeStdout.redacted || safeStderr.redacted || undefined,
					} : {}),
				};
			}
			case "browser_check": {
				return runBrowserCheck(check, workspace, workspaceRoots, started, signal, deps);
			}
			case "git_status": {
				const gitCwd = check.cwd ? workspaceRootForCwd(workspace, workspaceRoots, check.cwd) : workspaceRootForCwd(workspace, workspaceRoots, workspace);
				if (!gitCwd) throw new Error("verification Git cwd must be an exact approved workspace root");
				const result = await runProcess("git", ["status", "--porcelain"], gitCwd, 30_000, signal);
				if (result.exitCode !== 0) return { checkId: check.id, passed: false, summary: `git status exited ${result.exitCode}`, exitCode: result.exitCode, durationMs: result.durationMs };
				const isClean = result.stdout.trim().length === 0;
				const expectedClean = check.clean !== false;
				const passed = expectedClean ? isClean : !isClean;
				return { checkId: check.id, passed, summary: passed ? (expectedClean ? "git worktree is clean" : "git worktree contains changes") : (expectedClean ? "git worktree contains changes" : "git worktree is clean"), exitCode: passed ? 0 : 1, durationMs: result.durationMs };
			}
			case "git_diff": {
				const gitCwd = check.cwd ? workspaceRootForCwd(workspace, workspaceRoots, check.cwd) : workspaceRootForCwd(workspace, workspaceRoots, workspace);
				if (!gitCwd) throw new Error("verification Git cwd must be an exact approved workspace root");
				const args = ["diff", "--quiet", ...(check.paths?.length ? ["--", ...check.paths.map((path) => relative(gitCwd, checkedPath(gitCwd, path, [gitCwd])) || ".")] : [])];
				const result = await runProcess("git", args, gitCwd, 30_000, signal);
				const expectedEmpty = check.empty !== false;
				const passed = expectedEmpty ? result.exitCode === 0 : result.exitCode === 1;
				return { checkId: check.id, passed, summary: passed ? (expectedEmpty ? "git diff is empty" : "git diff contains changes") : (expectedEmpty ? "git diff contains changes" : "git diff is empty"), exitCode: result.exitCode, durationMs: result.durationMs };
			}
		}
	} catch (error) {
		return { checkId: check.id, passed: false, summary: error instanceof Error ? error.message : String(error), durationMs: Date.now() - started };
	}
}

export function describeVerificationCheck(check: VerificationCheck, workspace: string, workspaceRoots: string[] = [workspace]): string {
	switch (check.kind) {
		case "file_exists":
		case "file_contains":
		case "json_equals":
			return `path=${JSON.stringify(safeEvidencePath(workspace, check.path, workspaceRoots))}`;
		case "command_exit": {
			const cwd = check.cwd ? safeEvidencePath(workspace, check.cwd, workspaceRoots) : ".";
			const executable = redactText(check.executable, 80).text;
			const argv = redactText(JSON.stringify(check.args.map((arg) => redactText(arg, 240).text)), 900).text;
			return `executable=${JSON.stringify(executable)} cwd=${JSON.stringify(cwd)} argv=${argv}`;
		}
		case "git_status":
			return `workspace=${JSON.stringify(check.cwd ? safeEvidencePath(workspace, check.cwd, workspaceRoots) : safeEvidencePath(workspace, ".", workspaceRoots))}`;
		case "browser_check":
			return `url=${JSON.stringify(check.url)} waitMs=${check.waitMs ?? 0} expect=${JSON.stringify(redactText(check.expectTextContains ?? "", 200).text)}${check.expectVisual ? ` expectVisual=${JSON.stringify(redactText(check.expectVisual, 120).text)}` : ""}`;
		case "git_diff":
			return `workspace=${JSON.stringify(check.cwd ? safeEvidencePath(workspace, check.cwd, workspaceRoots) : safeEvidencePath(workspace, ".", workspaceRoots))} paths=${redactText(JSON.stringify((check.paths ?? []).map((path) => safeEvidencePath(check.cwd ?? workspace, path, check.cwd ? [check.cwd] : workspaceRoots))), 500).text}`;
	}
}

function labelApprovedCheckResult(check: VerificationCheck, result: VerificationResult, workspace: string, workspaceRoots: string[]): VerificationResult {
	const label = JSON.stringify(redactText(check.label, 120).text);
	return { ...result, summary: `setup-approved check ${check.id} ${label} (${describeVerificationCheck(check, workspace, workspaceRoots)}): ${result.summary}` };
}

export async function runAllChecks(state: GoalState, signal?: AbortSignal, deps?: VerificationDeps): Promise<VerificationResult[]> {
	const results: VerificationResult[] = [];
	for (const check of state.verificationChecks) results.push(labelApprovedCheckResult(check, await runVerificationCheck(check, state.cwd, signal, state.workspaceRoots, deps), state.cwd, state.workspaceRoots));
	return results;
}
