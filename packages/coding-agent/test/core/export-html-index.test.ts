import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const PRIVATE_FUNCTION_LOGIC = {
	parseColor(color: string): { r: number; g: number; b: number } | undefined {
		const hexMatch = color.match(/^#([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
		if (hexMatch) {
			return {
				r: Number.parseInt(hexMatch[1]!, 16),
				g: Number.parseInt(hexMatch[2]!, 16),
				b: Number.parseInt(hexMatch[3]!, 16),
			};
		}
		const rgbMatch = color.match(/^rgb\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);
		if (rgbMatch) {
			return {
				r: Number.parseInt(rgbMatch[1]!, 10),
				g: Number.parseInt(rgbMatch[2]!, 10),
				b: Number.parseInt(rgbMatch[3]!, 10),
			};
		}
		return undefined;
	},

	getLuminance(r: number, g: number, b: number): number {
		const toLinear = (c: number) => {
			const s = c / 255;
			return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
		};
		return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
	},

	adjustBrightness(color: string, factor: number): string {
		const parsed = PRIVATE_FUNCTION_LOGIC.parseColor(color);
		if (!parsed) return color;
		const adjust = (c: number) => Math.min(255, Math.max(0, Math.round(c * factor)));
		return `rgb(${adjust(parsed.r)}, ${adjust(parsed.g)}, ${adjust(parsed.b)})`;
	},

	deriveExportColors(baseColor: string): { pageBg: string; cardBg: string; infoBg: string } {
		const parsed = PRIVATE_FUNCTION_LOGIC.parseColor(baseColor);
		if (!parsed) {
			return { pageBg: "rgb(24, 24, 30)", cardBg: "rgb(30, 30, 36)", infoBg: "rgb(60, 55, 40)" };
		}
		const luminance = PRIVATE_FUNCTION_LOGIC.getLuminance(parsed.r, parsed.g, parsed.b);
		const isLight = luminance > 0.5;
		if (isLight) {
			return {
				pageBg: PRIVATE_FUNCTION_LOGIC.adjustBrightness(baseColor, 0.96),
				cardBg: baseColor,
				infoBg: `rgb(${Math.min(255, parsed.r + 10)}, ${Math.min(255, parsed.g + 5)}, ${Math.max(0, parsed.b - 20)})`,
			};
		}
		return {
			pageBg: PRIVATE_FUNCTION_LOGIC.adjustBrightness(baseColor, 0.7),
			cardBg: PRIVATE_FUNCTION_LOGIC.adjustBrightness(baseColor, 0.85),
			infoBg: `rgb(${Math.min(255, parsed.r + 20)}, ${Math.min(255, parsed.g + 15)}, ${parsed.b})`,
		};
	},
};

describe("export-html pure functions (private logic)", () => {
	describe("parseColor", () => {
		it("parses 6-digit hex", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("#ff00ff")).toEqual({ r: 255, g: 0, b: 255 });
		});

		it("parses hex case-insensitively", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("#AABBCC")).toEqual({ r: 170, g: 187, b: 204 });
		});

		it("parses rgb() format", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("rgb(100, 200, 50)")).toEqual({ r: 100, g: 200, b: 50 });
		});

		it("parses rgb() with extra spaces", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("rgb(  10 , 20 , 30  )")).toEqual({ r: 10, g: 20, b: 30 });
		});

		it("returns undefined for 3-digit hex", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("#fff")).toBeUndefined();
		});

		it("returns undefined for named colors", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("red")).toBeUndefined();
		});

		it("returns undefined for empty string", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("")).toBeUndefined();
		});

		it("returns undefined for invalid format", () => {
			expect(PRIVATE_FUNCTION_LOGIC.parseColor("hsl(0,0,0)")).toBeUndefined();
		});
	});

	describe("getLuminance", () => {
		it("returns 0 for black", () => {
			expect(PRIVATE_FUNCTION_LOGIC.getLuminance(0, 0, 0)).toBeCloseTo(0, 4);
		});

		it("returns 1 for white", () => {
			expect(PRIVATE_FUNCTION_LOGIC.getLuminance(255, 255, 255)).toBeCloseTo(1, 4);
		});

		it("returns ~0.2126 for pure red", () => {
			expect(PRIVATE_FUNCTION_LOGIC.getLuminance(255, 0, 0)).toBeCloseTo(0.2126, 3);
		});

		it("returns ~0.7152 for pure green", () => {
			expect(PRIVATE_FUNCTION_LOGIC.getLuminance(0, 255, 0)).toBeCloseTo(0.7152, 3);
		});

		it("returns ~0.0722 for pure blue", () => {
			expect(PRIVATE_FUNCTION_LOGIC.getLuminance(0, 0, 255)).toBeCloseTo(0.0722, 3);
		});

		it("returns mid value for gray", () => {
			const lum = PRIVATE_FUNCTION_LOGIC.getLuminance(128, 128, 128);
			expect(lum).toBeGreaterThan(0);
			expect(lum).toBeLessThan(1);
		});
	});

	describe("adjustBrightness", () => {
		it("brightens a color", () => {
			expect(PRIVATE_FUNCTION_LOGIC.adjustBrightness("#808080", 1.5)).toBe("rgb(192, 192, 192)");
		});

		it("darkens a color", () => {
			expect(PRIVATE_FUNCTION_LOGIC.adjustBrightness("#ffffff", 0.5)).toBe("rgb(128, 128, 128)");
		});

		it("clamps to 255 maximum", () => {
			expect(PRIVATE_FUNCTION_LOGIC.adjustBrightness("#ffffff", 2)).toBe("rgb(255, 255, 255)");
		});

		it("clamps to 0 minimum", () => {
			expect(PRIVATE_FUNCTION_LOGIC.adjustBrightness("#000000", 0.5)).toBe("rgb(0, 0, 0)");
		});

		it("returns original for unparseable color", () => {
			expect(PRIVATE_FUNCTION_LOGIC.adjustBrightness("red", 1.5)).toBe("red");
		});
	});

	describe("deriveExportColors", () => {
		it("returns defaults for unparseable color", () => {
			const result = PRIVATE_FUNCTION_LOGIC.deriveExportColors("invalid");
			expect(result).toEqual({
				pageBg: "rgb(24, 24, 30)",
				cardBg: "rgb(30, 30, 36)",
				infoBg: "rgb(60, 55, 40)",
			});
		});

		it("returns dark scheme for dark base color", () => {
			const result = PRIVATE_FUNCTION_LOGIC.deriveExportColors("#1e1e2e");
			expect(result.pageBg).toMatch(/^rgb\(/);
			expect(result.cardBg).toMatch(/^rgb\(/);
			expect(result.infoBg).toMatch(/^rgb\(/);
		});

		it("returns light scheme for light base color", () => {
			const result = PRIVATE_FUNCTION_LOGIC.deriveExportColors("#f0f0f0");
			expect(result.pageBg).toMatch(/^rgb\(/);
			expect(result.cardBg).toBe("#f0f0f0");
		});
	});
});

describe("exportFromFile", () => {
	let tempDir: string;
	let previousAgentDir: string | undefined;

	beforeEach(() => {
		tempDir = mkdtempSync(join(tmpdir(), "pi-export-file-"));
		previousAgentDir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = join(tempDir, "agent");
		mkdirSync(join(process.env.PI_CODING_AGENT_DIR!, "themes"), { recursive: true });
	});

	afterEach(() => {
		rmSync(tempDir, { recursive: true, force: true });
		if (previousAgentDir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = previousAgentDir;
		}
	});

	it("throws for nonexistent file", async () => {
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		await expect(exportFromFile("/nonexistent/file.jsonl")).rejects.toThrow("File not found");
	});

	it("exports a session file to HTML", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "abc123", version: 3 });
		const userMsg = JSON.stringify({ type: "message", message: { role: "user", content: "Hello world" } });
		const sessionPath = join(tempDir, "test-session.jsonl");
		writeFileSync(sessionPath, `${header}\n${userMsg}\n`);

		const outputPath = join(tempDir, "output.html");
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		const result = await exportFromFile(sessionPath, { outputPath });

		expect(result).toBe(outputPath);
		expect(existsSync(outputPath)).toBe(true);

		const html = readFileSync(outputPath, "utf-8");
		expect(html).toContain("<!DOCTYPE html>");
		expect(html).toContain("</html>");
		expect(html).toContain('id="session-data"');
	});

	it("uses default output path when none specified", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "def456", version: 3 });
		const sessionPath = join(tempDir, "mysession.jsonl");
		writeFileSync(sessionPath, `${header}\n`);

		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		const originalCwd = process.cwd();
		process.chdir(tempDir);
		try {
			const result = await exportFromFile(sessionPath);
			expect(result).toContain("mysession");
			expect(result).toMatch(/\.html$/);
			expect(existsSync(result)).toBe(true);
		} finally {
			process.chdir(originalCwd);
		}
	});

	it("accepts string option as output path", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "str789", version: 3 });
		const sessionPath = join(tempDir, "str-session.jsonl");
		writeFileSync(sessionPath, `${header}\n`);

		const outputPath = join(tempDir, "string-output.html");
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		const result = await exportFromFile(sessionPath, outputPath);

		expect(result).toBe(outputPath);
	});

	it("exports session with messages", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "msg001", version: 3 });
		const userMsg = JSON.stringify({ type: "message", message: { role: "user", content: "What is 2+2?" } });
		const assistantMsg = JSON.stringify({
			type: "message",
			message: { role: "assistant", content: [{ type: "text", text: "The answer is 4." }] },
		});
		const sessionPath = join(tempDir, "msg-session.jsonl");
		writeFileSync(sessionPath, `${header}\n${userMsg}\n${assistantMsg}\n`);

		const outputPath = join(tempDir, "msg-output.html");
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		await exportFromFile(sessionPath, { outputPath });

		const html = readFileSync(outputPath, "utf-8");
		expect(html).toContain("<!DOCTYPE html>");

		const match = html.match(/<script id="session-data" type="application\/json">([A-Za-z0-9+/=\n]+)<\/script>/);
		expect(match).toBeTruthy();
		const sessionData = JSON.parse(Buffer.from(match![1]!, "base64").toString("utf-8"));
		expect(sessionData.entries).toHaveLength(2);
	});

	it("exports empty session (header only)", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "empty001", version: 3 });
		const sessionPath = join(tempDir, "empty-session.jsonl");
		writeFileSync(sessionPath, `${header}\n`);

		const outputPath = join(tempDir, "empty-output.html");
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		const result = await exportFromFile(sessionPath, { outputPath });

		expect(existsSync(result)).toBe(true);
		const html = readFileSync(outputPath, "utf-8");
		expect(html).toContain("<!DOCTYPE html>");
	});

	it("produces HTML with CSS theme variables", async () => {
		const header = JSON.stringify({ type: "session", cwd: "/tmp/test", id: "css001", version: 3 });
		const sessionPath = join(tempDir, "css-session.jsonl");
		writeFileSync(sessionPath, `${header}\n`);

		const outputPath = join(tempDir, "css-output.html");
		const { exportFromFile } = await import("../../src/core/export-html/index.js");
		await exportFromFile(sessionPath, { outputPath });

		const html = readFileSync(outputPath, "utf-8");
		expect(html).toContain("--exportPageBg:");
		expect(html).toContain("--exportCardBg:");
		expect(html).toContain("--exportInfoBg:");
	});
});
