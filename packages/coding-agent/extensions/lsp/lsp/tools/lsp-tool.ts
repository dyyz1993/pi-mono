import { readFile as fsReadFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { type Static, Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@dyyz1993/pi-coding-agent";
import type { LspRuntimeRegistry } from "../client/registry.js";
import type { ResolvedLspConfig } from "../config/resolver.js";
import { waitForPushDiagnostics } from "../utils/diagnostics-wait.js";
import { extractPullDiagnostics, languageIdFromPath } from "../utils/lsp-helpers.js";

export interface LspToolRouter {
	register(pi: ExtensionAPI): void;
}

export interface LspToolRouterOptions {
	cwd?: string;
	getResolvedConfig: () => ResolvedLspConfig;
}

const LspActionSchema = Type.Union([
	Type.Literal("diagnostics"),
	Type.Literal("definition"),
	Type.Literal("references"),
	Type.Literal("hover"),
	Type.Literal("symbols"),
	Type.Literal("rename"),
	Type.Literal("status"),
	Type.Literal("reload"),
	Type.Literal("full_check"),
]);

const LspToolSchema = Type.Object({
	action: LspActionSchema,
	path: Type.Optional(Type.String({ description: "File path (relative or absolute) for document-scoped actions" })),
	line: Type.Optional(Type.Number({ description: "Zero-based line for position-based actions" })),
	character: Type.Optional(Type.Number({ description: "Zero-based character for position-based actions" })),
	newName: Type.Optional(Type.String({ description: "New symbol name for rename action" })),
	query: Type.Optional(Type.String({ description: "Workspace query for symbols action" })),
	includeDeclaration: Type.Optional(
		Type.Boolean({ description: "Whether references action should include declaration locations" }),
	),
	directory: Type.Optional(Type.String({ description: "Directory to scan for full_check action (defaults to cwd)" })),
	maxFiles: Type.Optional(Type.Number({ description: "Maximum files to check in full_check (default 50)" })),
});

type LspToolParams = Static<typeof LspToolSchema>;

interface LspToolDetails {
	action: LspToolParams["action"];
	payload?: unknown;
}

export function createLspToolRouter(runtime: LspRuntimeRegistry, options: LspToolRouterOptions): LspToolRouter {
	const cwd = options.cwd ?? process.cwd();

	return {
		register(pi: ExtensionAPI): void {
			pi.registerTool({
				name: "lsp",
				label: "LSP",
				description:
					"Run LSP actions (diagnostics, definition, references, hover, symbols, rename, status, reload, full_check)",
				parameters: LspToolSchema,
				execute: async (_toolCallId: string, params: LspToolParams) => {
					const details = await executeAction(runtime, params, cwd, options.getResolvedConfig);
					return {
						content: [{ type: "text", text: renderDetails(details) }],
						details,
					};
				},
			});

			pi.registerTool({
				name: "lsp_health",
				label: "LSP Health",
				description: "Backward-compatible health status shortcut for the LSP extension package",
				parameters: Type.Object({}),
				execute: async () => {
					const details = await executeAction(runtime, { action: "status" }, cwd, options.getResolvedConfig);
					return {
						content: [{ type: "text", text: renderDetails(details) }],
						details,
					};
				},
			});
		},
	};
}

async function executeAction(
	runtime: LspRuntimeRegistry,
	params: LspToolParams,
	cwd: string,
	getResolvedConfig: () => ResolvedLspConfig,
): Promise<LspToolDetails> {
	switch (params.action) {
		case "status": {
			const status = runtime.getStatus();
			return { action: "status", payload: status };
		}
		case "reload": {
			await runtime.reload(getResolvedConfig());
			return { action: "reload", payload: runtime.getStatus() };
		}
		case "diagnostics": {
			if (params.path) {
				const uri = toFileUri(params.path, cwd);
				const fullPath = resolve(cwd, params.path);
				try {
					const content = await fsReadFile(fullPath, "utf8");
					runtime.notify(
						"textDocument/didOpen",
						{
							textDocument: {
								uri,
								languageId: languageIdFromPath(params.path),
								version: Date.now(),
								text: content,
							},
						},
						{ path: params.path },
					);
					await new Promise((r) => setTimeout(r, 1500));
				} catch (openError) {
					return { action: "diagnostics", payload: { error: String(openError), hint: "didOpen failed" } };
				}

				let diagnostics = runtime.getPublishedDiagnostics(params.path);

				try {
					const results = await runtime.requestAll(
						"textDocument/diagnostic",
						{ textDocument: { uri } },
						{ path: params.path, timeoutMs: 8000 },
					);
					for (const result of results) {
						if (!result) continue;
						const pulled = extractPullDiagnostics(result);
						if (pulled.length > 0) {
							diagnostics = diagnostics.concat(pulled);
						}
					}
				} catch (err) {
					console.debug("[lsp] pull diagnostics failed:", err instanceof Error ? err.message : err);
				}

				return {
					action: "diagnostics",
					payload: diagnostics.length > 0 ? diagnostics : { uri, hint: "no diagnostics" },
				};
			}
			return { action: "diagnostics", payload: runtime.getPublishedDiagnostics() };
		}
		case "hover": {
			const position = requirePosition(params, cwd, "hover");
			const payload = await runtime.request(
				"textDocument/hover",
				{
					textDocument: { uri: position.uri },
					position: { line: position.line, character: position.character },
				},
				{ path: position.path },
			);
			return { action: "hover", payload };
		}
		case "definition": {
			const position = requirePosition(params, cwd, "definition");
			const payload = await runtime.request(
				"textDocument/definition",
				{
					textDocument: { uri: position.uri },
					position: { line: position.line, character: position.character },
				},
				{ path: position.path },
			);
			return { action: "definition", payload };
		}
		case "references": {
			const position = requirePosition(params, cwd, "references");
			const payload = await runtime.request(
				"textDocument/references",
				{
					textDocument: { uri: position.uri },
					position: { line: position.line, character: position.character },
					context: {
						includeDeclaration: params.includeDeclaration ?? false,
					},
				},
				{ path: position.path },
			);
			return { action: "references", payload };
		}
		case "symbols": {
			if (params.query) {
				const payload = await runtime.request("workspace/symbol", {
					query: params.query,
				});
				return { action: "symbols", payload };
			}
			if (!params.path) {
				throw new Error("symbols action requires either query or path.");
			}
			const uri = toFileUri(params.path, cwd);
			const payload = await runtime.request(
				"textDocument/documentSymbol",
				{
					textDocument: { uri },
				},
				{ path: params.path },
			);
			return { action: "symbols", payload };
		}
		case "rename": {
			if (!params.newName) {
				throw new Error("rename action requires newName.");
			}
			const position = requirePosition(params, cwd, "rename");
			const payload = await runtime.request(
				"textDocument/rename",
				{
					textDocument: { uri: position.uri },
					position: { line: position.line, character: position.character },
					newName: params.newName,
				},
				{ path: position.path },
			);
			return { action: "rename", payload };
		}
		case "full_check": {
			const scanDir = params.directory ? resolve(cwd, params.directory) : cwd;
			const maxFiles = params.maxFiles ?? 50;
			const files = await collectSourceFiles(scanDir, maxFiles);
			if (files.length === 0) {
				return { action: "full_check", payload: { hint: "no source files found", directory: scanDir } };
			}

			const results: Array<{ filePath: string; errorCount: number; warningCount: number; errors: Array<{ line: number; message: string }> }> = [];
			let totalErrors = 0;
			let totalWarnings = 0;

			for (const file of files) {
				try {
					const relPath = relative(cwd, file);
					const uri = pathToFileURL(file).href;
					const content = await fsReadFile(file, "utf8");

					runtime.notify(
						"textDocument/didOpen",
						{
							textDocument: {
								uri,
								languageId: languageIdFromPath(file),
								version: Date.now(),
								text: content,
							},
						},
						{ path: relPath },
					);

					await waitForPushDiagnostics(runtime, relPath);

					let diagnostics = runtime.getPublishedDiagnostics(relPath);

					try {
						const pullResults = await runtime.requestAll(
							"textDocument/diagnostic",
							{ textDocument: { uri } },
							{ path: relPath, timeoutMs: 5000 },
						);
						for (const result of pullResults) {
							if (!result) continue;
							const pulled = extractPullDiagnostics(result);
							if (pulled.length > 0) {
								diagnostics = diagnostics.concat(pulled);
							}
						}
					} catch {
						// pull diagnostics optional
					}

					const errors = diagnostics.filter((d) => d.severity === 1);
					const warnings = diagnostics.filter((d) => d.severity === 2);
					totalErrors += errors.length;
					totalWarnings += warnings.length;

					if (errors.length > 0) {
						results.push({
							filePath: relPath,
							errorCount: errors.length,
							warningCount: warnings.length,
							errors: errors.slice(0, 5).map((d) => ({
								line: d.range.start.line + 1,
								message: d.message,
							})),
						});
					}
				} catch {
					continue;
				}
			}

			return {
				action: "full_check",
				payload: {
					scannedFiles: files.length,
					totalErrors,
					totalWarnings,
					filesWithErrors: results,
				},
			};
		}
	}
}

function requirePosition(
	params: LspToolParams,
	cwd: string,
	action: "hover" | "definition" | "references" | "rename",
): { path: string; uri: string; line: number; character: number } {
	if (!params.path) {
		throw new Error(`${action} action requires path.`);
	}
	if (typeof params.line !== "number" || typeof params.character !== "number") {
		throw new Error(`${action} action requires line and character.`);
	}
	return {
		path: params.path,
		uri: toFileUri(params.path, cwd),
		line: params.line,
		character: params.character,
	};
}

function toFileUri(filePath: string, cwd: string): string {
	return pathToFileURL(resolve(cwd, filePath)).href;
}

const MAX_RENDERED_DETAILS_CHARS = 40_000;

function renderDetails(details: LspToolDetails): string {
	const header = `LSP action: ${details.action}`;
	if (details.payload === undefined) {
		return header;
	}

	const renderedPayload = safeJsonStringify(details.payload, MAX_RENDERED_DETAILS_CHARS);
	if (!renderedPayload) {
		return header;
	}

	return `${header}\n${renderedPayload}`;
}

function safeJsonStringify(payload: unknown, maxChars: number): string {
	let rendered: string;
	try {
		rendered = JSON.stringify(payload, null, 2) ?? "";
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		rendered = `"<unserializable payload: ${message}>"`;
	}

	if (rendered.length <= maxChars) {
		return rendered;
	}
	return `${rendered.slice(0, maxChars)}\n... (truncated at ${maxChars} chars)`;
}

const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rs", ".go"]);
const SKIP_SCAN_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", ".nuxt", "coverage"]);

async function collectSourceFiles(dir: string, maxFiles: number): Promise<string[]> {
	const files: string[] = [];

	async function walk(currentDir: string, depth: number): Promise<void> {
		if (files.length >= maxFiles || depth > 8) return;

		let entries;
		try {
			entries = await readdir(currentDir, { withFileTypes: true });
		} catch {
			return;
		}

		for (const entry of entries) {
			if (files.length >= maxFiles) return;

			if (entry.isDirectory()) {
				if (SKIP_SCAN_DIRS.has(entry.name)) continue;
				await walk(join(currentDir, entry.name), depth + 1);
			} else if (entry.isFile()) {
				const ext = extname(entry.name).toLowerCase();
				if (SOURCE_EXTENSIONS.has(ext)) {
					files.push(join(currentDir, entry.name));
				}
			}
		}
	}

	await walk(dir, 0);
	return files;
}
