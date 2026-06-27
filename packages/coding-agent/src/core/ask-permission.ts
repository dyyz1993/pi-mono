import type {
	ExtensionUIContext,
	ExtensionUIPermissionMeta,
	PermissionRequestEvent,
	PermissionRequestResult,
} from "./extensions/index.ts";
import type { PermissionAction, PermissionDecision, PermissionRequest } from "./permissions/index.ts";
import type { PermissionRuleDecision, PermissionRuleInput, PermissionRuleMatchInput } from "./permissions/store.ts";

export interface AskPermissionStore {
	addRule(input: PermissionRuleInput): Promise<unknown>;
	findDecision?(input: PermissionRuleMatchInput): PermissionRuleDecision | undefined;
}

export interface AskPermissionOptions {
	request: PermissionRequest;
	input?: Record<string, unknown>;
	uiContext?: ExtensionUIContext | null;
	emitPermissionRequest?: (
		event: PermissionRequestEvent,
	) => Promise<PermissionRequestResult | undefined> | PermissionRequestResult | undefined;
	store?: AskPermissionStore;
}

interface ActionChoice {
	action: PermissionAction;
	label: string;
	rememberOptionId?: string;
}

const ACTION_LABELS: Record<PermissionAction, string> = {
	allow_once: "Allow once",
	always_allow_project: "Always allow",
	deny_once: "Deny once",
	always_deny_project: "Always deny",
};

export async function askPermission(options: AskPermissionOptions): Promise<PermissionDecision> {
	const storedDecision = findStoredPermissionDecision(options);
	if (storedDecision) return storedDecision;

	const hookDecision = await askPermissionHook(options);
	if (hookDecision) return hookDecision;

	const choices = buildActionChoices(options.request.actions, options.request);
	if (choices.length === 0) {
		return { type: "deny", reason: `Permission request "${options.request.title}" has no available actions.` };
	}

	if (!options.uiContext) {
		return { type: "deny", reason: `Permission request "${options.request.title}" cannot be shown without UI.` };
	}

	const selected = await options.uiContext.select(
		options.request.message,
		choices.map((choice) => choice.label),
		{
			permissionMeta: buildPermissionMeta(options.request),
		},
	);
	const choice = choices.find((entry) => entry.label === selected || entry.label.startsWith(`${selected}:`));
	if (!choice) {
		return { type: "deny", reason: `User denied permission request "${options.request.title}".` };
	}

	await rememberPermissionChoice(options, choice);
	return decisionForAction(choice.action, `User selected "${ACTION_LABELS[choice.action]}".`);
}

function findStoredPermissionDecision(options: AskPermissionOptions): PermissionDecision | undefined {
	if (!options.store?.findDecision) return undefined;
	const value = getPermissionMatchValue(options.request, options.input);
	if (!value) return undefined;
	const decision = options.store.findDecision({
		provider: options.request.provider,
		subject: options.request.subject,
		value,
		scope: "project",
	});
	const sessionDecision =
		decision ??
		options.store.findDecision({
			provider: options.request.provider,
			subject: options.request.subject,
			value,
			scope: "session",
		});
	if (!sessionDecision) return undefined;
	if (sessionDecision.action === "allow") {
		return { type: "allow", reason: `Allowed by stored permission rule ${sessionDecision.rule.id}` };
	}
	return { type: "deny", reason: `Denied by stored permission rule ${sessionDecision.rule.id}` };
}

async function askPermissionHook(options: AskPermissionOptions): Promise<PermissionDecision | undefined> {
	if (!options.emitPermissionRequest) return undefined;
	try {
		const result = await options.emitPermissionRequest({
			type: "permission_request",
			toolName: getMetadataString(options.request, "toolName"),
			toolCallId: options.request.toolCallId ?? "",
			input: options.input ?? {},
			reason: options.request.subject,
			path: getMetadataString(options.request, "path"),
			request: options.request,
			subject: options.request.subject,
			title: options.request.title,
			message: options.request.message,
			actions: options.request.actions,
		});
		if (!result) return undefined;
		if (result.decision === "allow") {
			if (result.updatedInput) {
				return { type: "mutate", input: result.updatedInput, reason: result.message };
			}
			return { type: "allow", reason: result.message };
		}
		return { type: "deny", reason: result.message ?? `Permission denied by hook: ${options.request.title}` };
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return { type: "deny", reason: `Permission hook failed: ${message}` };
	}
}

