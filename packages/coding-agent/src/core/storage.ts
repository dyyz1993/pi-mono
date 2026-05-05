import { existsSync, mkdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import { findCanonicalGitRoot, getAgentDir } from "../config.js";

export interface StoragePaths {
	userDir(): string;
	projectDir(storeId: string): string;
	localDir(): string;
	agentDir(agentType: string): string;
	cacheDir(): string;
	projectRoot(): string;
	cwd(): string;
}

function fnv1aHash(input: string): string {
	let hash = 0x811c9dc5;
	for (let i = 0; i < input.length; i++) {
		hash ^= input.charCodeAt(i);
		hash = Math.imul(hash, 0x01000193);
	}
	return (hash >>> 0).toString(16).padStart(8, "0");
}

function sanitizeBasename(path: string): string {
	return basename(path)
		.replace(/[^a-zA-Z0-9._-]/g, "_")
		.slice(0, 48);
}

export function resolveProjectIdentity(cwd: string): string {
	return findCanonicalGitRoot(cwd) ?? realpathSync(cwd);
}

export function encodeProjectPath(projectPath: string): string {
	const hash = fnv1aHash(projectPath);
	const name = sanitizeBasename(projectPath);
	return `${hash}--${name}`;
}

/**
 * Resolve the project root directory.
 * If cwd is inside a git worktree, returns the main repo root.
 * If not a git repo, returns cwd.
 */
export function resolveProjectRoot(cwd: string): string {
	return findCanonicalGitRoot(cwd) ?? cwd;
}

/**
 * Get the per-session data directory for extension storage.
 * Path: <sessionDir>/data/<sessionId>/
 * The directory is created automatically.
 */
export function getSessionDataDir(sessionDir: string, sessionId: string, extName: string): string {
	const dir = join(sessionDir, "data", sessionId, extName);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Get the per-project data directory for extension storage.
 * Path: ~/.pi/agent/project-data/<encoded-project-root>/
 * The directory is created automatically.
 */
export function getProjectDataDir(projectRoot: string, extName: string): string {
	const encoded = encodeProjectPath(projectRoot);
	const dir = join(getAgentDir(), "project-data", encoded, extName);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Get the per-cwd data directory for extension storage.
 * Uses the actual cwd (not canonical git root) as the key.
 * In a normal repo, this is the same as projectDataDir.
 * In a worktree, this provides isolation from the main repo and other worktrees.
 * Path: ~/.pi/agent/cwd-data/<encoded-cwd>/
 * The directory is created automatically.
 */
export function getCwdDataDir(cwd: string, extName: string): string {
	const encoded = encodeProjectPath(cwd);
	const dir = join(getAgentDir(), "cwd-data", encoded, extName);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

/**
 * Get the global data directory for extension storage.
 * This directory is shared across all projects and sessions.
 * Path: ~/.pi/agent/global-data/
 * The directory is created automatically.
 */
export function getGlobalDataDir(extName: string): string {
	const dir = join(getAgentDir(), "extensions-data", extName);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true });
	}
	return dir;
}

export class ExtensionStorage implements StoragePaths {
	private readonly _cwd: string;
	private readonly _projectRoot: string;

	constructor(cwd: string) {
		this._cwd = cwd;
		this._projectRoot = resolveProjectIdentity(cwd);
	}

	userDir(): string {
		return getAgentDir();
	}

	projectDir(storeId: string): string {
		const encoded = encodeProjectPath(this._projectRoot);
		return join(getAgentDir(), storeId, encoded);
	}

	localDir(): string {
		return join(this._cwd, ".pi");
	}

	agentDir(agentType: string): string {
		return this.projectDir(`agent-${agentType}`);
	}

	cacheDir(): string {
		return join(getAgentDir(), "cache");
	}

	projectRoot(): string {
		return this._projectRoot;
	}

	cwd(): string {
		return this._cwd;
	}
}
