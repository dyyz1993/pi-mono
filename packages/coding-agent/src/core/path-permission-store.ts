import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { minimatch } from "minimatch";

export type PathPermissionDecision = "allow" | "deny";

export interface PathPermissionEntry {
	pattern: string;
	scope: "read" | "write";
	decision: PathPermissionDecision;
}

type StoreData = Record<string, PathPermissionEntry[]>;

function normalizeFilePath(filePath: string): string {
	let normalized = filePath;
	if (normalized.startsWith("file://")) {
		normalized = normalized.slice("file://".length);
	}
	const parts = normalized.split("/");
	const resolved: string[] = [];
	for (const part of parts) {
		if (part === "..") {
			if (resolved.length > 0 && resolved[resolved.length - 1] !== "") {
				resolved.pop();
			}
		} else if (part !== "." && part !== "") {
			resolved.push(part);
		} else if (part === "" && resolved.length === 0) {
			resolved.push("");
		}
	}
	if (normalized.startsWith("/")) {
		return "/" + resolved.filter((p) => p !== "").join("/");
	}
	return resolved.join("/") || ".";
}

export function matchPathGlob(filePath: string, pattern: string): boolean {
	if (pattern === "**") return true;
	const normalized = normalizeFilePath(filePath);
	const parts = normalized.split("/");
	for (let i = 0; i < parts.length; i++) {
		const subpath = parts.slice(i).join("/");
		try {
			if (minimatch(subpath, pattern, { dot: true })) {
				return true;
			}
		} catch {
			// Invalid glob pattern — treat as no match
		}
	}
	return false;
}

export class PathPermissionStore {
	private filePath: string;
	private cache: StoreData = {};
	private loaded = false;

	constructor(agentDir: string) {
		const dir = agentDir;
		if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
		this.filePath = join(dir, "path-permissions.json");
	}

	private load(): StoreData {
		if (this.loaded) return this.cache;
		this.loaded = true;
		if (!existsSync(this.filePath)) {
			this.cache = {};
			return this.cache;
		}
		try {
			this.cache = JSON.parse(readFileSync(this.filePath, "utf-8"));
		} catch {
			this.cache = {};
		}
		return this.cache;
	}

	private flush(): void {
		writeFileSync(this.filePath, JSON.stringify(this.cache, null, 2));
	}

	private key(cwd: string): string {
		return cwd;
	}

	check(cwd: string, filePath: string, scope: "read" | "write"): PathPermissionDecision | undefined {
		const entries = this.load()[this.key(cwd)];
		if (!entries) return undefined;
		for (const entry of entries) {
			if (entry.scope !== scope) continue;
			if (matchPathGlob(filePath, entry.pattern)) {
				return entry.decision;
			}
		}
		return undefined;
	}

	allow(cwd: string, pattern: string, scope: "read" | "write"): void {
		const data = this.load();
		const key = this.key(cwd);
		if (!data[key]) data[key] = [];
		data[key] = data[key].filter((e) => !(e.pattern === pattern && e.scope === scope));
		data[key].push({ pattern, scope, decision: "allow" });
		this.flush();
	}

	deny(cwd: string, pattern: string, scope: "read" | "write"): void {
		const data = this.load();
		const key = this.key(cwd);
		if (!data[key]) data[key] = [];
		data[key] = data[key].filter((e) => !(e.pattern === pattern && e.scope === scope));
		data[key].push({ pattern, scope, decision: "deny" });
		this.flush();
	}

	remove(cwd: string, pattern: string, scope: "read" | "write"): void {
		const data = this.load();
		const key = this.key(cwd);
		if (!data[key]) return;
		data[key] = data[key].filter((e) => !(e.pattern === pattern && e.scope === scope));
		if (data[key].length === 0) delete data[key];
		this.flush();
	}
}