function buildActionChoices(actions: PermissionAction[], request?: PermissionRequest): ActionChoice[] {
	let index = 0;
	const choices: ActionChoice[] = [];
	for (const action of actions) {
		if (action === "always_allow_project" || action === "always_deny_project") {
			const ruleAction = action === "always_allow_project" ? "allow" : "deny";
			const rememberOptions = request?.rememberOptions?.filter(
				(option) => option.action === ruleAction && option.scope === "project",
			);
			if (rememberOptions?.length) {
				for (const rememberOption of rememberOptions) {
					index += 1;
					choices.push({
						action,
						rememberOptionId: rememberOption.id,
						label: `${index}. ${ACTION_LABELS[action]}: ${rememberOption.label}`,
					});
				}
				continue;
			}
		}

		index += 1;
		choices.push({
			action,
			label: `${index}. ${ACTION_LABELS[action]}`,
		});
	}
	return choices;
}

async function rememberPermissionChoice(options: AskPermissionOptions, choice: ActionChoice): Promise<void> {
	const action = choice.action;
	if (action !== "always_allow_project" && action !== "always_deny_project") return;
	if (!options.store) return;

	const ruleAction = action === "always_allow_project" ? "allow" : "deny";
	const rememberOption =
		options.request.rememberOptions?.find((option) => option.id === choice.rememberOptionId) ??
		options.request.rememberOptions?.find((option) => option.action === ruleAction && option.scope === "project");
	if (!rememberOption) return;

	const ruleInput: PermissionRuleInput = {
		provider: options.request.provider,
		subject: rememberOption.subject,
		pattern: rememberOption.pattern,
		action: rememberOption.action,
		scope: rememberOption.scope,
		metadata: rememberOption.metadata,
	};
	try {
		await options.store.addRule(ruleInput);
	} catch (error) {
		if (rememberOption.scope !== "project" || !isProjectTrustWriteError(error)) {
			throw error;
		}
		await options.store.addRule({ ...ruleInput, scope: "session" });
	}
}

function isProjectTrustWriteError(error: unknown): boolean {
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("Project is not trusted") && message.includes("project settings");
}

function decisionForAction(action: PermissionAction, reason: string): PermissionDecision {
	if (action === "allow_once" || action === "always_allow_project") {
		return { type: "allow", reason };
	}
	return { type: "deny", reason };
}

function getMetadataString(request: PermissionRequest, key: string): string {
	const value = request.metadata?.[key];
	return typeof value === "string" ? value : "";
}

function getPermissionMatchValue(request: PermissionRequest, input?: Record<string, unknown>): string | undefined {
	const metadataValue = getMetadataString(request, "permissionValue");
	if (metadataValue) return metadataValue;
	const command = getMetadataString(request, "command");
	if (command) return command;
	const path = getMetadataString(request, "path");
	if (path) return path;
	const inputCommand = typeof input?.command === "string" ? input.command : undefined;
	if (inputCommand) return inputCommand;
	const inputPath =
		typeof input?.path === "string"
			? input.path
			: typeof input?.file_path === "string"
				? input.file_path
				: typeof input?.filePath === "string"
					? input.filePath
					: undefined;
	return inputPath;
}

function buildPermissionMeta(request: PermissionRequest): ExtensionUIPermissionMeta {
	if (request.provider === "path-access" && request.metadata?.type === "path_boundary") {
		const path = getMetadataString(request, "path");
		const cwd = getMetadataString(request, "cwd");
		const toolName = getMetadataString(request, "toolName");
		const scope = request.metadata.scope === "write" ? "write" : "read";
		return {
			type: "path_boundary",
			path,
			cwd,
			toolName,
			scope,
			relativeTo: getMetadataString(request, "relativeTo") || "outside project directory",
		};
	}

	return {
		type: "permission_runtime",
		requestId: request.requestId,
		provider: request.provider,
		subject: request.subject,
		actions: request.actions,
		rememberOptions: request.rememberOptions,
		toolCallId: request.toolCallId,
		metadata: request.metadata,
	};
}
