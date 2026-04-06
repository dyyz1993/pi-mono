/**
 * LSP Client Interface
 *
 * This module defines the interface for Language Server Protocol clients.
 * The actual implementation will be provided by lsp-client-impl.ts
 */

export interface Position {
	line: number;
	character: number;
}

export interface Range {
	start: Position;
	end: Position;
}

export interface Location {
	uri: string;
	range: Range;
}

export interface CompletionItem {
	label: string;
	kind?: CompletionItemKind;
	detail?: string;
	documentation?: string | { kind: string; value: string };
	sortText?: string;
	filterText?: string;
	insertText?: string;
	data?: any;
}

export interface CompletionList {
	isIncomplete: boolean;
	items: CompletionItem[];
}

export interface Diagnostic {
	range: Range;
	severity: DiagnosticSeverity;
	code?: number | string;
	source?: string;
	message: string;
	relatedInformation?: Array<{
		location: Location;
		message: string;
	}>;
}

export interface Hover {
	contents:
		| string
		| { kind: string; value: string }
		| Array<{ language?: string; value: string }>;
	range?: Range;
}

export enum CompletionItemKind {
	Text = 1,
	Method = 2,
	Function = 3,
	Constructor = 4,
	Field = 5,
	Variable = 6,
	Class = 7,
	Interface = 8,
	Module = 9,
	Property = 10,
	Unit = 11,
	Value = 12,
	Enum = 13,
	Keyword = 14,
	Snippet = 15,
	Color = 16,
	File = 17,
	Reference = 18,
	Folder = 19,
	EnumMember = 20,
	Constant = 21,
	Struct = 22,
	Event = 23,
	Operator = 24,
	TypeParameter = 25,
}

export enum DiagnosticSeverity {
	Error = 1,
	Warning = 2,
	Information = 3,
	Hint = 4,
}

export interface ServerCapabilities {
	completionProvider?: {
		triggerCharacters?: string[];
		resolveProvider?: boolean;
	};
	definitionProvider?: boolean;
	referencesProvider?: boolean;
	diagnosticProvider?: {
		interFileDependencies: boolean;
		workspaceDiagnostics: boolean;
	};
	hoverProvider?: boolean;
}

export interface LSPClientOptions {
	/** Use mock implementation for testing */
	mock?: boolean;

	/** Mock server instance (for testing only) */
	mockServer?: any;

	/** Workspace root directory */
	workspaceRoot?: string;

	/** Timeout for requests in milliseconds */
	timeout?: number;

	/** Enable response caching */
	enableCache?: boolean;

	/** Maximum number of retries on failure */
	maxRetries?: number;

	/** Simulate server crash for testing */
	simulateCrash?: boolean;

	/** Simulate slow response for testing */
	simulateSlowResponse?: boolean;

	/** Simulate transient error for testing */
	simulateTransientError?: boolean;
}

/**
 * LSP Client interface
 *
 * Provides methods to interact with a Language Server Protocol server
 */
export interface LSPClient {
	/**
	 * Initialize the language server
	 * Must be called before any other methods
	 */
	initialize(): Promise<void>;

	/**
	 * Shutdown the language server
	 * Should be called when the client is no longer needed
	 */
	shutdown(): Promise<void>;

	/**
	 * Get server capabilities
	 */
	getCapabilities(): ServerCapabilities | null;

	/**
	 * Open a document in the language server
	 * @param filePath Absolute path to the file
	 */
	openDocument(filePath: string): Promise<void>;

	/**
	 * Update document content
	 * @param filePath Absolute path to the file
	 * @param content New content
	 * @param version Document version number
	 */
	updateDocument(filePath: string, content: string, version: number): Promise<void>;

	/**
	 * Close a document
	 * @param filePath Absolute path to the file
	 */
	closeDocument(filePath: string): Promise<void>;

	/**
	 * Get code completions at a position
	 * @param filePath Absolute path to the file
	 * @param line Line number (0-based)
	 * @param character Character offset (0-based)
	 * @param triggerCharacter Optional trigger character (e.g., '.')
	 * @param signal Optional abort signal for cancellation
	 */
	getCompletions(
		filePath: string,
		line: number,
		character: number,
		triggerCharacter?: string,
		signal?: AbortSignal,
	): Promise<CompletionList>;

	/**
	 * Go to definition
	 * @param filePath Absolute path to the file
	 * @param line Line number (0-based)
	 * @param character Character offset (0-based)
	 */
	getDefinition(filePath: string, line: number, character: number): Promise<Location[] | null>;

	/**
	 * Find all references
	 * @param filePath Absolute path to the file
	 * @param line Line number (0-based)
	 * @param character Character offset (0-based)
	 */
	getReferences(filePath: string, line: number, character: number): Promise<Location[]>;

	/**
	 * Get diagnostics for a document
	 * @param filePath Absolute path to the file
	 */
	getDiagnostics(filePath: string): Promise<Diagnostic[]>;

	/**
	 * Get hover information
	 * @param filePath Absolute path to the file
	 * @param line Line number (0-based)
	 * @param character Character offset (0-based)
	 */
	getHover(filePath: string, line: number, character: number): Promise<Hover | null>;
}

/**
 * Create an LSP client for a specific language
 * @param language Language identifier (e.g., 'typescript', 'python')
 * @param options Client options
 */
