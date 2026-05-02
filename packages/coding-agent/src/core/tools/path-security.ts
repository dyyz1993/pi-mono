import { realpathSync, statSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

export type PathSecurityViolation = "null_byte" | "not_within_sandbox" | "symlink_escape" | "empty_path";

export class PathSecurityError extends Error {
	readonly violation: PathSecurityViolation;

	constructor(violation: PathSecurityViolation, message: string) {
		super(message);
		this.name = "PathSecurityError";
		this.violation = violation;
	}
}

export function sanitizePath(input: string): string {
	if (input.includes("\0")) {
		throw new PathSecurityError("null_byte", "Path contains null bytes");
	}
	return normalize(input.normalize("NFC"));
}

export function sanitizeFilename(filename: string): string {
	if (filename.includes("\0")) {
		throw new PathSecurityError("null_byte", "Filename contains null bytes");
	}
	if (!filename) {
		throw new PathSecurityError("empty_path", "Filename is empty");
	}
	if (filename === ".." || filename.includes("..")) {
		throw new PathSecurityError("not_within_sandbox", `Filename contains traversal: ${filename}`);
	}
	if (normalize(filename) !== filename) {
		throw new PathSecurityError("not_within_sandbox", `Filename is not normalized: ${filename}`);
	}
	if (filename.startsWith("/")) {
		throw new PathSecurityError("not_within_sandbox", `Filename is absolute: ${filename}`);
	}
	if (filename.includes("/") || filename.includes("\\")) {
		throw new PathSecurityError("not_within_sandbox", `Filename contains path separators: ${filename}`);
	}
	return filename;
}

export function isWithinSandboxSync(filePath: string, sandboxDir: string): boolean {
	const rel = relative(sandboxDir, filePath);
	return !rel.startsWith("..") && !normalize(rel).startsWith("..");
}

async function realpathDeepestExisting(filePath: string): Promise<string> {
	let dir = filePath;
	while (dir !== dirname(dir)) {
		try {
			statSync(dir);
			return realpathSync(dir);
		} catch {
			dir = dirname(dir);
		}
	}
	return dir;
}

export async function isWithinSandbox(
	filePath: string,
	sandboxDir: string,
	options?: { resolveSymlinks?: boolean },
): Promise<boolean> {
	const shouldResolve = options?.resolveSymlinks ?? true;
	if (!shouldResolve) {
		return isWithinSandboxSync(filePath, sandboxDir);
	}

	const resolvedSandbox = await realpath(sandboxDir).catch(() => sandboxDir);
	const resolvedFile = await realpathDeepestExisting(filePath);
	const fullResolved = await realpath(resolvedFile).catch(() => resolvedFile);
	const rel = relative(resolvedSandbox, fullResolved);
	return !rel.startsWith("..") && !normalize(rel).startsWith("..");
}

export async function safeJoin(
	sandboxDir: string,
	filename: string,
	options?: { resolveSymlinks?: boolean },
): Promise<string> {
	const clean = sanitizeFilename(filename);
	const joined = join(sandboxDir, clean);
	const within = await isWithinSandbox(joined, sandboxDir, options);
	if (!within) {
		throw new PathSecurityError("not_within_sandbox", `Path escapes sandbox: ${joined}`);
	}
	return joined;
}
