/**
 * LSP Extension - JSON-RPC Client
 *
 * Self-contained JSON-RPC client for LSP protocol communication.
 * Implements the LSP base protocol (Content-Length framed messages) over stdio.
 * No external dependency on vscode-jsonrpc.
 */

import type { Diagnostic, JsonRpcConnection } from "./types.js";
import { LANGUAGE_EXTENSIONS } from "./language.js";
import * as path from "path";
import { pathToFileURL, fileURLToPath } from "url";
import * as fs from "fs/promises";
import type { ServerHandle } from "./types.js";

const DIAGNOSTICS_DEBOUNCE_MS = 150;
const DIAGNOSTICS_TIMEOUT_MS = 3000;

interface RequestPending {
	resolve: (value: unknown) => void;
	reject: (error: Error) => void;
	timer: ReturnType<typeof setTimeout>;
}

export class LspClient {
	private _id = 0;
	private pending = new Map<number, RequestPending>();
	private notificationHandlers = new Map<string, Set<(params: unknown) => void>>();
	private requestHandlers = new Map<string, Set<(params: unknown) => unknown>>();
	private diagnosticsMap = new Map<string, Diagnostic[]>();
	private buffer = "";
	private isListening = false;
	private disposed = false;

	constructor(
		public readonly root: string,
		public readonly serverID: string,
		private handle: ServerHandle,
		private cwd: string,
	) {}

	get connection(): JsonRpcConnection {
		return {
			sendRequest: <T>(method: string, params?: unknown) => this.sendRequest<T>(method, params),
			sendNotification: (method: string, params?: unknown) => this.sendNotification(method, params),
			onNotification: (method: string, handler: (params: unknown) => void) =>
				this.onNotification(method, handler),
			onRequest: (method: string, handler: (params: unknown) => unknown) =>
				this.onRequest(method, handler),
			listen: () => this.listen(),
			end: () => this.end(),
			dispose: () => this.dispose(),
		};
	}

	get diagnostics(): Map<string, Diagnostic[]> {
		return this.diagnosticsMap;
	}

	get notify(): { open: (input: { path: string }) => Promise<void> } {
		return { open: (input) => this.openFile(input) };
	}

	static async create(input: {
		serverID: string;
		server: ServerHandle;
		root: string;
		cwd: string;
		onDiagnostics?: (serverID: string, filePath: string) => void;
	}): Promise<LspClient | undefined> {
		const client = new LspClient(input.root, input.serverID, input.server, input.cwd);

		const proc = input.server.process;

		const connection = client.connection;

		connection.onNotification("textDocument/publishDiagnostics", (params: any) => {
			const filePath = normalizePath(fileURLToPath(params.uri));
			client.diagnosticsMap.set(filePath, params.diagnostics ?? []);
			input.onDiagnostics?.(input.serverID, filePath);
		});

		connection.onRequest("window/workDoneProgress/create", () => null);
		connection.onRequest("workspace/configuration", async () => [input.server.initialization ?? {}]);
		connection.onRequest("client/registerCapability", async () => {});
		connection.onRequest("client/unregisterCapability", async () => {});
		connection.onRequest("workspace/workspaceFolders", async () => [
			{ name: "workspace", uri: pathToFileURL(input.root).href },
		]);

		connection.listen();

		try {
			await withTimeout(
				connection.sendRequest("initialize", {
					rootUri: pathToFileURL(input.root).href,
					processId: proc.pid,
					workspaceFolders: [
						{ name: "workspace", uri: pathToFileURL(input.root).href },
					],
					initializationOptions: { ...input.server.initialization },
					capabilities: {
						window: { workDoneProgress: true },
						workspace: {
							configuration: true,
							didChangeWatchedFiles: { dynamicRegistration: true },
						},
						textDocument: {
							synchronization: { didOpen: true, didChange: true },
							publishDiagnostics: { versionSupport: true },
						},
					},
				}),
				45_000,
			);
		} catch (err) {
			client.dispose();
			throw new Error(`LSP initialize failed for ${input.serverID}: ${err}`);
		}

		await connection.sendNotification("initialized", {});

		if (input.server.initialization) {
			await connection.sendNotification("workspace/didChangeConfiguration", {
				settings: input.server.initialization,
			});
		}

		return client;
	}

