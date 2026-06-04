import { describe, expect, test } from "vitest";

function collectLinesBudget(
	lines: string[],
	maxLines: number,
	maxBytes: number,
	direction: "head" | "tail",
): { lines: string[]; bytes: number; truncatedBy: "lines" | "bytes" } {
	const result: string[] = [];
	let bytes = 0;
	let truncatedBy: "lines" | "bytes" = "lines";

	if (direction === "head") {
		for (let i = 0; i < lines.length && result.length < maxLines; i++) {
			const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (result.length > 0 ? 1 : 0);
			if (bytes + lineBytes > maxBytes) {
				truncatedBy = "bytes";
				break;
			}
			result.push(lines[i]);
			bytes += lineBytes;
		}
		if (result.length >= maxLines && bytes <= maxBytes) truncatedBy = "lines";
	} else {
		for (let i = lines.length - 1; i >= 0 && result.length < maxLines; i--) {
			const lineBytes = Buffer.byteLength(lines[i], "utf-8") + (result.length > 0 ? 1 : 0);
			if (bytes + lineBytes > maxBytes) {
				truncatedBy = "bytes";
				break;
			}
			result.unshift(lines[i]);
			bytes += lineBytes;
		}
		if (result.length >= maxLines && bytes <= maxBytes) truncatedBy = "lines";
	}

	return { lines: result, bytes, truncatedBy };
}

function buildInlineNotice(totalLines: number, headLines: number, tailLines: number, omittedLines: number): string {
	return `--- ... ${omittedLines} lines omitted (showing ${headLines} head + ${tailLines} tail of ${totalLines} total) ... ---`;
}

describe("output-guard truncation: head+tail", () => {
	test("collectLinesBudget head: respects line limit", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const result = collectLinesBudget(lines, 10, Infinity, "head");
		expect(result.lines).toHaveLength(10);
		expect(result.lines[0]).toBe("line 1");
		expect(result.lines[9]).toBe("line 10");
		expect(result.truncatedBy).toBe("lines");
	});

	test("collectLinesBudget head: respects byte limit", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const result = collectLinesBudget(lines, 100, 40, "head");
		expect(result.lines.length).toBeLessThan(100);
		expect(result.truncatedBy).toBe("bytes");
	});

	test("collectLinesBudget tail: takes from the end", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const result = collectLinesBudget(lines, 10, Infinity, "tail");
		expect(result.lines).toHaveLength(10);
		expect(result.lines[0]).toBe("line 91");
		expect(result.lines[9]).toBe("line 100");
	});

	test("collectLinesBudget tail: respects byte limit", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
		const result = collectLinesBudget(lines, 100, 40, "tail");
		expect(result.lines.length).toBeLessThan(100);
		expect(result.truncatedBy).toBe("bytes");
	});

	test("buildInlineNotice: shows head+tail summary", () => {
		const notice = buildInlineNotice(5000, 1400, 600, 3000);
		expect(notice).toContain("3000 lines omitted");
		expect(notice).toContain("1400 head + 600 tail");
		expect(notice).toContain("5000 total");
	});

	test("head+tail together covers expected range", () => {
		const lines = Array.from({ length: 5000 }, (_, i) => `line ${i + 1}`);
		const headLineBudget = 1400;
		const tailLineBudget = 600;

		const head = collectLinesBudget(lines, headLineBudget, Infinity, "head");
		const tailLinesSlice = lines.slice(5000 - tailLineBudget * 2);
		const tail = collectLinesBudget(tailLinesSlice, tailLineBudget, Infinity, "tail");

		expect(head.lines[0]).toBe("line 1");
		expect(head.lines[head.lines.length - 1]).toBe(`line ${headLineBudget}`);
		expect(tail.lines[tail.lines.length - 1]).toBe("line 5000");
		expect(head.lines.length + tail.lines.length).toBeLessThanOrEqual(5000);
	});

	test("no overlap between head and tail", () => {
		const total = 100;
		const headBudget = 70;
		const tailBudget = 30;
		const lines = Array.from({ length: total }, (_, i) => `line ${i}`);

		const head = collectLinesBudget(lines, headBudget, Infinity, "head");
		const tailLinesSlice = lines.slice(total - tailBudget * 2);
		const tail = collectLinesBudget(tailLinesSlice, tailBudget, Infinity, "tail");

		const headSet = new Set(head.lines);
		const overlap = tail.lines.filter((l) => headSet.has(l));
		expect(overlap).toHaveLength(0);
	});

	test("full output assembly: head + notice + tail", () => {
		const lines = Array.from({ length: 100 }, (_, i) => `result ${i + 1}`);
		const headCount = 7;
		const tailCount = 3;

		const headText = lines.slice(0, headCount).join("\n");
		const tailText = lines.slice(lines.length - tailCount).join("\n");
		const notice = buildInlineNotice(100, headCount, tailCount, 90);

		const full = `${headText}\n\n${notice}\n\n${tailText}`;

		expect(full).toContain("result 1");
		expect(full).toContain("result 7");
		expect(full).toContain("90 lines omitted");
		expect(full).toContain("result 98");
		expect(full).toContain("result 100");
		expect(full).not.toContain("result 50");
	});
});
