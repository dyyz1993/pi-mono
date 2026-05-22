import { extname } from "node:path";
import type { ResolvedLspServerConfig } from "../config/resolver.js";
import type { LspRuntimeRegistry } from "../client/registry.js";

export interface LazyActivatorOptions {
	primaryThreshold?: number;
}

export interface EnsureResult {
	name: string;
	started: boolean;
}

export interface LazyActivator {
	buildIndex(servers: ResolvedLspServerConfig[]): void;
	markPrimary(extensionCounts: Map<string, number>): void;
	startPrimaryServers(): Promise<string[]>;
	ensureServerForFile(filePath: string): Promise<EnsureResult[]>;
	getServerNamesForExt(ext: string): string[];
	getPrimaryServerNames(): string[];
	getExtMap(): Map<string, string[]>;
}

export function createLazyActivator(
	runtime: LspRuntimeRegistry,
	options: LazyActivatorOptions = {},
): LazyActivator {
	const primaryThreshold = options.primaryThreshold ?? 2;

	const extMap = new Map<string, string[]>();
	const serverConfigMap = new Map<string, ResolvedLspServerConfig>();
	const primaryNames = new Set<string>();

	return {
		buildIndex(servers: ResolvedLspServerConfig[]): void {
			extMap.clear();
			serverConfigMap.clear();

			for (const server of servers) {
				serverConfigMap.set(server.name, server);
				if (!server.fileTypes || server.fileTypes.length === 0) continue;
				for (const ft of server.fileTypes) {
					const normalized = ft.toLowerCase();
					const existing = extMap.get(normalized) ?? [];
					if (!existing.includes(server.name)) {
						existing.push(server.name);
					}
					extMap.set(normalized, existing);
				}
			}
		},

		markPrimary(extensionCounts: Map<string, number>): void {
			primaryNames.clear();

			const sorted = [...extensionCounts.entries()].sort((a, b) => b[1] - a[1]);

			const threshold = Math.min(primaryThreshold, sorted.length);

			for (let i = 0; i < threshold; i++) {
				const [ext] = sorted[i];
				const serverNames = extMap.get(ext);
				if (serverNames) {
					for (const name of serverNames) {
						primaryNames.add(name);
					}
				}
			}
		},

		async startPrimaryServers(): Promise<string[]> {
			const started: string[] = [];
			for (const name of primaryNames) {
				const config = serverConfigMap.get(name);
				if (!config) continue;
				try {
					await runtime.startSingle(name, config.command, config.fileTypes);
					runtime.setPrimary(name);
					started.push(name);
				} catch (err) {
					console.warn(`[lsp] Failed to start primary server "${name}":`, err);
				}
			}
			return started;
		},

		async ensureServerForFile(filePath: string): Promise<EnsureResult[]> {
			const ext = extname(filePath).toLowerCase();
			if (!ext) return [];

			const serverNames = extMap.get(ext);
			if (!serverNames || serverNames.length === 0) return [];

			const results: EnsureResult[] = [];
			for (const name of serverNames) {
				const config = serverConfigMap.get(name);
				if (!config) continue;

				try {
					const meta = runtime.getEntryMeta(name);
					if (meta) {
						runtime.touchAccess(name);
						results.push({ name, started: false });
					} else {
						await runtime.startSingle(name, config.command, config.fileTypes);
						results.push({ name, started: true });
					}
				} catch (err) {
					console.warn(`[lsp] Failed to ensure server "${name}":`, err);
				}
			}
			return results;
		},

		getServerNamesForExt(ext: string): string[] {
			return extMap.get(ext.toLowerCase()) ?? [];
		},

		getPrimaryServerNames(): string[] {
			return [...primaryNames];
		},

		getExtMap(): Map<string, string[]> {
			return new Map(extMap);
		},
	};
}
