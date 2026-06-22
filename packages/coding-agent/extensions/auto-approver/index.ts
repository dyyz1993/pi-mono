import { isAbsolute, resolve } from "node:path";
import {
	findDangerousCommandMatch,
	normalizePermissionPath,
	type ExtensionAPI,
	type PermissionProvider,
} from "@dyyz1993/pi-coding-agent";

const READ_ONLY_TOOLS = new Set(["read", "grep", "glob", "find", "ls"]);
const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);

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
				return { type: "pass" };
			}

			if (toolName === "bash") {
				const command = typeof ctx.input.command === "string" ? ctx.input.command : undefined;
				if (!command || findDangerousCommandMatch(command)) return { type: "pass" };
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
