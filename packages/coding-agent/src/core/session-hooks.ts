export type SessionHookHandlerType = "command" | "http" | "mcp_tool" | "prompt" | "agent";

export interface SessionHookHandler {
	type: SessionHookHandlerType;
	command?: string;
	prompt?: string;
	url?: string;
	server?: string;
	tool?: string;
	input?: Record<string, unknown>;
	headers?: Record<string, string>;
	allowedEnvVars?: string[];
	model?: string;
	timeout?: number;
	if?: string;
	async?: boolean;
	asyncRewake?: boolean;
	shell?: "bash" | "powershell";
	statusMessage?: string;
	once?: boolean;
	"x-pi-variables"?: Record<string, string>;
}

export interface SessionHookGroup {
	matcher?: string;
	hooks: SessionHookHandler[];
	__source__?: string;
}

export type SessionHookEntry = SessionHookHandler | SessionHookGroup;

export type SessionHooks = Partial<Record<string, SessionHookEntry[]>>;

export interface SessionHookParseDiagnostic {
	path: string;
	message: string;
}

export interface ParseSessionHooksResult {
	hooks?: SessionHooks;
	diagnostics: SessionHookParseDiagnostic[];
}

interface SessionHookRegistration {
	hooks: Map<string, SessionHookGroup[]>;
}

const VALID_HANDLER_TYPES: SessionHookHandlerType[] = ["command", "http", "mcp_tool", "prompt", "agent"];

type SessionHooksGlobal = typeof globalThis & {
	__piSessionHooksBySession?: Map<string, Map<string, SessionHookRegistration>>;
};

const sessionHooksGlobal = globalThis as SessionHooksGlobal;
const sessionHooksBySession =
	sessionHooksGlobal.__piSessionHooksBySession ?? new Map<string, Map<string, SessionHookRegistration>>();
sessionHooksGlobal.__piSessionHooksBySession = sessionHooksBySession;

export function parseSessionHooks(raw: unknown): SessionHooks | undefined {
	return parseSessionHooksWithDiagnostics(raw).hooks;
}

export function parseSessionHooksWithDiagnostics(raw: unknown, pathPrefix = "hooks"): ParseSessionHooksResult {
	const diagnostics: SessionHookParseDiagnostic[] = [];
	if (!isRecord(raw)) {
		diagnostics.push({ path: pathPrefix, message: "must be an object" });
		return { diagnostics };
	}
	const hooks: SessionHooks = {};

	for (const [eventName, entries] of Object.entries(raw)) {
		const eventPath = `${pathPrefix}.${eventName}`;
		if (!Array.isArray(entries)) {
			diagnostics.push({ path: eventPath, message: "must be an array" });
			continue;
		}
		const parsed: SessionHookEntry[] = [];

		for (let entryIndex = 0; entryIndex < entries.length; entryIndex++) {
			const entry = entries[entryIndex];
			const entryPath = `${eventPath}[${entryIndex}]`;
			if (!isRecord(entry)) {
				diagnostics.push({ path: entryPath, message: "must be an object" });
				continue;
			}

			if ("hooks" in entry) {
				if (!Array.isArray(entry.hooks)) {
					diagnostics.push({ path: `${entryPath}.hooks`, message: "must be an array" });
					continue;
				}
				if (entry.matcher !== undefined && typeof entry.matcher !== "string") {
					diagnostics.push({ path: `${entryPath}.matcher`, message: "must be a string" });
				}
				const groupHooks = entry.hooks
					.map((hook, hookIndex) =>
						parseSessionHookHandlerWithDiagnostics(hook, `${entryPath}.hooks[${hookIndex}]`, diagnostics),
					)
					.filter((hook) => hook !== undefined);
				if (groupHooks.length > 0) {
					parsed.push({
						matcher: typeof entry.matcher === "string" ? entry.matcher : undefined,
						hooks: groupHooks,
					});
				} else {
					diagnostics.push({ path: `${entryPath}.hooks`, message: "must contain at least one valid hook" });
				}
				continue;
			}

			const handler = parseSessionHookHandlerWithDiagnostics(entry, entryPath, diagnostics);
			if (handler) parsed.push(handler);
		}

		if (parsed.length > 0) hooks[eventName] = parsed;
	}

	return {
		hooks: Object.keys(hooks).length > 0 ? hooks : undefined,
		diagnostics,
	};
}

export function parseSessionHookHandler(raw: unknown): SessionHookHandler | undefined {
	return parseSessionHookHandlerWithDiagnostics(raw, "hook", []);
}

