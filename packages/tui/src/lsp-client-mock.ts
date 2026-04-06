/**
 * Mock LSP Client Implementation
 *
 * This provides a mock implementation for testing purposes.
 * The real implementation will use actual language servers.
 */

import {
	LSPClient,
	LSPClientOptions,
	ServerCapabilities,
	CompletionList,
	Location,
	Diagnostic,
	Hover,
} from "./lsp-client.js";

interface MockDocument {
	content: string;
	version: number;
}

interface MockCompletion {
	label: string;
	kind: number;
	detail?: string;
}

export class MockLSPClient implements LSPClient {
	private capabilities: ServerCapabilities | null = null;
	private documents = new Map<string, MockDocument>();
	private completions = new Map<string, MockCompletion[]>();
	private options: LSPClientOptions;
	private initialized = false;
	private requestCount = 0;

	constructor(options: LSPClientOptions = {}) {
		this.options = {
			timeout: 5000,
			enableCache: false,
			maxRetries: 3,
			...options,
		};
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;

		// Simulate initialization delay
		await this.delay(10);

		this.capabilities = {
			completionProvider: {
				triggerCharacters: ["."],
				resolveProvider: false,
			},
			definitionProvider: true,
			referencesProvider: true,
			diagnosticProvider: {
				interFileDependencies: true,
				workspaceDiagnostics: false,
			},
			hoverProvider: true,
		};

		this.initialized = true;
	}

	async shutdown(): Promise<void> {
		this.documents.clear();
		this.completions.clear();
		this.initialized = false;
	}

	getCapabilities(): ServerCapabilities | null {
		return this.capabilities;
	}

	async openDocument(filePath: string): Promise<void> {
		this.checkInitialized();

		// In mock mode, we don't actually read the file
		// Tests can use addCompletions to set up expected behavior
		const content = this.documents.get(filePath)?.content ?? "";
		this.documents.set(filePath, { content, version: 1 });
	}

	async updateDocument(filePath: string, content: string, version: number): Promise<void> {
		this.checkInitialized();

		this.documents.set(filePath, { content, version });
	}

	async closeDocument(filePath: string): Promise<void> {
		this.documents.delete(filePath);
	}

	async getCompletions(
		filePath: string,
		line: number,
		character: number,
		triggerCharacter?: string,
		signal?: AbortSignal,
	): Promise<CompletionList> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay(signal);

		if (signal?.aborted) {
			throw new Error("Request aborted");
		}

		const completions = this.completions.get(filePath) ?? [];

		return {
			isIncomplete: false,
			items: completions.map((c) => ({
				label: c.label,
				kind: c.kind,
				detail: c.detail,
			})),
		};
	}

	async getDefinition(filePath: string, line: number, character: number): Promise<Location[] | null> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();

		return [
			{
				uri: `file://${filePath}`,
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 10 },
				},
			},
		];
	}

	async getReferences(filePath: string, line: number, character: number): Promise<Location[]> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();

		return [
			{
				uri: `file://${filePath}`,
				range: {
					start: { line: 5, character: 2 },
					end: { line: 5, character: 12 },
				},
			},
		];
	}

	async getDiagnostics(filePath: string): Promise<Diagnostic[]> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();

		const doc = this.documents.get(filePath);
		if (!doc) return [];

		const diagnostics: Diagnostic[] = [];

		// Simple mock: detect "error" keyword
		if (doc.content.includes("error")) {
			diagnostics.push({
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: 1, // Error
				message: 'Unexpected keyword "error"',
			});
		}

		return diagnostics;
	}

	async getHover(filePath: string, line: number, character: number): Promise<Hover | null> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();

		return {
			contents: {
				kind: "markdown",
				value: `**Mock Hover**\n\nPosition: Line ${line}, Character ${character}`,
			},
			range: {
				start: { line, character },
				end: { line, character: character + 5 },
			},
		};
	}

	// Mock helper methods

	addCompletions(filePath: string, completions: MockCompletion[]): void {
		this.completions.set(filePath, completions);
	}

	// Private methods

	private checkInitialized(): void {
		if (!this.initialized) {
			throw new Error("LSP client not initialized. Call initialize() first.");
		}
	}

	private async maybeSimulateError(): Promise<void> {
		if (this.options.simulateCrash) {
			throw new Error("Language server crashed");
		}

		if (this.options.simulateTransientError) {
			this.requestCount++;
			if (this.requestCount < (this.options.maxRetries ?? 3)) {
				throw new Error("Temporary error");
			}
		}
	}

	private async maybeSimulateDelay(signal?: AbortSignal): Promise<void> {
		if (this.options.simulateSlowResponse) {
			const timeout = this.options.timeout ?? 5000;
			await this.delay(timeout + 100, signal);
		} else {
			await this.delay(5);
		}
	}

	private delay(ms: number, signal?: AbortSignal): Promise<void> {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(resolve, ms);

			if (signal) {
				signal.addEventListener("abort", () => {
					clearTimeout(timeout);
					reject(new Error("Request aborted"));
				});
			}
		});
	}
}
