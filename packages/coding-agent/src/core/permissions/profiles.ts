export type BuiltinPermissionProfileName = "normal" | "autopilot" | "readonly" | "yolo";
export type PermissionProfileName = string;

/** Legacy names accepted by older agent frontmatter and CLI settings. */
export type LegacyPermissionProfileName = "auto" | "acceptEdits" | "dontAsk" | "always-allow" | "always-deny";

export type PermissionProfileInput = string;

export type BuiltinPermissionProviderId =
	| "tool-gate"
	| "stored-decision"
	| "pi-hooks"
	| "path-access"
	| "dangerous-command"
	| "readonly"
	| "auto-approver"
	| "file-time-guard";

export type PermissionProviderId = BuiltinPermissionProviderId | (string & {});

export interface PermissionProfile {
	name: PermissionProfileName;
	label?: string;
	description?: string;
	source?: "core" | `plugin:${string}` | "user";
	preProviders: PermissionProviderId[];
	postProviders: PermissionProviderId[];
	skipPathBoundaryApproval: boolean;
}

const LEGACY_PROFILE_ALIASES: Readonly<Record<LegacyPermissionProfileName, BuiltinPermissionProfileName>> = {
	auto: "normal",
	acceptEdits: "normal",
	dontAsk: "yolo",
	"always-allow": "yolo",
	"always-deny": "normal",
};

const PROFILES = new Map<PermissionProfileName, PermissionProfile>();

const BUILTIN_PROFILES: Record<BuiltinPermissionProfileName, PermissionProfile> = {
	normal: {
		name: "normal",
		label: "Request approval",
		description: "Ask or block when a provider detects a risky operation.",
		source: "core",
		preProviders: ["tool-gate", "stored-decision", "pi-hooks"],
		postProviders: ["path-access", "dangerous-command"],
		skipPathBoundaryApproval: false,
	},
	autopilot: {
		name: "autopilot",
		label: "Autopilot",
		description: "Auto-approve low-risk operations and ask for risky operations.",
		source: "core",
		preProviders: ["tool-gate", "stored-decision", "auto-approver", "pi-hooks"],
		postProviders: ["path-access", "dangerous-command"],
		skipPathBoundaryApproval: false,
	},
	readonly: {
		name: "readonly",
		label: "Read only",
		description: "Allow inspection while blocking writes and bash commands.",
		source: "core",
		preProviders: ["tool-gate", "readonly", "stored-decision", "pi-hooks"],
		postProviders: ["path-access", "dangerous-command"],
		skipPathBoundaryApproval: false,
	},
	yolo: {
		name: "yolo",
		label: "Full access",
		description: "Skip dangerous-command prompts while keeping hard tool and path gates.",
		source: "core",
		preProviders: ["tool-gate", "stored-decision", "pi-hooks"],
		postProviders: ["path-access"],
		skipPathBoundaryApproval: true,
	},
};

for (const profile of Object.values(BUILTIN_PROFILES)) {
	PROFILES.set(profile.name, profile);
}

function normalizeLegacyProfileAlias(value: string): PermissionProfileName | undefined {
	return LEGACY_PROFILE_ALIASES[value as LegacyPermissionProfileName];
}

export function isPermissionProfileInput(value: string): value is PermissionProfileInput {
	return PROFILES.has(value) || Boolean(normalizeLegacyProfileAlias(value));
}

export function normalizePermissionProfile(value: string | undefined): PermissionProfileName {
	if (!value) return "normal";
	return normalizeLegacyProfileAlias(value) ?? (PROFILES.has(value) ? value : "normal");
}

export function getPermissionProfile(value: string | undefined): PermissionProfile {
	return PROFILES.get(normalizePermissionProfile(value)) ?? BUILTIN_PROFILES.normal;
}

export function listPermissionProfiles(): PermissionProfile[] {
	return [...PROFILES.values()];
}

export function registerPermissionProfile(profile: PermissionProfile): void {
	const name = profile.name.trim();
	if (!name) throw new Error("Permission profile name cannot be empty.");
	PROFILES.set(name, { ...profile, name });
}
