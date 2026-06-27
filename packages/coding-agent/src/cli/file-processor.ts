/**
 * Process @file CLI arguments into text content and image attachments
 */

import { createReadStream } from "node:fs";
import { access, readFile, stat } from "node:fs/promises";
import type { ImageContent } from "@dyyz1993/pi-ai";
import chalk from "chalk";
import { resolve } from "path";
import { createLocalImageAssetStore, type ImageAssetStore } from "../core/assets.ts";
import { createDefaultFileResolvers, type FileResolver, resolveFileWithResolvers } from "../core/file-resolvers.ts";
import { resolveReadPath } from "../core/tools/path-utils.ts";
import { detectSupportedImageMimeTypeFromFile } from "../utils/mime.ts";

export interface ProcessedFiles {
	text: string;
	images: ImageContent[];
}

export interface ProcessFileOptions {
	/** Whether to auto-resize images to 2000x2000 max. Default: true */
	autoResizeImages?: boolean;
	/** Asset store for image metadata and preview reuse. Default: project-local store. */
	assetStore?: ImageAssetStore | false;
	/** Pluggable file resolvers. Default includes image resolver. */
	fileResolvers?: readonly FileResolver[] | false;
}

/** Process @file arguments into text content and image attachments */
export async function processFileArguments(fileArgs: string[], options?: ProcessFileOptions): Promise<ProcessedFiles> {
	const autoResizeImages = options?.autoResizeImages ?? true;
	const assetStore =
		options?.assetStore === false
			? undefined
			: (options?.assetStore ?? createLocalImageAssetStore({ projectRoot: process.cwd() }));
	const fileResolvers =
		options?.fileResolvers === false ? [] : (options?.fileResolvers ?? createDefaultFileResolvers());
	let text = "";
	const images: ImageContent[] = [];

	for (const fileArg of fileArgs) {
		// Expand and resolve path (handles ~ expansion and macOS screenshot Unicode spaces)
		const absolutePath = resolve(resolveReadPath(fileArg, process.cwd()));

		// Check if file exists
		try {
			await access(absolutePath);
		} catch {
			console.error(chalk.red(`Error: File not found: ${absolutePath}`));
			process.exit(1);
		}

		// Check if file is empty
		const stats = await stat(absolutePath);
		if (stats.size === 0) {
			// Skip empty files
			continue;
		}

		const resolved = await resolveFileWithResolvers(fileResolvers, {
			absolutePath,
			cwd: process.cwd(),
			operations: {
				readFile,
				stat,
				createReadStream,
				detectImageMimeType: detectSupportedImageMimeTypeFromFile,
			},
			autoResizeImages,
			assetStore,
		});

		if (resolved) {
			text += resolved.fileReferenceText ?? "";
			images.push(...(resolved.images ?? []));
		} else {
			// Handle text file
			try {
				const content = await readFile(absolutePath, "utf-8");
				text += `<file name="${absolutePath}">\n${content}\n</file>\n`;
			} catch (error: unknown) {
				const message = error instanceof Error ? error.message : String(error);
				console.error(chalk.red(`Error: Could not read file ${absolutePath}: ${message}`));
				process.exit(1);
			}
		}
	}

	return { text, images };
}
