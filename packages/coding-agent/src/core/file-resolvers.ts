import type { Stats } from "node:fs";
import { createReadStream } from "node:fs";
import { stat as fsStat, open } from "node:fs/promises";
import { createInterface } from "node:readline";
import type { Api, ImageContent, Model, TextContent } from "@dyyz1993/pi-ai";
import { formatDimensionNote, resizeImage } from "../utils/image-resize.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";
import type { ImageAssetRef, ImageAssetStore } from "./assets.ts";
import { DEFAULT_MAX_BYTES, DEFAULT_MAX_LINES, formatSize, type TruncationResult } from "./tools/truncate.ts";

export type FileResolverContent = TextContent | ImageContent;
export type FileResolverDetails = {
	asset?: ImageAssetRef;
	resolver?: string;
	[key: string]: unknown;
};

export interface FileResolverOperations {
	readFile: (absolutePath: string) => Promise<Buffer>;
	stat?: (absolutePath: string) => Promise<Pick<Stats, "size">>;
	createReadStream?: typeof createReadStream;
	detectImageMimeType?: (absolutePath: string) => Promise<string | null | undefined>;
}

export interface FileResolverContext {
	absolutePath: string;
	cwd: string;
	operations: FileResolverOperations;
	autoResizeImages: boolean;
	assetStore?: ImageAssetStore;
	model?: Model<Api>;
	text?: {
		offset?: number;
		limit?: number;
	};
}

export interface FileResolverResult {
	content: FileResolverContent[];
	details?: FileResolverDetails;
	fileReferenceText?: string;
	images?: ImageContent[];
}

export interface FileResolver {
	name: string;
	resolve(ctx: FileResolverContext): Promise<FileResolverResult | undefined>;
}

type ImageContentWithAsset = ImageContent & { asset?: ImageAssetRef };

interface TextReadResult {
	text: string;
	truncation?: TruncationResult;
}

function getNonVisionImageNote(model: Model<Api> | undefined): string | undefined {
	if (!model || model.input.includes("image")) {
		return undefined;
	}
	return "[Current model does not support images. The image will be omitted from this request.]";
}

function formatImageFileReference(absolutePath: string, dimensionNote?: string, asset?: ImageAssetRef): string {
	const parts: string[] = [];
	if (dimensionNote) parts.push(dimensionNote);
	if (asset) parts.push(`[Image asset: ${asset.id}]`);
	return `<file name="${absolutePath}">${parts.join("\n")}</file>\n`;
}

export function createImageFileResolver(): FileResolver {
	return {
		name: "image-file-resolver",
		async resolve(ctx) {
			const detectImageMimeType = ctx.operations.detectImageMimeType ?? detectSupportedImageMimeTypeFromFile;
			const mimeType = await detectImageMimeType(ctx.absolutePath);
			if (!mimeType) return undefined;

			const buffer = await ctx.operations.readFile(ctx.absolutePath);
			const nonVisionImageNote = getNonVisionImageNote(ctx.model);

			if (ctx.autoResizeImages) {
				const resized = await resizeImage(buffer, mimeType);
				if (!resized) {
					let textNote = `Read image file [${mimeType}]\n[Image omitted: could not be resized below the inline image size limit.]`;
					if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
					return {
						content: [{ type: "text", text: textNote }],
						fileReferenceText: `<file name="${ctx.absolutePath}">[Image omitted: could not be resized below the inline image size limit.]</file>\n`,
						images: [],
					};
				}

				const resizedBuffer = Buffer.from(resized.data, "base64");
				const asset = ctx.assetStore
					? await ctx.assetStore.putImage({
							bytes: resizedBuffer,
							mimeType: resized.mimeType,
							sourcePath: ctx.absolutePath,
						})
					: undefined;
				const dimensionNote = formatDimensionNote(resized);
				let textNote = `Read image file [${resized.mimeType}]`;
				if (dimensionNote) textNote += `\n${dimensionNote}`;
				if (asset) textNote += `\n[Image asset: ${asset.id}]`;
				if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
				const imageContent: ImageContentWithAsset = {
					type: "image",
					data: resized.data,
					mimeType: resized.mimeType,
					asset,
				};
				return {
					content: [{ type: "text", text: textNote }, imageContent],
					details: asset ? { asset } : undefined,
					fileReferenceText: formatImageFileReference(ctx.absolutePath, dimensionNote, asset),
					images: [imageContent],
				};
			}

			const asset = ctx.assetStore
				? await ctx.assetStore.putImage({
						bytes: buffer,
						mimeType,
						sourcePath: ctx.absolutePath,
					})
				: undefined;
			let textNote = `Read image file [${mimeType}]`;
			if (asset) textNote += `\n[Image asset: ${asset.id}]`;
			if (nonVisionImageNote) textNote += `\n${nonVisionImageNote}`;
			const imageContent: ImageContentWithAsset = {
				type: "image",
				data: buffer.toString("base64"),
				mimeType,
				asset,
			};
			return {
				content: [{ type: "text", text: textNote }, imageContent],
				details: asset ? { asset } : undefined,
				fileReferenceText: formatImageFileReference(ctx.absolutePath, undefined, asset),
				images: [imageContent],
			};
		},
	};
}

