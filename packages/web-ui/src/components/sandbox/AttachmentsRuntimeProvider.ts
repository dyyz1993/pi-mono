import { ATTACHMENTS_RUNTIME_DESCRIPTION } from "../../prompts/prompts.js";
import type { Attachment } from "../../utils/attachment-utils.js";
import type { SandboxRuntimeProvider } from "./SandboxRuntimeProvider.js";
import { type AttachmentData, getSandboxWindow } from "./sandbox-types.js";

/**
 * Attachments Runtime Provider
 *
 * OPTIONAL provider that provides file access APIs to sandboxed code.
 * Only needed when attachments are present.
 * Attachments are read-only snapshot data - no messaging needed.
 */
export class AttachmentsRuntimeProvider implements SandboxRuntimeProvider {
	constructor(private attachments: Attachment[]) {}

	getData(): Record<string, unknown> {
		const attachmentsData: AttachmentData[] = this.attachments.map((a) => ({
			id: a.id,
			fileName: a.fileName,
			mimeType: a.mimeType,
			size: a.size,
			content: a.content,
			extractedText: a.extractedText,
		}));

		return { attachments: attachmentsData };
	}

	getRuntime(): (sandboxId: string) => void {
		// This function will be stringified, so no external references!
		// These functions read directly from window.attachments
		// Works both online AND offline (no messaging needed!)
		return (_sandboxId: string) => {
			const sw = getSandboxWindow();

			sw.listAttachments = () =>
				(sw.attachments || []).map((a) => ({
					id: a.id,
					fileName: a.fileName,
					mimeType: a.mimeType,
					size: a.size,
				}));

			sw.readTextAttachment = (attachmentId: string) => {
				const a = (sw.attachments || []).find((x) => x.id === attachmentId);
				if (!a) throw new Error(`Attachment not found: ${attachmentId}`);
				if (a.extractedText) return a.extractedText;
				try {
					return atob(a.content);
				} catch {
					throw new Error(`Failed to decode text content for: ${attachmentId}`);
				}
			};

			sw.readBinaryAttachment = (attachmentId: string) => {
				const a = (sw.attachments || []).find((x) => x.id === attachmentId);
				if (!a) throw new Error(`Attachment not found: ${attachmentId}`);
				const bin = atob(a.content);
				const bytes = new Uint8Array(bin.length);
				for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
				return bytes;
			};
		};
	}

	getDescription(): string {
		return ATTACHMENTS_RUNTIME_DESCRIPTION;
	}
}
