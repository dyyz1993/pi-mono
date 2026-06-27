import { isAbsolute, resolve } from "node:path";
import { homedir } from "node:os";
import {
	findDangerousCommandMatch,
	normalizePermissionPath,
	type ExtensionAPI,
	type PermissionProvider,
} from "@dyyz1993/pi-coding-agent";

const READ_ONLY_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
const SYSTEM_PATH_PREFIXES = [
	"/bin",
	"/dev",
	"/etc",
	"/Library",
	"/opt",
	"/private/etc",
	"/private/var",
	"/sbin",
	"/System",
	"/usr",
	"/var",
];
const SENSITIVE_PATH_PARTS = [
	"/.aws/",
	"/.config/opencode/",
	"/.docker/",
	"/.gnupg/",
	"/.kube/",
	"/.netrc",
	"/.npmrc",
	"/.ssh/",
	"/credentials",
	"/id_rsa",
	"/id_ed25519",
];

export default function autoApproverExtension(pi: ExtensionAPI): void {
	pi.setName("auto-approver");
	pi.permissions.registerProvider(createAutoApproverProvider());
}

function createAutoApproverProvider(): PermissionProvider {
	return {
		name: "auto-approver",
		check(ctx) {
			if (ctx.permissionProfile !== "autopilot") return { type: "pass" };
			const toolName = ctx.toolName.toLowerCase();

			if (READ_ONLY_TOOLS.has(toolName)) {
				if (ctx.agent?.paths?.read?.length) return { type: "pass" };
				return { type: "allow", reason: `Auto-approved low-risk read tool "${ctx.toolName}".` };
			}

			if (WRITE_TOOLS.has(toolName)) {
				if (ctx.agent?.paths?.write?.length) return { type: "pass" };
				const rawPath = getPathArg(ctx.input);
				if (!rawPath) return { type: "pass" };
				const normalizedPath = resolveAgainstCwd(ctx.cwd, rawPath);
				if (normalizedPath === ctx.cwd || normalizedPath.startsWith(`${ctx.cwd}/`)) {
					return { type: "allow", reason: `Auto-approved workspace write tool "${ctx.toolName}".` };
				}
				const pathDecision = decidePath(normalizedPath);
				if (pathDecision === "allow") {
					return { type: "allow", reason: `Auto-approved user-writable path "${normalizedPath}".` };
				}
				if (pathDecision === "deny") {
					return { type: "deny", reason: "Autopilot blocked protected or sensitive path." };
				}
				return { type: "pass" };
			}

			if (toolName === "bash") {
				const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
				if (!command) return { type: "pass" };
				const dangerous = findDangerousCommandMatch(command);
				if (dangerous) {
					const commandDecision = decideDangerousCommand(command);
					if (commandDecision === "allow") {
						return { type: "allow", reason: "Auto-approved bounded dangerous command." };
					}
					if (commandDecision === "deny") {
						return {
							type: "deny",
							reason: `Autopilot blocked dangerous bash command: ${formatDangerousCommandReason(dangerous.description)}.`,
						};
					}
					return { type: "pass" };
				}
				return { type: "allow", reason: "Auto-approved bash command without dangerous patterns." };
			}

			return { type: "pass" };
		},
	};
}

function getPathArg(input: Record<string, unknown>): string | undefined {
	const candidates = [
		input.path,
		input.file_path,
		input.filePath,
		input.target_file,
		input.targetFile,
		input.source,
		input.destination,
	];
	return candidates.find((value): value is string => typeof value === "string" && value.length > 0);
}

function resolveAgainstCwd(cwd: string, filePath: string): string {
	const normalized = normalizePermissionPath(filePath);
	if (isAbsolute(normalized)) return normalized;
	return normalizePermissionPath(resolve(cwd, normalized));
}

type AutoDecision = "allow" | "deny" | "pass";

function formatDangerousCommandReason(description: string): string {
	if (description === "sudo") return "sudo requires administrator privileges";
	if (description === "chmod 777") return "chmod 777 grants broad write or execute access";
	if (description === "force push") return "force push can overwrite remote history";
	if (description === "recursive rm") return "recursive removal can delete many files";
	if (description === "environment file access") return "environment files may contain secrets";
	if (description === "credentials access") return "credential files may contain secrets";
	return description;
}

function decidePath(filePath: string): AutoDecision {
	if (isProtectedPath(filePath) || isSensitivePath(filePath)) return "deny";
	if (isInside(filePath, normalizePermissionPath(homedir()))) return "allow";
	if (isInside(filePath, "/tmp")) return "allow";
	return "pass";
}

function decideDangerousCommand(command: string): AutoDecision {
	if (/\bsudo\b/.test(command)) return "deny";
	if (/\bchmod\s+777\b/.test(command)) return "deny";
	if (/\.env\b|credentials/i.test(command)) return "deny";
	if (/\b(curl|wget)\b[^|;&]*\|\s*(sh|bash)\b/.test(command)) return "deny";

	const rmTargets = getRecursiveRmTargets(command);
	if (rmTargets.length > 0) {
		return rmTargets.every((target) => isTempPath(target)) ? "allow" : "deny";
	}

	if (/\bgit\s+push\s+.*--force\b/.test(command)) return "deny";
	if (/--no-verify/.test(command)) return "allow";

	return "pass";
}

function getRecursiveRmTargets(command: string): string[] {
	const tokens = command.match(/"[^"]*"|'[^']*'|[^\s]+/g) ?? [];
	const targets: string[] = [];
	for (let i = 0; i < tokens.length; i++) {
		if (tokens[i] !== "rm") continue;
		let recursive = false;
		for (let j = i + 1; j < tokens.length; j++) {
			const token = stripQuotes(tokens[j]);
			if (token === "--") continue;
			if (token.startsWith("-")) {
				if (token === "--recursive" || /r|R/.test(token.replace(/^-+/, ""))) recursive = true;
				continue;
			}
			if (recursive) targets.push(normalizePermissionPath(token));
		}
	}
	return targets;
}

function stripQuotes(value: string): string {
	if (
		(value.startsWith('"') && value.endsWith('"')) ||
		(value.startsWith("'") && value.endsWith("'"))
	) {
		return value.slice(1, -1);
	}
	return value;
}

function isTempPath(filePath: string): boolean {
	return isInside(filePath, "/tmp") || isInside(filePath, "/private/tmp");
}

function isProtectedPath(filePath: string): boolean {
	if (filePath === "/") return true;
	return SYSTEM_PATH_PREFIXES.some((prefix) => filePath === prefix || filePath.startsWith(`${prefix}/`));
}

function isSensitivePath(filePath: string): boolean {
	const lower = filePath.toLowerCase();
	return SENSITIVE_PATH_PARTS.some((part) => lower.includes(part.toLowerCase()));
}

function isInside(filePath: string, parent: string): boolean {
	return filePath === parent || filePath.startsWith(`${parent}/`);
}
