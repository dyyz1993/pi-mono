import { existsSync, rmSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { OutputCollector } from "../../src/core/tools/output-collector.js";

describe("OutputCollector", () => {
	const tempFiles: string[] = [];

	afterEach(() => {
		for (const f of tempFiles.splice(0)) {
			try {
				if (existsSync(f)) rmSync(f);
			} catch {}
		}
	});

	it("collects text from buffers", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		collector.push(Buffer.from("hello "));
		collector.push(Buffer.from("world"));
		expect(collector.getBufferedText()).toBe("hello world");
		collector.close();
	});

	it("tracks totalBytesWritten", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		collector.push(Buffer.from("abc"));
		collector.push(Buffer.from("def"));
		expect(collector.totalBytesWritten).toBe(6);
		collector.close();
	});

	it("returns empty text when no data pushed", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		expect(collector.getBufferedText()).toBe("");
		collector.close();
	});

	it("spills to temp file when exceeding maxBytes", () => {
		const collector = new OutputCollector({ maxBytes: 10 });
		collector.push(Buffer.from("hello world!"));
		expect(collector.fullOutputPath).toBeDefined();
		if (collector.fullOutputPath) tempFiles.push(collector.fullOutputPath);
		collector.close();
	});

	it("does not create temp file when under maxBytes", () => {
		const collector = new OutputCollector({ maxBytes: 1024 });
		collector.push(Buffer.from("small"));
		expect(collector.fullOutputPath).toBeUndefined();
		collector.close();
	});

	it("rolls in-memory chunks when exceeding maxChunksBytes", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024, maxChunksBytes: 10 });
		collector.push(Buffer.from("12345"));
		collector.push(Buffer.from("67890"));
		collector.push(Buffer.from("abcde"));
		const text = collector.getBufferedText();
		expect(text).toBe("67890abcde");
		collector.close();
	});

	it("finalize returns truncation result", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		collector.push(Buffer.from("test content"));
		const result = collector.finalize();
		expect(result.content).toBe("test content");
		expect(result.truncated).toBe(false);
	});

	it("getTruncation returns content without closing", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		collector.push(Buffer.from("data"));
		const result = collector.getTruncation();
		expect(result.content).toBe("data");
		collector.push(Buffer.from(" more"));
		expect(collector.getBufferedText()).toBe("data more");
		collector.close();
	});

	it("handles UTF-8 multi-byte characters", () => {
		const collector = new OutputCollector({ maxBytes: 1024 * 1024 });
		collector.push(Buffer.from("日本語テスト"));
		expect(collector.getBufferedText()).toBe("日本語テスト");
		collector.close();
	});
});
