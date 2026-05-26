/**
 * Type definitions for the sandbox runtime communication layer.
 *
 * These types describe the properties injected into `window` inside sandboxed iframes
 * and the message shapes used for bidirectional communication.
 */

/** Response from sendRuntimeMessage */
export interface RuntimeResponse {
	success: boolean;
	result?: unknown;
	error?: string;
	[key: string]: unknown;
}

/** Artifact operation messages */
export interface ArtifactOperationMessage {
	type: "artifact-operation";
	action: "list" | "get" | "createOrUpdate" | "delete";
	filename?: string;
	content?: string;
	mimeType?: string;
}

/** Console messages */
export interface ConsoleMessage {
	type: "console";
	method: "log" | "error" | "warn" | "info";
	text: string;
	args?: unknown[];
}

/** Execution complete message */
export interface ExecutionCompleteMessage {
	type: "execution-complete";
	returnValue?: unknown;
}

/** Execution error message */
export interface ExecutionErrorMessage {
	type: "execution-error";
	error: { message: string; stack: string };
}

/** File returned message */
export interface FileReturnedMessage {
	type: "file-returned";
	fileName: string;
	content: string | Uint8Array;
	mimeType: string;
}

/** Union of all runtime messages */
export type RuntimeMessage =
	| ArtifactOperationMessage
	| ConsoleMessage
	| ExecutionCompleteMessage
	| ExecutionErrorMessage
	| FileReturnedMessage
	| { type: string; [key: string]: unknown };

/** Attachment data injected into sandbox */
export interface AttachmentData {
	id: string;
	fileName: string;
	mimeType: string;
	size: number;
	content: string;
	extractedText?: string;
}

/** Properties added to window inside the sandbox iframe context */
export interface SandboxWindow {
	sandboxId: string;
	sendRuntimeMessage: (message: RuntimeMessage) => Promise<RuntimeResponse>;
	onCompleted: (callback: (success: boolean) => Promise<void>) => void;
	__completionCallbacks: Array<(success: boolean) => Promise<void>>;
	__originalConsole: Record<"log" | "error" | "warn" | "info", (...args: unknown[]) => void>;
	complete: (error?: { message: string; stack: string }, returnValue?: unknown) => Promise<void>;
	artifacts?: Record<string, string>;
	listArtifacts: () => Promise<string[]>;
	getArtifact: (filename: string) => Promise<unknown>;
	createOrUpdateArtifact: (filename: string, content: unknown, mimeType?: string) => Promise<void>;
	deleteArtifact: (filename: string) => Promise<void>;
	attachments?: AttachmentData[];
	listAttachments: () => Array<{ id: string; fileName: string; mimeType: string; size: number }>;
	readTextAttachment: (attachmentId: string) => string;
	readBinaryAttachment: (attachmentId: string) => Uint8Array;
	returnDownloadableFile: (fileName: string, content: unknown, mimeType?: string) => Promise<void>;
}

/** Helper to get typed sandbox window reference */
export function getSandboxWindow(): SandboxWindow {
	return window as unknown as SandboxWindow;
}