function parseSessionHookHandlerWithDiagnostics(
	raw: unknown,
	path: string,
	diagnostics: SessionHookParseDiagnostic[],
): SessionHookHandler | undefined {
	if (!isRecord(raw)) {
		diagnostics.push({ path, message: "must be an object" });
		return undefined;
	}
	const type = raw.type;

	if (type === "command" && typeof raw.command === "string") {
		validateCommonFields(raw, path, diagnostics);
		return withCommonFields(raw, { type, command: raw.command });
	}
	if (type === "prompt" && typeof raw.prompt === "string") {
		validateCommonFields(raw, path, diagnostics);
		return withCommonFields(raw, { type, prompt: raw.prompt });
	}
	if (type === "http" && typeof raw.url === "string") {
		validateCommonFields(raw, path, diagnostics);
		return withCommonFields(raw, { type, url: raw.url });
	}
	if (type === "agent" && typeof raw.prompt === "string") {
		validateCommonFields(raw, path, diagnostics);
		return withCommonFields(raw, { type, prompt: raw.prompt });
	}
	if (type === "mcp_tool" && typeof raw.server === "string" && typeof raw.tool === "string") {
		validateCommonFields(raw, path, diagnostics);
		return withCommonFields(raw, { type, server: raw.server, tool: raw.tool });
	}

	if (typeof type !== "string" || !VALID_HANDLER_TYPES.includes(type as SessionHookHandlerType)) {
		diagnostics.push({ path: `${path}.type`, message: `must be one of: ${VALID_HANDLER_TYPES.join(", ")}` });
		return undefined;
	}
	const requiredField =
		type === "command" ? "command" : type === "http" ? "url" : type === "mcp_tool" ? "server and tool" : "prompt";
	diagnostics.push({ path, message: `handler type "${type}" requires ${requiredField}` });
	return undefined;
}

function validateCommonFields(
	raw: Record<string, unknown>,
	path: string,
	diagnostics: SessionHookParseDiagnostic[],
): void {
	if (raw.input !== undefined && !isRecord(raw.input)) {
		diagnostics.push({ path: `${path}.input`, message: "must be an object" });
	}
	if (raw.headers !== undefined && !isStringRecord(raw.headers)) {
		diagnostics.push({ path: `${path}.headers`, message: "must be an object with string values" });
	}
	if (
		raw.allowedEnvVars !== undefined &&
		(!Array.isArray(raw.allowedEnvVars) || !raw.allowedEnvVars.every((entry) => typeof entry === "string"))
	) {
		diagnostics.push({ path: `${path}.allowedEnvVars`, message: "must be an array of strings" });
	}
	if (raw.model !== undefined && typeof raw.model !== "string") {
		diagnostics.push({ path: `${path}.model`, message: "must be a string" });
	}
	if (raw.timeout !== undefined && typeof raw.timeout !== "number") {
		diagnostics.push({ path: `${path}.timeout`, message: "must be a number" });
	}
	if (raw.if !== undefined && typeof raw.if !== "string") {
		diagnostics.push({ path: `${path}.if`, message: "must be a string" });
	}
	if (raw.async !== undefined && typeof raw.async !== "boolean") {
		diagnostics.push({ path: `${path}.async`, message: "must be a boolean" });
	}
	if (raw.asyncRewake !== undefined && typeof raw.asyncRewake !== "boolean") {
		diagnostics.push({ path: `${path}.asyncRewake`, message: "must be a boolean" });
	}
	if (raw.shell !== undefined && raw.shell !== "bash" && raw.shell !== "powershell") {
		diagnostics.push({ path: `${path}.shell`, message: 'must be "bash" or "powershell"' });
	}
	if (raw.statusMessage !== undefined && typeof raw.statusMessage !== "string") {
		diagnostics.push({ path: `${path}.statusMessage`, message: "must be a string" });
	}
	if (raw.once !== undefined && typeof raw.once !== "boolean") {
		diagnostics.push({ path: `${path}.once`, message: "must be a boolean" });
	}
	if (raw["x-pi-variables"] !== undefined && !isStringRecord(raw["x-pi-variables"])) {
		diagnostics.push({ path: `${path}.x-pi-variables`, message: "must be an object with string values" });
	}
}

