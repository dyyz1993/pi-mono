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
	// For testing, use mock implementation
	if (options?.mock) {
		// Import dynamically to avoid circular dependencies
		// Use inline require for ESM compatibility with tsx
		// @ts-ignore - Dynamic import for testing
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const { MockLSPClient } = require("./lsp-client-mock.js");
		return new MockLSPClient(options);
	}

	// Supported languages
	const supportedLanguages = ["typescript", "javascript", "python", "rust", "go"];
	if (!supportedLanguages.includes(language)) {
		throw new Error(
			`Unsupported language: ${language}. Supported languages: ${supportedLanguages.join(", ")}`,
		);
	}

	// TODO: Implement real LSP client using actual language servers
	// For now, return mock client for testing
	// @ts-ignore - Dynamic import
	// eslint-disable-next-line @typescript-eslint/no-var-requires
	const { MockLSPClient } = require("./lsp-client-mock.js");
	return new MockLSPClient(options);
}
