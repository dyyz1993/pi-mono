/**
 * LSP Extension for pi-mono
 *
 * Integrates Language Server Protocol (LSP) support into pi coding agent.
 * Provides code intelligence features (diagnostics, go-to-definition,
 * references, hover, symbols) by spawning and managing LSP server processes.
 *
 * Based on opencode's LSP implementation, adapted as a pi extension plugin.
 *
 * Features:
 * - 25+ built-in LSP server definitions (TypeScript, Python, Go, Rust, etc.)
 * - Lazy server spawning on first file touch
 * - Automatic diagnostics feedback after file write/edit
 * - AI tool for LSP operations (goToDefinition, findReferences, hover, etc.)
 * - /lsp-status command to view connected servers
 * - Per-root server instances for monorepo support
 *
 * Usage:
 *   - LSP starts automatically when you work with supported file types
 *   - Diagnostics are automatically collected after write/edit operations
 *   - Use the "lsp" tool for code navigation (definition, references, hover)
 *   - Run "/lsp-status" to see connected LSP servers
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import * as fs from "fs/promises";

import { LspClient } from "./client.js";
import { LspServers } from "./servers.js";
import type {
	Diagnostic,
	ServerInfo,
	LspStatus,
	Range,
	SymbolInfo,
	DocumentSymbolInfo,
} from "./types.js";

interface LspState {
	clients: LspClient[];
	broken: Set<string>;
	spawning: Map<string, Promise<LspClient | undefined>>;
	cwd: string;
	diagnosticsListeners: Array<(serverID: string, filePath: string) => void>;
}

function createLspState(cwd: string): LspState {
	return {
		clients: [],
		broken: new Set(),
		spawning: new Map(),
		cwd,
		diagnosticsListeners: [],
	};
}

export function prettyDiagnostic(d: Diagnostic): string {
	const severityMap: Record<number, string> = {
		1: "ERROR",
		2: "WARN",
		3: "INFO",
		4: "HINT",
	};
	const severity = severityMap[d.severity ?? 1];
	const line = d.range.start.line + 1;
	const col = d.range.start.character + 1;
	return `${severity} [${line}:${col}] ${d.message}`;
}

async function getClients(state: LspState, file: string): Promise<LspClient[]> {
	const extension = path.extname(file) || file;
	const result: LspClient[] = [];

	for (const server of Object.values(LspServers)) {
		if (server.extensions.length && !server.extensions.includes(extension)) continue;

		const root = await server.root(file);
		if (!root) continue;
		if (state.broken.has(root + server.id)) continue;

		const match = state.clients.find((c) => c.root === root && c.serverID === server.id);
		if (match) {
			result.push(match);
			continue;
		}

		const inflight = state.spawning.get(root + server.id);
		if (inflight) {
			const client = await inflight;
			if (client) result.push(client);
			continue;
		}

		const task = scheduleServer(state, server, root);
		state.spawning.set(root + server.id, task);

		task.finally(() => {
			if (state.spawning.get(root + server.id) === task) {
				state.spawning.delete(root + server.id);
			}
		});

		const client = await task;
		if (client) result.push(client);
	}

	return result;
}

async function scheduleServer(
	state: LspState,
	server: ServerInfo,
	root: string,
): Promise<LspClient | undefined> {
	const key = root + server.id;

	const handle = await server
		.spawn(root)
		.then((value) => {
			if (!value) state.broken.add(key);
			return value;
		})
		.catch(() => {
			state.broken.add(key);
			return undefined;
		});

	if (!handle) return undefined;

	const client = await LspClient.create({
		serverID: server.id,
		server: handle,
		root,
		cwd: state.cwd,
		onDiagnostics: (sid, fpath) => {
			for (const listener of state.diagnosticsListeners) {
				listener(sid, fpath);
			}
		},
	}).catch(() => {
		state.broken.add(key);
		handle.process.kill();
		return undefined;
	});

	if (!client) {
		handle.process.kill();
		return undefined;
	}

	const existing = state.clients.find((c) => c.root === root && c.serverID === server.id);
	if (existing) {
		handle.process.kill();
		return existing;
	}

	state.clients.push(client);
	return client;
}

async function collectDiagnostics(state: LspState): Promise<Record<string, Diagnostic[]>> {
	const results: Record<string, Diagnostic[]> = {};
	for (const client of state.clients) {
		for (const [filePath, diags] of client.diagnostics.entries()) {
			const arr = results[filePath] || [];
			arr.push(...diags);
			results[filePath] = arr;
		}
	}
	return results;
}

export default function lspExtension(pi: ExtensionAPI) {
	let state: LspState;

	pi.on("session_start", async (_event, ctx) => {
		state = createLspState(ctx.cwd);
	});

	pi.on("tool_call", async (event, ctx) => {
		if (!state) return;

		let filePath: string | undefined;

		if (event.toolName === "write") {
			filePath = (event as any).input?.path as string | undefined;
		} else if (event.toolName === "edit") {
			filePath = (event as any).input?.path as string | undefined;
		} else {
			return;
		}

		if (!filePath || typeof filePath !== "string") return;

		const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);

		try {
			await fs.access(absPath);
		} catch {
			return;
		}

		const clients = await getClients(state, absPath);
		if (clients.length === 0) return;

		await Promise.all(
			clients.map(async (client) => {
				const wait = client.waitForDiagnostics({ path: absPath });
				await client.notify.open({ path: absPath });
				return wait;
			}),
		).catch(() => {});
	});

	pi.registerTool({
		name: "lsp",
		label: "LSP Code Intelligence",
		description:
			"Interact with Language Server Protocol (LSP) servers for code intelligence. Supports goToDefinition, findReferences, hover, documentSymbol, workspaceSymbol, goToImplementation.",
		parameters: Type.Object({
			operation: Type.Union([
				Type.Literal("goToDefinition"),
				Type.Literal("findReferences"),
				Type.Literal("hover"),
				Type.Literal("documentSymbol"),
				Type.Literal("workspaceSymbol"),
				Type.Literal("goToImplementation"),
			]).describe("The LSP operation to perform"),
			filePath: Type.String().describe("The absolute or relative path to the file"),
			line: Type.Integer().describe("The line number (1-based)"),
			character: Type.Integer().describe("The character offset (1-based)"),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!state) {
				return { content: [{ type: "text" as const, text: "LSP not initialized" }], details: undefined };
			}

			const file = path.isAbsolute(params.filePath)
				? params.filePath
				: path.resolve(ctx.cwd, params.filePath);

			try {
				await fs.access(file);
			} catch {
				return {
					content: [{ type: "text" as const, text: `File not found: ${params.filePath}` }],
					details: undefined,
				};
			}

			const uri = pathToFileURL(file).href;
			const position = { line: params.line - 1, character: params.character - 1 };

			const clients = await getClients(state, file);
			if (clients.length === 0) {
				return {
					content: [
						{
							type: "text" as const,
							text: `No LSP server available for "${path.extname(file)}". Supported extensions: ${[
								...new Set(Object.values(LspServers).flatMap((s) => s.extensions)),
							].join(", ")}`,
						},
					],
					details: undefined,
				};
			}

			await Promise.all(
				clients.map(async (c) => {
					await c.notify.open({ path: file });
				}),
			);

			const result: unknown[] = await (async () => {
				switch (params.operation) {
					case "goToDefinition":
						return Promise.all(
							clients.map((c) =>
								c.connection
									.sendRequest("textDocument/definition", {
										textDocument: { uri },
										position: { line: position.line, character: position.character },
									})
									.catch(() => null),
							),
						);
					case "findReferences":
						return Promise.all(
							clients.map((c) =>
								c.connection
									.sendRequest("textDocument/references", {
										textDocument: { uri },
										position: { line: position.line, character: position.character },
										context: { includeDeclaration: true },
									})
									.catch(() => []),
							),
						);
					case "hover":
						return Promise.all(
							clients.map((c) =>
								c.connection
									.sendRequest("textDocument/hover", {
										textDocument: { uri },
										position: { line: position.line, character: position.character },
									})
									.catch(() => null),
							),
						);
					case "documentSymbol":
						return Promise.all(
							clients.map((c) =>
								c.connection
									.sendRequest("textDocument/documentSymbol", { textDocument: { uri } })
									.catch(() => []),
							),
						);
					case "workspaceSymbol":
						return Promise.all(
							clients.map((c) =>
								c.connection.sendRequest("workspace/symbol", { query: "" }).catch(() => []),
							),
						);
					case "goToImplementation":
						return Promise.all(
							clients.map((c) =>
								c.connection
									.sendRequest("textDocument/implementation", {
										textDocument: { uri },
										position: { line: position.line, character: position.character },
									})
									.catch(() => null),
							),
						);
					default:
						return [];
				}
			})();

			const flat = result.flat().filter(Boolean);

			if (flat.length === 0) {
				return {
					content: [{ type: "text" as const, text: `No results found for ${params.operation}` }],
					details: undefined,
				};
			}

			const formatted = formatLspResult(params.operation, flat, ctx.cwd);
			return {
				content: [{ type: "text" as const, text: formatted }],
				details: undefined,
			};
		},
	});

	pi.registerCommand("lsp-status", {
		description: "Show connected LSP server status and recent diagnostics",
		handler: async (_args, ctx) => {
			if (!state) {
				ctx.ui.notify("LSP not initialized", "error");
				return;
			}

			const status = getLspStatus(state);
			const diags = await collectDiagnostics(state);

			const lines: string[] = [];
			lines.push("=== LSP Server Status ===");

			if (status.length === 0) {
				lines.push("No LSP servers connected.");
				lines.push("");
				lines.push("Supported languages:");
				const langMap = new Map<string, string[]>();
				for (const server of Object.values(LspServers)) {
					for (const ext of server.extensions) {
						const existing = langMap.get(ext) ?? [];
						existing.push(server.id);
						langMap.set(ext, existing);
					}
				}
				for (const [ext, ids] of langMap) {
					lines.push(`  ${ext}: ${ids.join(", ")}`);
				}
			} else {
				for (const s of status) {
					lines.push(`  [${s.status}] ${s.name} (${s.id}) @ ${s.root}`);
				}
			}

			if (Object.keys(diags).length > 0) {
				lines.push("");
				lines.push("=== Recent Diagnostics ===");
				let totalErrors = 0;
				let totalWarnings = 0;
				for (const [, fileDiags] of Object.entries(diags)) {
					for (const d of fileDiags) {
						if ((d.severity ?? 1) <= 1) totalErrors++;
						else if ((d.severity ?? 1) <= 2) totalWarnings++;
					}
				}
				lines.push(`  Errors: ${totalErrors}, Warnings: ${totalWarnings}`);

				for (const [file, fileDiags] of Object.entries(diags)) {
					const relPath = path.relative(ctx.cwd, file);
					const errors = fileDiags.filter((d) => (d.severity ?? 1) <= 2);
					if (errors.length > 0) {
						lines.push(``);
						lines.push(`  ${relPath}:`);
						for (const d of errors.slice(0, 10)) {
							lines.push(`    ${prettyDiagnostic(d)}`);
						}
						if (errors.length > 10) {
							lines.push(`    ... and ${errors.length - 10} more`);
						}
					}
				}
			}

			ctx.ui.notify(lines.join("\n"), "info");
		},
	});

	pi.registerCommand("lsp-diagnostics", {
		description: "Show LSP diagnostics for a specific file",
		handler: async (args, ctx) => {
			if (!state) {
				ctx.ui.notify("LSP not initialized", "error");
				return;
			}

			const filePath = args?.trim();
			if (!filePath) {
				ctx.ui.notify("Usage: /lsp-diagnostics <file-path>", "error");
				return;
			}

			const absPath = path.isAbsolute(filePath) ? filePath : path.resolve(ctx.cwd, filePath);

			const clients = await getClients(state, absPath);
			if (clients.length === 0) {
				ctx.ui.notify(`No LSP server available for "${path.extname(absPath)}"`, "warning");
				return;
			}

			await Promise.all(
				clients.map(async (c) => {
					await c.notify.open({ path: absPath });
					return c.waitForDiagnostics({ path: absPath });
				}),
			);

			const allDiags: Diagnostic[] = [];
			for (const client of clients) {
				const diags = client.diagnostics.get(absPath);
				if (diags) allDiags.push(...diags);
			}

			if (allDiags.length === 0) {
				ctx.ui.notify(`No diagnostics for ${filePath}`, "info");
				return;
			}

			const lines: string[] = [`Diagnostics for ${filePath} (${allDiags.length}):`];
			for (const d of allDiags.sort((a, b) => (a.severity ?? 1) - (b.severity ?? 1))) {
				lines.push(`  ${prettyDiagnostic(d)}`);
			}

			ctx.ui.notify(lines.join("\n"), allDiags.some((d) => (d.severity ?? 1) <= 1) ? "error" : "warning");
		},
	});
}

function getLspStatus(state: LspState): LspStatus[] {
	return state.clients.map((c) => ({
		id: c.serverID,
		name: c.serverID,
		root: path.relative(state.cwd, c.root),
		status: "connected" as const,
	}));
}

export function formatLspResult(operation: string, results: unknown[], cwd: string): string {
	switch (operation) {
		case "goToDefinition":
		case "findReferences":
		case "goToImplementation": {
			const locations = results as Array<{ uri?: string; range?: Range; targetUri?: string; targetRange?: Range } | null>;
			const items: string[] = [];
			for (const loc of locations) {
				if (!loc) continue;
				const uri = (loc as any).uri ?? (loc as any).targetUri;
				const rng = (loc as any).range ?? (loc as any).targetRange;
				if (!uri || !rng) continue;
				try {
					const filePath = fileURLToPath(uri);
					const relPath = path.relative(cwd, filePath);
					items.push(`${relPath}:${(rng as Range).start.line + 1}:${(rng as Range).start.character + 1}`);
				} catch {
					items.push(`${uri}:${(rng as Range).start.line + 1}:${(rng as Range).start.character + 1}`);
				}
			}
			return items.length > 0
				? `${operation} results:\n${items.join("\n")}`
				: `No ${operation.replace(/([A-Z])/g, " $1").toLowerCase()} results found`;
		}
		case "hover": {
			const hovers = results as Array<{ contents?: string | { kind?: string; value?: string } } | null>;
			for (const h of hovers) {
				if (!h?.contents) continue;
				if (typeof h.contents === "string") return h.contents;
				return h.contents.value ?? "No hover information";
			}
			return "No hover information available";
		}
		case "documentSymbol": {
			const symbols = results.flat() as DocumentSymbolInfo[];
			if (symbols.length === 0) return "No symbols found in document";
			const lines = symbols.map((s) => {
				const kindName = symbolKindName(s.kind);
				const detail = s.detail ? ` (${s.detail})` : "";
				return `  ${kindName} ${s.name}${detail} [${s.range.start.line + 1}]`;
			});
			return `Document symbols:\n${lines.join("\n")}`;
		}
		case "workspaceSymbol": {
			const symbols = results.flat() as SymbolInfo[];
			if (symbols.length === 0) return "No workspace symbols found";
			const lines = symbols.slice(0, 20).map((s) => {
				const kindName = symbolKindName(s.kind);
				try {
					const filePath = fileURLToPath(s.location.uri);
					const relPath = path.relative(cwd, filePath);
					return `  ${kindName} ${s.name} (${relPath}:${s.location.range.start.line + 1})`;
				} catch {
					return `  ${kindName} ${s.name}`;
				}
			});
			return `Workspace symbols:\n${lines.join("\n")}${symbols.length > 20 ? `\n... and ${symbols.length - 20} more` : ""}`;
		}
		default:
			return JSON.stringify(results, null, 2);
	}
}

export function symbolKindName(kind: number): string {
	const names: Record<number, string> = {
		1: "File",
		2: "Module",
		3: "Namespace",
		4: "Package",
		5: "Class",
		6: "Method",
		7: "Property",
		8: "Field",
		9: "Constructor",
		10: "Enum",
		11: "Interface",
		12: "Function",
		13: "Variable",
		14: "Constant",
		23: "Struct",
		24: "Event",
	};
	return names[kind] ?? `Unknown(${kind})`;
}