export function normalizeSessionHooks(
	hooks: SessionHooks | undefined,
	source: string,
	options?: { mapAgentStop?: boolean },
): Map<string, SessionHookGroup[]> {
	const normalized = new Map<string, SessionHookGroup[]>();
	if (!hooks) return normalized;

	for (const [eventName, entries] of Object.entries(hooks)) {
		if (!entries || entries.length === 0) continue;
		const mappedEventName = options?.mapAgentStop && eventName === "Stop" ? "SubagentStop" : eventName;
		const groups: SessionHookGroup[] = [];

		for (const entry of entries) {
			if (isSessionHookGroup(entry)) {
				if (entry.hooks.length === 0) continue;
				groups.push({
					matcher: entry.matcher,
					hooks: entry.hooks.map(copyHandler),
					__source__: source,
				});
				continue;
			}

			groups.push({
				hooks: [copyHandler(entry)],
				__source__: source,
			});
		}

		if (groups.length > 0) {
			const existing = normalized.get(mappedEventName) ?? [];
			normalized.set(mappedEventName, [...existing, ...groups]);
		}
	}

	return normalized;
}

export function registerSessionHooks(
	sessionId: string,
	source: string,
	hooks: SessionHooks | undefined,
	options?: { mapAgentStop?: boolean },
): () => void {
	const normalized = normalizeSessionHooks(hooks, source, options);
	let sessionHooks = sessionHooksBySession.get(sessionId);
	if (!sessionHooks) {
		sessionHooks = new Map();
		sessionHooksBySession.set(sessionId, sessionHooks);
	}

	sessionHooks.set(source, { hooks: normalized });

	return () => {
		const currentSessionHooks = sessionHooksBySession.get(sessionId);
		currentSessionHooks?.delete(source);
		if (currentSessionHooks?.size === 0) {
			sessionHooksBySession.delete(sessionId);
		}
	};
}

export function clearSessionHooksBySource(sessionId: string, source: string): void {
	const sessionHooks = sessionHooksBySession.get(sessionId);
	sessionHooks?.delete(source);
	if (sessionHooks?.size === 0) {
		sessionHooksBySession.delete(sessionId);
	}
}

export function clearSessionHooks(sessionId: string): void {
	sessionHooksBySession.delete(sessionId);
}

export function getSessionHookGroups(sessionId: string | undefined, eventName: string): SessionHookGroup[] {
	if (!sessionId) return [];
	const sessionHooks = sessionHooksBySession.get(sessionId);
	if (!sessionHooks) return [];

	const groups: SessionHookGroup[] = [];
	for (const registration of sessionHooks.values()) {
		groups.push(...(registration.hooks.get(eventName) ?? []));
	}
	return groups;
}

export function getAllSessionHookGroups(sessionId: string | undefined): Map<string, SessionHookGroup[]> {
	const all = new Map<string, SessionHookGroup[]>();
	if (!sessionId) return all;
	const sessionHooks = sessionHooksBySession.get(sessionId);
	if (!sessionHooks) return all;

	for (const registration of sessionHooks.values()) {
		for (const [eventName, groups] of registration.hooks.entries()) {
			const existing = all.get(eventName) ?? [];
			all.set(eventName, [...existing, ...groups]);
		}
	}

	return all;
}

function isSessionHookGroup(entry: SessionHookEntry): entry is SessionHookGroup {
	return "hooks" in entry && Array.isArray(entry.hooks);
}

function withCommonFields(raw: Record<string, unknown>, base: SessionHookHandler): SessionHookHandler {
	return {
		...base,
		input: isRecord(raw.input) ? raw.input : undefined,
		headers: isStringRecord(raw.headers) ? raw.headers : undefined,
		allowedEnvVars: Array.isArray(raw.allowedEnvVars) ? raw.allowedEnvVars.map(String) : undefined,
		model: typeof raw.model === "string" ? raw.model : undefined,
		timeout: typeof raw.timeout === "number" ? raw.timeout : undefined,
		if: typeof raw.if === "string" ? raw.if : undefined,
		async: raw.async === true,
		asyncRewake: raw.asyncRewake === true,
		shell: raw.shell === "bash" || raw.shell === "powershell" ? raw.shell : undefined,
		statusMessage: typeof raw.statusMessage === "string" ? raw.statusMessage : undefined,
		once: raw.once === true,
		"x-pi-variables": isStringRecord(raw["x-pi-variables"]) ? raw["x-pi-variables"] : undefined,
	};
}

function copyHandler(handler: SessionHookHandler): SessionHookHandler {
	return {
		...handler,
		headers: handler.headers ? { ...handler.headers } : undefined,
		allowedEnvVars: handler.allowedEnvVars ? [...handler.allowedEnvVars] : undefined,
		input: handler.input ? { ...handler.input } : undefined,
		"x-pi-variables": handler["x-pi-variables"] ? { ...handler["x-pi-variables"] } : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringRecord(value: unknown): value is Record<string, string> {
	return isRecord(value) && Object.values(value).every((entry) => typeof entry === "string");
}