function splitLinesForCounting(content: string): string[] {
	if (content.length === 0) return [];
	const lines = content.split("\n");
	if (content.endsWith("\n")) lines.pop();
	return lines;
}

function buildTextReadOutput(args: {
	absolutePath: string;
	content: string;
	totalLines: number;
	totalBytes: number;
	startLineDisplay: number;
	userLimitedLines?: number;
	truncated: boolean;
	truncatedBy: "lines" | "bytes" | null;
	outputLines: number;
	outputBytes: number;
	firstLineExceedsLimit: boolean;
	firstLineSizeBytes?: number;
}): TextReadResult {
	const truncation: TruncationResult = {
		content: args.content,
		truncated: args.truncated,
		truncatedBy: args.truncatedBy,
		totalLines: args.totalLines,
		totalBytes: args.totalBytes,
		outputLines: args.outputLines,
		outputBytes: args.outputBytes,
		lastLinePartial: false,
		firstLineExceedsLimit: args.firstLineExceedsLimit,
		maxLines: DEFAULT_MAX_LINES,
		maxBytes: DEFAULT_MAX_BYTES,
	};

	if (args.firstLineExceedsLimit) {
		return {
			text: `[Line ${args.startLineDisplay} is ${formatSize(args.firstLineSizeBytes ?? 0)}, exceeds ${formatSize(DEFAULT_MAX_BYTES)} limit. Use bash: sed -n '${args.startLineDisplay}p' ${args.absolutePath} | head -c ${DEFAULT_MAX_BYTES}]`,
			truncation,
		};
	}

	if (args.truncated) {
		const endLineDisplay = args.startLineDisplay + args.outputLines - 1;
		const nextOffset = endLineDisplay + 1;
		const suffix =
			args.truncatedBy === "lines"
				? `[Showing lines ${args.startLineDisplay}-${endLineDisplay} of ${args.totalLines}. Use offset=${nextOffset} to continue.]`
				: `[Showing lines ${args.startLineDisplay}-${endLineDisplay} of ${args.totalLines} (${formatSize(DEFAULT_MAX_BYTES)} limit). Use offset=${nextOffset} to continue.]`;
		return { text: `${args.content}\n\n${suffix}`, truncation };
	}

	if (args.userLimitedLines !== undefined && args.startLineDisplay - 1 + args.userLimitedLines < args.totalLines) {
		const remaining = args.totalLines - (args.startLineDisplay - 1 + args.userLimitedLines);
		const nextOffset = args.startLineDisplay - 1 + args.userLimitedLines + 1;
		return {
			text: `${args.content}\n\n[${remaining} more lines in file. Use offset=${nextOffset} to continue.]`,
		};
	}

	return { text: args.content };
}

function readTextFromBuffer(content: string, absolutePath: string, offset?: number, limit?: number): TextReadResult {
	const lines = splitLinesForCounting(content);
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	if (startLine >= lines.length) {
		throw new Error(`Offset ${offset} is beyond end of file (${lines.length} lines total)`);
	}

	const maxSelectableLines = limit === undefined ? DEFAULT_MAX_LINES : Math.min(limit, DEFAULT_MAX_LINES);
	const selectedLines = lines.slice(startLine);
	const outputLinesArr: string[] = [];
	let outputBytes = 0;
	let truncated = false;
	let truncatedBy: "lines" | "bytes" | null = null;
	let firstLineExceedsLimit = false;
	let firstLineSizeBytes: number | undefined;

	for (let index = 0; index < selectedLines.length && index < maxSelectableLines; index++) {
		const line = selectedLines[index];
		const lineBytes = Buffer.byteLength(line, "utf-8");
		if (index === 0 && lineBytes > DEFAULT_MAX_BYTES) {
			firstLineExceedsLimit = true;
			firstLineSizeBytes = lineBytes;
			truncated = true;
			truncatedBy = "bytes";
			break;
		}
		const bytesWithSeparator = lineBytes + (outputLinesArr.length > 0 ? 1 : 0);
		if (outputBytes + bytesWithSeparator > DEFAULT_MAX_BYTES) {
			truncated = true;
			truncatedBy = "bytes";
			break;
		}
		outputLinesArr.push(line);
		outputBytes += bytesWithSeparator;
	}

	if (!truncated && limit === undefined && selectedLines.length > outputLinesArr.length) {
		truncated = true;
		truncatedBy = "lines";
	}

	return buildTextReadOutput({
		absolutePath,
		content: outputLinesArr.join("\n"),
		totalLines: lines.length,
		totalBytes: Buffer.byteLength(content, "utf-8"),
		startLineDisplay,
		userLimitedLines: limit === undefined ? undefined : Math.min(limit, outputLinesArr.length),
		truncated,
		truncatedBy,
		outputLines: outputLinesArr.length,
		outputBytes,
		firstLineExceedsLimit,
		firstLineSizeBytes,
	});
}

