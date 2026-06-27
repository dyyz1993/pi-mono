import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getProjectUserStateDir } from "./storage.ts";

export interface ImageAssetRef {
	type: "image";
	id: string;
	mimeType: string;
	size: number;
	sha256: string;
	storage: "inline" | "local" | "remote";
	visibility: "local" | "signed-url" | "public";
	sourcePath?: string;
	localPath?: string;
	previewUrl?: string;
	remoteUrl?: string;
	expiresAt?: string;
}

export interface PutImageAssetInput {
	bytes: Buffer | Uint8Array;
	mimeType: string;
	sourcePath?: string;
	remoteUrl?: string;
	expiresAt?: string;
	visibility?: ImageAssetRef["visibility"];
}

export interface ImageAssetStore {
	putImage(input: PutImageAssetInput): Promise<ImageAssetRef>;
}

export interface LocalImageAssetStoreOptions {
	projectRoot: string;
}

function extensionForMimeType(mimeType: string): string {
	switch (mimeType) {
		case "image/jpeg":
			return "jpg";
		case "image/png":
			return "png";
		case "image/gif":
			return "gif";
		case "image/webp":
			return "webp";
		default:
			return "bin";
	}
}

export class LocalImageAssetStore implements ImageAssetStore {
	private readonly projectRoot: string;

	constructor(options: LocalImageAssetStoreOptions) {
		this.projectRoot = options.projectRoot;
	}

	async putImage(input: PutImageAssetInput): Promise<ImageAssetRef> {
		const bytes = Buffer.isBuffer(input.bytes) ? input.bytes : Buffer.from(input.bytes);
		const sha256 = createHash("sha256").update(bytes).digest("hex");
		const ext = extensionForMimeType(input.mimeType);
		const id = `img_${sha256.slice(0, 16)}`;
		const rootDir = join(getProjectUserStateDir(this.projectRoot), "assets", "images");
		const localPath = join(rootDir, `${id}.${ext}`);

		await mkdir(rootDir, { recursive: true });
		if (!existsSync(localPath)) {
			await writeFile(localPath, bytes);
		}

		return {
			type: "image",
			id,
			mimeType: input.mimeType,
			size: bytes.byteLength,
			sha256,
			storage: input.remoteUrl ? "remote" : "local",
			visibility: input.visibility ?? (input.remoteUrl ? "signed-url" : "local"),
			sourcePath: input.sourcePath,
			localPath,
			remoteUrl: input.remoteUrl,
			previewUrl: input.remoteUrl,
			expiresAt: input.expiresAt,
		};
	}
}

export function createLocalImageAssetStore(options: LocalImageAssetStoreOptions): ImageAssetStore {
	return new LocalImageAssetStore(options);
}
