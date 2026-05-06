import { randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TruncationResult } from "./truncate.js";
import { DEFAULT_MAX_BYTES, truncateTail } from "./truncate.js";

/**
 * Collects output chunks in a rolling buffer with temp-file overflow.
 * When output exceeds maxBytes, the full output is spilled to a temp file
 * and the in-memory buffer is kept within maxChunksBytes.
 *
 * Usage:
 *   const collector = new OutputCollector();
 *   collector.push(data);
 *   const truncation = collector.finalize();
 *   collector.close();
 *   console.log(collector.fullOutputPath);
 */
export class OutputCollector {
	private chunks: Buffer[] = [];
	private chunksBytes = 0;
	private totalBytes = 0;
	private tempFilePath: string | undefined;
	private tempFileStream: ReturnType<typeof createWriteStream> | undefined;
	private readonly maxChunksBytes: number;
	private readonly maxBytes: number;

	constructor(options?: { maxBytes?: number; maxChunksBytes?: number }) {
		this.maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES;
		this.maxChunksBytes = options?.maxChunksBytes ?? this.maxBytes * 2;
	}

	push(data: Buffer): void {
		this.totalBytes += data.length;
		if (this.totalBytes > this.maxBytes) this.ensureTempFile();
		if (this.tempFileStream) this.tempFileStream.write(data);
		this.chunks.push(data);
		this.chunksBytes += data.length;
		while (this.chunksBytes > this.maxChunksBytes && this.chunks.length > 1) {
			const removed = this.chunks.shift()!;
			this.chunksBytes -= removed.length;
		}
	}

	getBufferedText(): string {
		return Buffer.concat(this.chunks).toString("utf-8");
	}

	getTruncation(): TruncationResult {
		const fullText = this.getBufferedText();
		const result = truncateTail(fullText);
		if (result.truncated) this.ensureTempFile();
		return result;
	}

	finalize(): TruncationResult {
		const truncation = this.getTruncation();
		this.close();
		return truncation;
	}

	close(): void {
		if (this.tempFileStream) {
			this.tempFileStream.end();
		}
	}

	get fullOutputPath(): string | undefined {
		return this.tempFilePath;
	}

	get totalBytesWritten(): number {
		return this.totalBytes;
	}

	private ensureTempFile(): void {
		if (this.tempFilePath) return;
		const id = randomBytes(8).toString("hex");
		this.tempFilePath = join(tmpdir(), `pi-bash-${id}.log`);
		this.tempFileStream = createWriteStream(this.tempFilePath);
		for (const chunk of this.chunks) this.tempFileStream.write(chunk);
	}
}
