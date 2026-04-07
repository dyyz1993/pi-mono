/**
 * LSP Extension - Shared Types
 *
 * Core type definitions for the LSP protocol integration.
 * Based on vscode-languageserver-types but self-contained to avoid external deps.
 */

export interface Range {
	start: Position;
	end: Position;
}

export interface Position {
	line: number;
	character: number;
}

export interface Location {
	uri: string;
	range: Range;
}

export interface Diagnostic {
	range: Range;
	severity?: DiagnosticSeverity;
	code?: string | number;
	source?: string;
	message: string;
	relatedInformation?: DiagnosticRelatedInformation[];
}

export enum DiagnosticSeverity {
	Error = 1,
	Warning = 2,
	Information = 3,
	Hint = 4,
}

export interface DiagnosticRelatedInformation {
	location: Location;
	message: string;
}

export interface SymbolInfo {
	name: string;
	kind: number;
	location: Location;
}

export interface DocumentSymbolInfo {
	name: string;
	detail?: string;
	kind: number;
	range: Range;
	selectionRange: Range;
	children?: DocumentSymbolInfo[];
}

export interface HoverResult {
	contents: string | MarkupContent;
	range?: Range;
}

export interface MarkupContent {
	kind: "plaintext" | "markdown";
	value: string;
}

export interface LspStatus {
	id: string;
	name: string;
	root: string;
	status: "connected" | "error";
}

export interface ServerHandle {
	process: import("child_process").ChildProcessWithoutNullStreams;
	initialization?: Record<string, unknown>;
}

export interface ServerInfo {
	id: string;
	extensions: string[];
	global?: boolean;
	root: (file: string) => Promise<string | undefined>;
	spawn: (root: string) => Promise<ServerHandle | undefined>;
}

export interface ClientInfo {
	root: string;
	serverID: string;
	connection: JsonRpcConnection;
	notify: { open: (input: { path: string }) => Promise<void> };
	diagnostics: Map<string, Diagnostic[]>;
	waitForDiagnostics: (input: { path: string }) => Promise<void>;
	shutdown: () => Promise<void>;
}

export interface JsonRpcConnection {
	sendRequest<T>(method: string, params?: unknown): Promise<T>;
	sendNotification(method: string, params?: unknown): void;
	onNotification(method: string, handler: (params: unknown) => void): void;
	onRequest(method: string, handler: (params: unknown) => unknown): void;
	listen(): void;
	end(): void;
	dispose(): void;
}