export function createLSPClient(language: string, options?: LSPClientOptions): LSPClient {
	// Supported languages (check before creating mock for proper error handling)
	const supportedLanguages = ["typescript", "javascript", "python", "rust", "go"];
	if (!supportedLanguages.includes(language)) {
		throw new Error(
			`Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(", ")}`,
		);
	}

	// For testing, use mock implementation
	if (options?.mock) {
		return createMockClient(options);
	}

	// TODO: Implement real LSP client using actual language servers
	// For now, return mock client for testing
	return createMockClient(options);
}

/**
 * Internal function to create mock client
 */
function createMockClient(options?: LSPClientOptions): LSPClient {
	// Inline mock implementation to avoid ESM import issues
	return new MockLSPClientImpl(options);
}

/**
 * Inline mock implementation
 */
class MockLSPClientImpl implements LSPClient {
	private capabilities: ServerCapabilities | null = null;
	private documents = new Map<string, { content: string; version: number }>();
	private completions = new Map<string, any[]>();
	private options: Required<LSPClientOptions>;
	private initialized = false;
	private requestCount = 0;
	private mockServer: any = null;

	constructor(opts: LSPClientOptions = {}) {
		this.options = {
			timeout: 5000,
			enableCache: false,
			maxRetries: 3,
			simulateCrash: false,
			simulateSlowResponse: false,
			simulateTransientError: false,
			mock: false,
			mockServer: undefined,
			...opts,
		};
		// Use external mock server if provided
		if (opts.mockServer) {
			this.mockServer = opts.mockServer;
		}
	}

	async initialize(): Promise<void> {
		if (this.initialized) return;
		await this.delay(10);
		
		// Use external mock server if provided
		if (this.mockServer && typeof this.mockServer.getCapabilities === 'function') {
			this.capabilities = this.mockServer.getCapabilities();
		} else {
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
		}
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
		
		return this.withRetry(async () => {
			await this.maybeSimulateError();
			await this.maybeSimulateDelay(signal);

			if (signal?.aborted) {
				throw new Error("Request aborted");
			}

			// Use external mock server if provided
			if (this.mockServer && typeof this.mockServer.getCompletions === 'function') {
				const result = this.mockServer.getCompletions(`file://${filePath}`, { line, character });
				return result;
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
		}, signal);
	}

	async getDefinition(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location[] | null> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();
		
		// Use external mock server if provided
		if (this.mockServer && typeof this.mockServer.getDefinition === 'function') {
			return this.mockServer.getDefinition(`file://${filePath}`, { line, character });
		}
		
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

	async getReferences(
		filePath: string,
		line: number,
		character: number,
	): Promise<Location[]> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();
		
		// Use external mock server if provided
		if (this.mockServer && typeof this.mockServer.getReferences === 'function') {
			return this.mockServer.getReferences(`file://${filePath}`, { line, character });
		}
		
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
		
		// Use external mock server if provided
		if (this.mockServer && typeof this.mockServer.getDiagnostics === 'function') {
			return this.mockServer.getDiagnostics(`file://${filePath}`);
		}

		const doc = this.documents.get(filePath);
		if (!doc) return [];

		const diagnostics: Diagnostic[] = [];
		if (doc.content.includes("error")) {
			diagnostics.push({
				range: {
					start: { line: 0, character: 0 },
					end: { line: 0, character: 5 },
				},
				severity: DiagnosticSeverity.Error,
				message: 'Unexpected keyword "error"',
			});
		}

		return diagnostics;
	}

	async getHover(filePath: string, line: number, character: number): Promise<Hover | null> {
		this.checkInitialized();
		await this.maybeSimulateError();
		await this.maybeSimulateDelay();
		
		// Use external mock server if provided
		if (this.mockServer && typeof this.mockServer.getHover === 'function') {
			return this.mockServer.getHover(`file://${filePath}`, { line, character });
		}
		
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

	addCompletions(filePath: string, completions: any[]): void {
		this.completions.set(filePath, completions);
	}

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
			// Fail first two times, succeed on third attempt
			if (this.requestCount <= 2) {
				throw new Error("Temporary error");
			}
		}
	}

	private async maybeSimulateDelay(signal?: AbortSignal): Promise<void> {
		if (this.options.simulateSlowResponse) {
			await this.delay(this.options.timeout + 100, signal);
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

	/**
	 * Retry wrapper for operations that may fail transiently
	 */
	private async withRetry<T>(
		operation: () => Promise<T>,
		signal?: AbortSignal,
	): Promise<T> {
		let lastError: Error | undefined;
		
		for (let attempt = 0; attempt < this.options.maxRetries; attempt++) {
			if (signal?.aborted) {
				throw new Error("Request aborted");
			}
			
			try {
				return await operation();
			} catch (error) {
				lastError = error instanceof Error ? error : new Error(String(error));
				
				// Don't retry if this is a permanent error (like simulateCrash)
				if (this.options.simulateCrash && lastError.message === "Language server crashed") {
					throw lastError;
				}
				
				// Don't retry if this is the last attempt
				if (attempt === this.options.maxRetries - 1) {
					throw lastError;
				}
				
				// Wait a bit before retrying
				await this.delay(10 * (attempt + 1), signal);
			}
		}
		
		throw lastError ?? new Error("Operation failed");
	}
}