	async openFile(input: { path: string }): Promise<void> {
		input.path = path.isAbsolute(input.path)
			? input.path
			: path.resolve(this.cwd, input.path);

		const text = await fs.readFile(input.path, "utf-8");
		const extension = path.extname(input.path);
		const languageId = LANGUAGE_EXTENSIONS[extension] ?? "plaintext";

		if (this._fileVersions.has(input.path)) {
			await this.connection.sendNotification("workspace/didChangeWatchedFiles", {
				changes: [{ uri: pathToFileURL(input.path).href, type: 2 }],
			});

			const version = this._fileVersions.get(input.path)! + 1;
			this._fileVersions.set(input.path, version);

			await this.connection.sendNotification("textDocument/didChange", {
				textDocument: { uri: pathToFileURL(input.path).href, version },
				contentChanges: [{ text }],
			});
			return;
		}

		await this.connection.sendNotification("workspace/didChangeWatchedFiles", {
			changes: [{ uri: pathToFileURL(input.path).href, type: 1 }],
		});

		this.diagnosticsMap.delete(input.path);
		await this.connection.sendNotification("textDocument/didOpen", {
			textDocument: {
				uri: pathToFileURL(input.path).href,
				languageId,
				version: 0,
				text,
			},
		});
		this._fileVersions.set(input.path, 0);
	}

	waitForDiagnostics(
		input: { path: string },
		onDiagnosticEvent?: (serverID: string, filePath: string) => Promise<void>,
	): Promise<void> {
		const normalizedPath = normalizePath(
			path.isAbsolute(input.path) ? input.path : path.resolve(this.cwd, input.path),
		);

		return withTimeout(
			new Promise<void>((resolve, reject) => {
				let unsub: (() => void) | undefined;
				let debounceTimer: ReturnType<typeof setTimeout> | undefined;
				let settled = false;

				const cleanup = () => {
					settled = true;
					if (debounceTimer) clearTimeout(debounceTimer);
					unsub?.();
				};

				const handler = (_params: unknown) => {
					if (settled) return;
					if (debounceTimer) clearTimeout(debounceTimer);
					debounceTimer = setTimeout(() => {
						cleanup();
						resolve();
					}, DIAGNOSTICS_DEBOUNCE_MS);
				};

				this.onNotification("textDocument/publishDiagnostics", handler);
				unsub = () => this.offNotification("textDocument/publishDiagnostics", handler);

				if (onDiagnosticEvent) {
					void onDiagnosticEvent(this.serverID, normalizedPath).then(() => {
						if (!settled) {
							if (debounceTimer) clearTimeout(debounceTimer);
							debounceTimer = setTimeout(() => {
								cleanup();
								resolve();
							}, DIAGNOSTICS_DEBOUNCE_MS);
						}
					});
				}
			}),
			DIAGNOSTICS_TIMEOUT_MS,
		).catch(() => {});
	}

	async shutdown(): Promise<void> {
		this.disposed = true;
		try {
			this.connection.end();
			this.connection.dispose();
		} catch {}
		this.handle.process.kill();
	}

	private _fileVersions = new Map<string, number>();

