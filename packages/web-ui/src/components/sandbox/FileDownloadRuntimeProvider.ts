import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";
import {
	type FileReturnedMessage,
	getSandboxWindow,
	type RuntimeMessage,
	type RuntimeResponse,
} from "./sandbox-types.js";

export interface DownloadableFile {
	fileName: string;
	content: string | Uint8Array;
	mimeType: string;
}

/**
 * File Download Runtime Provider
 *
 * Provides returnDownloadableFile() for creating user downloads.
 * Files returned this way are NOT accessible to the LLM later (one-time download).
 * Works both online (sends to extension) and offline (triggers browser download directly).
 * Collects files for retrieval by caller.
 */
export class FileDownloadRuntimeProvider implements SandboxRuntimeProvider {
	private files: DownloadableFile[] = [];

	getData(): Record<string, unknown> {
		// No data needed
		return {};
	}

	getRuntime(): (sandboxId: string) => void {
		return (_sandboxId: string) => {
			const sw = getSandboxWindow();

			sw.returnDownloadableFile = async (fileName: string, content: unknown, mimeType?: string) => {
				let finalContent: string | Uint8Array, finalMimeType: string;

				if (content instanceof Blob) {
					const arrayBuffer = await content.arrayBuffer();
					finalContent = new Uint8Array(arrayBuffer);
					finalMimeType = mimeType || content.type || "application/octet-stream";
					if (!mimeType && !content.type) {
						throw new Error(
							"returnDownloadableFile: MIME type is required for Blob content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
				} else if (content instanceof Uint8Array) {
					finalContent = content;
					if (!mimeType) {
						throw new Error(
							"returnDownloadableFile: MIME type is required for Uint8Array content. Please provide a mimeType parameter (e.g., 'image/png').",
						);
					}
					finalMimeType = mimeType;
				} else if (typeof content === "string") {
					finalContent = content;
					finalMimeType = mimeType || "text/plain";
				} else {
					finalContent = JSON.stringify(content, null, 2);
					finalMimeType = mimeType || "application/json";
				}

				// Send to extension if in extension context (online mode)
				if (sw.sendRuntimeMessage) {
					const response = await sw.sendRuntimeMessage({
						type: "file-returned",
						fileName,
						content: finalContent,
						mimeType: finalMimeType,
					});
					if (response.error) throw new Error(response.error);
				} else {
					// Offline mode: trigger browser download directly
					const blob = new Blob(
						[finalContent instanceof Uint8Array ? (finalContent as unknown as BlobPart) : finalContent],
						{
							type: finalMimeType,
						},
					);
					const url = URL.createObjectURL(blob);
					const a = document.createElement("a");
					a.href = url;
					a.download = fileName;
					a.click();
					URL.revokeObjectURL(url);
				}
			};
		};
	}

	async handleMessage(message: RuntimeMessage, respond: (response: RuntimeResponse) => void): Promise<void> {
		if (message.type === "file-returned") {
			const fileMsg = message as FileReturnedMessage;
			// Collect file for caller
			this.files.push({
				fileName: fileMsg.fileName,
				content: fileMsg.content,
				mimeType: fileMsg.mimeType,
			});

			respond({ success: true });
		}
	}

	/**
	 * Get collected files
	 */
	getFiles(): DownloadableFile[] {
		return this.files;
	}

	/**
	 * Reset state for reuse
	 */
	reset(): void {
		this.files = [];
	}

	getDescription(): string {
		return "returnDownloadableFile(filename, content, mimeType?) - Create downloadable file for user (one-time download, not accessible later)";
	}
}
