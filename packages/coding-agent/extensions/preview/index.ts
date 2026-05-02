import { existsSync, statSync } from "node:fs";
import { extname, isAbsolute, resolve } from "node:path";
import type { AgentToolResult } from "@dyyz1993/pi-agent-core";
import { Text } from "@dyyz1993/pi-tui";
import { Type } from "typebox";
import type { ExtensionAPI, ExtensionContext } from "../../src/core/extensions/index.js";

export type ResourceType = "image" | "url" | "html" | "pdf" | "video" | "audio" | "markdown" | "text";

export interface PreviewDetails {
	source: string;
	absolutePath?: string;
	resourceType: ResourceType;
	mimeType?: string;
	status: "ok" | "not_found" | "error";
	size?: number;
	title?: string;
	error?: string;
}

const EXT_TO_RESOURCE: Record<string, { resourceType: ResourceType; mimeType: string }> = {
	".png": { resourceType: "image", mimeType: "image/png" },
	".jpg": { resourceType: "image", mimeType: "image/jpeg" },
	".jpeg": { resourceType: "image", mimeType: "image/jpeg" },
	".gif": { resourceType: "image", mimeType: "image/gif" },
	".webp": { resourceType: "image", mimeType: "image/webp" },
	".svg": { resourceType: "image", mimeType: "image/svg+xml" },
	".bmp": { resourceType: "image", mimeType: "image/bmp" },
	".ico": { resourceType: "image", mimeType: "image/x-icon" },
	".html": { resourceType: "html", mimeType: "text/html" },
	".htm": { resourceType: "html", mimeType: "text/html" },
	".pdf": { resourceType: "pdf", mimeType: "application/pdf" },
	".mp4": { resourceType: "video", mimeType: "video/mp4" },
	".webm": { resourceType: "video", mimeType: "video/webm" },
	".ogg": { resourceType: "video", mimeType: "video/ogg" },
	".mp3": { resourceType: "audio", mimeType: "audio/mpeg" },
	".wav": { resourceType: "audio", mimeType: "audio/wav" },
	".flac": { resourceType: "audio", mimeType: "audio/flac" },
	".md": { resourceType: "markdown", mimeType: "text/markdown" },
	".mdx": { resourceType: "markdown", mimeType: "text/mdx" },
};

const URL_PATTERN = /^https?:\/\//i;

function isUrl(source: string): boolean {
	return URL_PATTERN.test(source);
}

function detectResource(
	source: string,
	cwd: string,
): {
	resourceType: ResourceType;
	mimeType?: string;
	absolutePath?: string;
} {
	if (isUrl(source)) {
		return { resourceType: "url", absolutePath: source };
	}

	const absolutePath = isAbsolute(source) ? source : resolve(cwd, source);
	const ext = extname(source).toLowerCase();
	const mapped = EXT_TO_RESOURCE[ext];
	if (mapped) {
		return { resourceType: mapped.resourceType, mimeType: mapped.mimeType, absolutePath };
	}
	return { resourceType: "text", mimeType: "text/plain", absolutePath };
}

const PreviewParams = Type.Object({
	source: Type.String({ description: "File path or URL to preview" }),
	title: Type.Optional(Type.String({ description: "Optional display title for the card" })),
});

export default function (pi: ExtensionAPI) {
	pi.registerTool({
		name: "preview",
		label: "Preview",
		description:
			"Preview a resource (image, URL, PDF, video, audio, markdown, etc.) as a card in the UI. Does not send file content to the LLM.",
		promptSnippet: "Preview a file or URL as a card",
		parameters: PreviewParams,

		async execute(
			_toolCallId: string,
			params: { source: string; title?: string },
			_signal?: AbortSignal,
			_onUpdate?: unknown,
			ctx?: ExtensionContext,
		): Promise<AgentToolResult<PreviewDetails>> {
			const cwd = ctx?.cwd ?? process.cwd();

			if (!params.source?.trim()) {
				return {
					content: [{ type: "text", text: "Error: source is required" }],
					details: { source: "", resourceType: "text", status: "error", error: "source required" },
				};
			}

			const { resourceType, mimeType, absolutePath } = detectResource(params.source, cwd);

			if (resourceType === "url") {
				return {
					content: [{ type: "text", text: `Preview: ${params.source} (url)` }],
					details: {
						source: params.source,
						absolutePath: params.source,
						resourceType: "url",
						status: "ok",
						title: params.title,
					},
				};
			}

			if (!absolutePath || !existsSync(absolutePath)) {
				return {
					content: [{ type: "text", text: `Preview: ${params.source} not found` }],
					details: {
						source: params.source,
						absolutePath,
						resourceType,
						status: "not_found",
						title: params.title,
						error: "file not found",
					},
				};
			}

			const stat = statSync(absolutePath);
			if (stat.isDirectory()) {
				return {
					content: [{ type: "text", text: `Preview: ${params.source} is a directory` }],
					details: {
						source: params.source,
						absolutePath,
						resourceType,
						status: "error",
						title: params.title,
						error: "is a directory",
					},
				};
			}

			const sizeStr =
				stat.size > 1024 * 1024
					? `${(stat.size / (1024 * 1024)).toFixed(1)}MB`
					: stat.size > 1024
						? `${(stat.size / 1024).toFixed(1)}KB`
						: `${stat.size}B`;

			return {
				content: [
					{
						type: "text",
						text: `Preview: ${params.source} (${resourceType}${mimeType ? `, ${mimeType}` : ""}, ${sizeStr})`,
					},
				],
				details: {
					source: params.source,
					absolutePath,
					resourceType,
					mimeType,
					status: "ok",
					size: stat.size,
					title: params.title,
				},
			};
		},

		renderCall(args, theme) {
			let text = theme.fg("toolTitle", theme.bold("preview "));
			if (args.title) text += theme.fg("dim", `"${args.title}" `);
			text += theme.fg("muted", args.source ?? "");
			return new Text(text, 0, 0);
		},

		renderResult(result, { expanded: _expanded }, theme) {
			const details = result.details as PreviewDetails | undefined;
			if (!details) {
				const text = result.content[0];
				return new Text(text?.type === "text" ? text.text : "", 0, 0);
			}

			if (details.error || details.status === "not_found") {
				return new Text(theme.fg("error", `Preview: ${details.error ?? "error"}`), 0, 0);
			}

			const icon = resourceIcon(details.resourceType);
			const label = details.title ?? details.source;
			const sizeStr = details.size ? ` (${formatSize(details.size)})` : "";

			return new Text(`${theme.fg("success", icon)} ${theme.fg("muted", `${label}${sizeStr}`)}`, 0, 0);
		},
	});
}

function resourceIcon(type: ResourceType): string {
	switch (type) {
		case "image":
			return "🖼";
		case "url":
			return "🔗";
		case "video":
			return "🎬";
		case "audio":
			return "🎵";
		case "pdf":
			return "📄";
		case "html":
			return "🌐";
		case "markdown":
			return "📝";
		default:
			return "📋";
	}
}

function formatSize(bytes: number): string {
	if (bytes > 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
	if (bytes > 1024) return `${(bytes / 1024).toFixed(1)}KB`;
	return `${bytes}B`;
}