	private sendRequest<T>(method: string, params?: unknown): Promise<T> {
		return new Promise<T>((resolve, reject) => {
			if (this.disposed) {
				reject(new Error("Connection disposed"));
				return;
			}

			const id = ++this._id;
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`Request timeout: ${method}`));
			}, 60_000);

			this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, timer });
			this.sendMessage({ jsonrpc: "2.0", id, method, params });
		}) as Promise<T>;
	}

	private sendNotification(method: string, params?: unknown): void {
		if (this.disposed) return;
		this.sendMessage({ jsonrpc: "2.0", method, params });
	}

	private onNotification(method: string, handler: (params: unknown) => void): void {
		if (!this.notificationHandlers.has(method)) {
			this.notificationHandlers.set(method, new Set());
		}
		this.notificationHandlers.get(method)!.add(handler);
	}

	private offNotification(method: string, handler: (params: unknown) => void): void {
		this.notificationHandlers.get(method)?.delete(handler);
	}

	private onRequest(method: string, handler: (params: unknown) => unknown): void {
		if (!this.requestHandlers.has(method)) {
			this.requestHandlers.set(method, new Set());
		}
		this.requestHandlers.get(method)!.add(handler);
	}

	private listen(): void {
		if (this.isListening) return;
		this.isListening = true;

		const proc = this.handle.process;
		const stdout = proc.stdout as NodeJS.ReadableStream;

		stdout.on("data", (chunk: Buffer | string) => {
			this.buffer += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
			this.processBuffer();
		});

		stdout.on("error", (err: Error) => {
			this.handleError(err);
		});

		proc.stderr?.on("data", (_chunk: Buffer | string) => {
		});

		proc.on("exit", () => {
			this.rejectAll(new Error("LSP process exited"));
		});
	}

	private end(): void {
	}

	private dispose(): void {
		this.disposed = true;
		this.rejectAll(new Error("Connection disposed"));
		this.pending.clear();
		this.notificationHandlers.clear();
		this.requestHandlers.clear();
	}

	private sendMessage(message: Record<string, unknown>): void {
		const content = JSON.stringify(message);
		const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`;
		const proc = this.handle.process;
		const stdin = proc.stdin as NodeJS.WritableStream;
		stdin.write(header + content);
	}

	private processBuffer(): void {
		while (true) {
			const headerEnd = this.buffer.indexOf("\r\n\r\n");
			if (headerEnd === -1) break;

			const header = this.buffer.slice(0, headerEnd);
			const lengthMatch = /Content-Length:\s*(\d+)/i.exec(header);
			if (!lengthMatch) {
				this.buffer = this.buffer.slice(headerEnd + 4);
				continue;
			}

			const contentLength = parseInt(lengthMatch[1], 10);
			const messageStart = headerEnd + 4;
			const messageEnd = messageStart + contentLength;

			if (this.buffer.length < messageEnd) break;

			const raw = this.buffer.slice(messageStart, messageEnd);
			this.buffer = this.buffer.slice(messageEnd);

			try {
				const message = JSON.parse(raw);
				this.handleMessage(message);
			} catch {
			}
		}
	}

	private handleMessage(message: Record<string, unknown>): void {
		if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
			this.handleResponse(message as any);
		} else if (message.method !== undefined) {
			if (message.id !== undefined) {
				this.handleIncomingRequest(message as any);
			} else {
				this.handleIncomingNotification(message as any);
			}
		}
	}

	private handleResponse(message: { id: number; result?: unknown; error?: { code: number; message: string } }): void {
		const pending = this.pending.get(message.id);
		if (!pending) return;

		clearTimeout(pending.timer);
		this.pending.delete(message.id);

		if (message.error) {
			pending.reject(new Error(`LSP Error ${message.error.code}: ${message.error.message}`));
		} else {
			pending.resolve(message.result);
		}
	}

	private handleIncomingNotification(message: { method: string; params?: unknown }): void {
		const handlers = this.notificationHandlers.get(message.method);
		if (handlers) {
			for (const handler of handlers) {
				try {
					handler(message.params);
				} catch {
				}
			}
		}
	}

	private async handleIncomingRequest(message: { id: number; method: string; params?: unknown }): Promise<void> {
		const handlers = this.requestHandlers.get(message.method);
		let result: unknown = undefined;
		let error: { code: number; message: string } | undefined;

		if (handlers) {
			for (const handler of handlers) {
				try {
					result = await handler(message.params);
					break;
				} catch (e) {
					error = { code: -32603, message: e instanceof Error ? e.message : String(e) };
				}
			}
		} else {
			error = { code: -32601, message: `Method not found: ${message.method}` };
		}

		const response: Record<string, unknown> = { jsonrpc: "2.0", id: message.id };
		if (error) {
			response.error = error;
		} else {
			response.result = result;
		}

		this.sendMessage(response);
	}

	private rejectAll(error: Error): void {
		for (const [id, pending] of this.pending) {
			clearTimeout(pending.timer);
			pending.reject(error);
			this.pending.delete(id);
		}
	}

	private handleError(_error: Error): void {
		this.rejectAll(_error);
	}
}

function normalizePath(p: string): string {
	return p.replace(/\\/g, "/");
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => {
			reject(new Error(`Timed out after ${ms}ms`));
		}, ms);

		promise.then(
			(value) => {
				clearTimeout(timer);
				resolve(value);
			},
			(error) => {
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
