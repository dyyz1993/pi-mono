import { realpathSync } from "node:fs";
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