async function readTextFromStream(ctx: FileResolverContext): Promise<TextReadResult> {
	const offset = ctx.text?.offset;
	const limit = ctx.text?.limit;
	const startLine = offset ? Math.max(0, offset - 1) : 0;
	const startLineDisplay = startLine + 1;
	const maxSelectableLines = limit === undefined ? DEFAULT_MAX_LINES : Math.min(limit, DEFAULT_MAX_LINES);
	const stats =
		(await ctx.operations.stat?.(ctx.absolutePath)) ?? (await fsStat(ctx.absolutePath).catch(() => undefined));

	if (startLine === 0 && stats && stats.size > DEFAULT_MAX_BYTES) {
		const fd = await open(ctx.absolutePath, "r");
		try {
			const probe = Buffer.alloc(DEFAULT_MAX_BYTES + 1);
			const { bytesRead } = await fd.read(probe, 0, probe.length, 0);
			const head = probe.subarray(0, bytesRead);
			if (!head.includes(10) && !head.includes(13)) {
				return buildTextReadOutput({
					absolutePath: ctx.absolutePath,
					content: "",
					totalLines: 1,
					totalBytes: stats.size,
					startLineDisplay,
					truncated: true,
					truncatedBy: "bytes",
					outputLines: 0,
					outputBytes: 0,
					firstLineExceedsLimit: true,
					firstLineSizeBytes: stats.size,
				});
			}
		} finally {
			await fd.close();
		}
	}

	const readStream = (ctx.operations.createReadStream ?? createReadStream)(ctx.absolutePath, { encoding: "utf8" });
	const rl = createInterface({ input: readStream, crlfDelay: Infinity });
	const outputLinesArr: string[] = [];
	let totalLines = 0;
	let outputBytes = 0;
	let truncated = false;
	let truncatedBy: "lines" | "bytes" | null = null;
	let firstLineExceedsLimit = false;
	let firstLineSizeBytes: number | undefined;
	let collectingStopped = false;

	for await (const line of rl) {
		totalLines += 1;
		if (totalLines <= startLine) continue;
		if (collectingStopped) continue;

		if (outputLinesArr.length >= maxSelectableLines) {
			if (limit === undefined) {
				truncated = true;
				truncatedBy = "lines";
			}
			collectingStopped = true;
			continue;
		}

		const lineBytes = Buffer.byteLength(line, "utf-8");
		if (outputLinesArr.length === 0 && lineBytes > DEFAULT_MAX_BYTES) {
			firstLineExceedsLimit = true;
			firstLineSizeBytes = lineBytes;
			truncated = true;
			truncatedBy = "bytes";
			collectingStopped = true;
			continue;
		}

		const bytesWithSeparator = lineBytes + (outputLinesArr.length > 0 ? 1 : 0);
		if (outputBytes + bytesWithSeparator > DEFAULT_MAX_BYTES) {
			truncated = true;
			truncatedBy = "bytes";
			collectingStopped = true;
			continue;
		}

		outputLinesArr.push(line);
		outputBytes += bytesWithSeparator;
	}

	if (startLine >= totalLines) {
		throw new Error(`Offset ${offset} is beyond end of file (${totalLines} lines total)`);
	}

	return buildTextReadOutput({
		absolutePath: ctx.absolutePath,
		content: outputLinesArr.join("\n"),
		totalLines,
		totalBytes: stats?.size ?? outputBytes,
		startLineDisplay,
		userLimitedLines: limit === undefined ? undefined : Math.min(limit, outputLinesArr.length),
		truncated,
		truncatedBy,
		outputLines: outputLinesArr.length,
		outputBytes,
		firstLineExceedsLimit,
		firstLineSizeBytes,
	});
}

export function createTextFileResolver(): FileResolver {
	return {
		name: "text-file-resolver",
		async resolve(ctx) {
			const readResult = ctx.operations.createReadStream
				? await readTextFromStream(ctx)
				: readTextFromBuffer(
						(await ctx.operations.readFile(ctx.absolutePath)).toString("utf-8"),
						ctx.absolutePath,
						ctx.text?.offset,
						ctx.text?.limit,
					);
			return {
				content: [{ type: "text", text: readResult.text }],
				details: readResult.truncation ? { truncation: readResult.truncation } : undefined,
				fileReferenceText: `<file name="${ctx.absolutePath}">\n${readResult.text}\n</file>\n`,
			};
		},
	};
}

export function createDefaultFileResolvers(): FileResolver[] {
	return [createImageFileResolver(), createTextFileResolver()];
}

export async function resolveFileWithResolvers(
	resolvers: readonly FileResolver[],
	ctx: FileResolverContext,
): Promise<FileResolverResult | undefined> {
	for (const resolver of resolvers) {
		const result = await resolver.resolve(ctx);
		if (result) {
			return {
				...result,
				details: result.details ? { ...result.details, resolver: resolver.name } : undefined,
			};
		}
	}
	return undefined;
}
