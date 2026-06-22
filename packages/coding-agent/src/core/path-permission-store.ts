import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalizePath, resolvePath } from "../utils/paths.ts";
import { matchPathGlob } from "./permissions/path-patterns.ts";
import { encodeProjectPath } from "./storage.ts";

export type PathPermissionDecision = "allow" | "deny";

export interface PathPermissionEntry {
	pattern: string;
	scope: "read" | "write";
	decision: PathPermissionDecision;
}

type StoreData = Record<string, PathPermissionEntry[]>;

export { matchPathGlob };

export class PathPermissionStore {
	private agentDir: string;
	private legacyFilePath: string;
	private legacyCache: StoreData = {};
	private legacyLoaded = false;
	private projectCache = new Map<string, PathPermissionEntry[]>();

	constructor(agentDir: string) {
		this.agentDir = agentDir;
		if (!existsSync(agentDir)) mkdirSync(agentDir, { recursive: true });
		this.legacyFilePath = join(agentDir, "path-permissions.json");
	}

	private normalizeCwd(cwd: string): string {
		return canonicalizePath(resolvePath(cwd));
	}

	private projectFilePath(cwd: string): string {
		return join(this.agentDir, "projects", encodeProjectPath(this.normalizeCwd(cwd)), "path-permissions.json");
	}

	private loadProject(cwd: string): PathPermissionEntry[] {
		const key = this.normalizeCwd(cwd);
		const cached = this.projectCache.get(key);
		if (cached) return cached;
		const filePath = this.projectFilePath(key);
		if (!existsSync(filePath)) {
			this.projectCache.set(key, []);
			return [];
		}
		try {
			const parsed = JSON.parse(readFileSync(filePath, "utf-8"));
			const entries = Array.isArray(parsed) ? parsed : [];
			this.projectCache.set(key, entries);
			return entries;
		} catch {
			this.projectCache.set(key, []);
			return [];
		}
	}

	private loadLegacy(): StoreData {
		if (this.legacyLoaded) return this.legacyCache;
		this.legacyLoaded = true;
		if (!existsSync(this.legacyFilePath)) {
			this.legacyCache = {};
			return this.legacyCache;
		}
		try {
			this.legacyCache = JSON.parse(readFileSync(this.legacyFilePath, "utf-8"));
		} catch {
			this.legacyCache = {};
		}
		return this.legacyCache;
	}

	private flushProject(cwd: string, entries: PathPermissionEntry[]): void {
		const key = this.normalizeCwd(cwd);
		const filePath = this.projectFilePath(key);
		mkdirSync(dirname(filePath), { recursive: true });
		this.projectCache.set(key, entries);
		writeFileSync(filePath, JSON.stringify(entries, null, 2));
	}

	check(cwd: string, filePath: string, scope: "read" | "write"): PathPermissionDecision | undefined {
		for (const entry of [...this.loadProject(cwd), ...(this.loadLegacy()[this.normalizeCwd(cwd)] ?? [])]) {
			if (entry.scope !== scope) continue;
			if (matchPathGlob(filePath, entry.pattern)) {
				return entry.decision;
			}
		}
		return undefined;
	}

	allow(cwd: string, pattern: string, scope: "read" | "write"): void {
		const entries = this.loadProject(cwd).filter((e) => !(e.pattern === pattern && e.scope === scope));
		entries.push({ pattern, scope, decision: "allow" });
		this.flushProject(cwd, entries);
	}

	deny(cwd: string, pattern: string, scope: "read" | "write"): void {
		const entries = this.loadProject(cwd).filter((e) => !(e.pattern === pattern && e.scope === scope));
		entries.push({ pattern, scope, decision: "deny" });
		this.flushProject(cwd, entries);
	}

	remove(cwd: string, pattern: string, scope: "read" | "write"): void {
		const entries = this.loadProject(cwd).filter((e) => !(e.pattern === pattern && e.scope === scope));
		this.flushProject(cwd, entries);
	}
}
