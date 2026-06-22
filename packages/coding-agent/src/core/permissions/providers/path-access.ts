import { getPathArg as getPathArgFromHelpers } from "../../../utils/type-helpers.ts";
import { matchesAnyPathPattern, normalizePermissionPath } from "../path-patterns.ts";
import type { PermissionProvider } from "../provider.ts";
import type { PermissionContext } from "../types.ts";

const WRITE_TOOLS = new Set(["edit", "write", "multiedit", "patch"]);
const READ_TOOLS = new Set(["read"]);
const SKIP_PATH_TOOLS = new Set(["grep", "glob", "find", "ls"]);

export interface PathAccessProviderOptions {
	name?: string;
	priority?: number;
}

export function createPathAccessProvider(options: PathAccessProviderOptions = {}): PermissionProvider {
	return {
		name: options.name ?? "path-access",
		priority: options.priority,
		check(ctx) {
			const paths = ctx.agent?.paths;
			if (!paths) return { type: "pass" };
			const toolName = ctx.toolName.toLowerCase();

			if (WRITE_TOOLS.has(toolName)) {
				const writePaths = paths.write;
				if (!writePaths || writePaths.length === 0) return { type: "pass" };
				const rawPath = getPathArgFromHelpers(ctx.input);
				if (!rawPath) return { type: "pass" };
				const normalized = normalizePermissionPath(rawPath);
				if (matchesAnyPathPattern(normalized, writePaths)) return { type: "pass" };
				return {
					type: "deny",
					reason: `Path ${normalized} is not in the allowed write paths: ${writePaths.join(", ")}`,
				};
			}

			if (READ_TOOLS.has(toolName)) {
				const readPaths = paths.read;
				if (!readPaths || readPaths.length === 0) return { type: "pass" };
				const rawPath = getPathArgFromHelpers(ctx.input);
				if (!rawPath) return { type: "pass" };
				const normalized = normalizePermissionPath(rawPath);
				if (matchesAnyPathPattern(normalized, readPaths)) return { type: "pass" };
				return {
					type: "deny",
					reason: `Path ${normalized} is not in the allowed read paths: ${readPaths.join(", ")}`,
				};
			}

			if (SKIP_PATH_TOOLS.has(toolName)) return { type: "pass" };

			return { type: "pass" };
		},
	};
}
