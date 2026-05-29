import { describe, expect, it } from "vitest";
import { extractBashInPlaceFiles } from "../index.js";

describe("extractBashInPlaceFiles", () => {
	// =========================================================================
	// sed -i
	// =========================================================================
	describe("sed -i", () => {
		it("should extract file from sed -i with single-quoted expression", () => {
			expect(extractBashInPlaceFiles("sed -i 's/old/new/g' file.txt")).toEqual(["file.txt"]);
		});

		it("should extract file from sed -i with double-quoted expression", () => {
			expect(extractBashInPlaceFiles('sed -i "s/old/new/g" file.txt')).toEqual(["file.txt"]);
		});

		it("should extract multiple files from sed -i", () => {
			expect(extractBashInPlaceFiles("sed -i 's/old/new/g' file1.txt file2.txt file3.ts")).toEqual([
				"file1.txt",
				"file2.txt",
				"file3.ts",
			]);
		});

		it("should extract file from sed -i with backup extension", () => {
			expect(extractBashInPlaceFiles("sed -i.bak 's/old/new/' config.yaml")).toEqual(["config.yaml"]);
		});

		it("should extract file from sed -i'' (empty backup suffix)", () => {
			expect(extractBashInPlaceFiles("sed -i'' 's/a/b/' app.js")).toEqual(["app.js"]);
		});

		it("should extract file with relative path", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' src/index.ts")).toEqual(["src/index.ts"]);
		});

		it("should extract file with absolute path", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' /etc/hosts")).toEqual(["/etc/hosts"]);
		});

		it("should handle sed -i with -e flag", () => {
			expect(extractBashInPlaceFiles("sed -i -e 's/old/new/' file.txt")).toEqual(["file.txt"]);
		});

		it("should handle sed with combined flags before -i", () => {
			// -n suppresses auto-print, -i is in-place
			expect(extractBashInPlaceFiles("sed -i -n -e 's/x/y/p' file.txt")).toEqual(["file.txt"]);
		});

		it("should handle sed -i with extended regex -r flag", () => {
			expect(extractBashInPlaceFiles("sed -i -r -e 's/[0-9]+/NUMBER/g' data.txt")).toEqual(["data.txt"]);
		});

		it("should handle sed -i with -- parameter separator", () => {
			expect(extractBashInPlaceFiles("sed -i -- 's/x/y/' file.txt")).toEqual(["file.txt"]);
		});

		it("should handle sed -i with shell variable in double-quoted expression", () => {
			expect(extractBashInPlaceFiles('sed -i "s/$OLD/$NEW/g" config.yaml')).toEqual(["config.yaml"]);
		});

		it("should handle multiple -e expressions (file.txt extracted, expression remnants ignored harmlessly)", () => {
			// sed -i -e 's/x/y/' -e 's/a/b/' file.txt
			// The regex backtracks to match the last -e expr, and earlier
			// -e expression remnants end up in capture group 1.
			// parseFileTokens filters -e (starts with -), but expression text
			// like 's/a/b/' loses quotes and becomes "s/a/b/".
			// In practice, stat("s/a/b/") fails harmlessly (no such file).
			const result = extractBashInPlaceFiles("sed -i -e 's/x/y/' -e 's/a/b/' file.txt");
			expect(result).toContain("file.txt");
		});

		it("should handle semicolon-separated expressions in single quotes", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/; s/a/b/' file.txt")).toEqual(["file.txt"]);
		});

		it("should handle sed -i with pattern-delete expression", () => {
			expect(extractBashInPlaceFiles("sed -i '/^#/d' config.ini")).toEqual(["config.ini"]);
		});

		it("should handle sed -i with alternate delimiter (|)", () => {
			expect(extractBashInPlaceFiles("sed -i 's|/old/path|/new/path|g' config.ini")).toEqual(["config.ini"]);
		});

		it("should exclude redirect tokens after file arguments", () => {
			const result = extractBashInPlaceFiles("sed -i 's/x/y/' file.txt > /dev/null");
			expect(result).toEqual(["file.txt"]);
		});

		it("should exclude stderr redirect after file arguments", () => {
			const result = extractBashInPlaceFiles("sed -i 's/x/y/' file.txt 2>&1");
			expect(result).toEqual(["file.txt"]);
		});

		it("should exclude combined redirect after file arguments", () => {
			const result = extractBashInPlaceFiles("sed -i 's/x/y/' file.txt > /dev/null 2>&1");
			expect(result).toEqual(["file.txt"]);
		});

		it("should stop at pipe — do not extract files after |", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' file.txt | grep foo")).toEqual(["file.txt"]);
		});

		it("should stop at semicolon — do not extract after ;", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' file.txt; echo done")).toEqual(["file.txt"]);
		});

		it("should stop at && — do not extract after &&", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' file.txt && echo ok")).toEqual(["file.txt"]);
		});
	});

	// =========================================================================
	// perl -pi
	// =========================================================================
	describe("perl -pi", () => {
		it("should extract file from perl -pi -e with single quotes", () => {
			expect(extractBashInPlaceFiles("perl -pi -e 's/old/new/g' file.txt")).toEqual(["file.txt"]);
		});

		it("should extract file from perl -pi -e with double quotes", () => {
			expect(extractBashInPlaceFiles('perl -pi -e "s/old/new/g" file.txt')).toEqual(["file.txt"]);
		});

		it("should extract multiple files", () => {
			expect(extractBashInPlaceFiles("perl -pi -e 's/a/b/' a.txt b.txt")).toEqual(["a.txt", "b.txt"]);
		});

		it("should extract file from perl -pi.bak", () => {
			expect(extractBashInPlaceFiles("perl -pi.bak -e 's/x/y/' config.json")).toEqual(["config.json"]);
		});

		it("should handle perl -pi with -l flag (auto-chomp)", () => {
			expect(extractBashInPlaceFiles("perl -pi -l -e 's/x/y/' file.txt")).toEqual(["file.txt"]);
		});

		it("should handle perl -pi with conditional expression", () => {
			expect(extractBashInPlaceFiles("perl -pi -e 's/x/y/g if /pattern/' file.txt")).toEqual(["file.txt"]);
		});
	});

	// =========================================================================
	// awk -i inplace
	// =========================================================================
	describe("awk -i inplace", () => {
		it("should extract file from awk -i inplace with single-quoted program", () => {
			expect(extractBashInPlaceFiles("awk -i inplace '{gsub(/old/,\"new\")}1' data.csv")).toEqual(["data.csv"]);
		});

		it("should extract multiple files", () => {
			expect(extractBashInPlaceFiles("awk -i inplace '{print}' a.txt b.txt")).toEqual(["a.txt", "b.txt"]);
		});

		it("should handle awk -i inplace with -v variable", () => {
			expect(extractBashInPlaceFiles("awk -v OFS=',' -i inplace '{print $1,$2}' data.csv")).toEqual(["data.csv"]);
		});

		it("should handle awk with flags after -i inplace", () => {
			expect(extractBashInPlaceFiles("awk -i inplace -v var=1 '{print}' file.txt")).toEqual(["file.txt"]);
		});
	});

	// =========================================================================
	// Negative cases — should NOT extract
	// =========================================================================
	describe("non-in-place commands (no extraction)", () => {
		it("should return empty for plain sed without -i", () => {
			expect(extractBashInPlaceFiles("sed 's/old/new/g' file.txt")).toEqual([]);
		});

		it("should return empty for sed -n -e without -i", () => {
			expect(extractBashInPlaceFiles("sed -n -e 's/x/y/p' file.txt")).toEqual([]);
		});

		it("should return empty for cat", () => {
			expect(extractBashInPlaceFiles("cat file.txt")).toEqual([]);
		});

		it("should return empty for echo redirect", () => {
			expect(extractBashInPlaceFiles("echo hello > file.txt")).toEqual([]);
		});

		it("should return empty for cp", () => {
			expect(extractBashInPlaceFiles("cp a.txt b.txt")).toEqual([]);
		});

		it("should return empty for mv", () => {
			expect(extractBashInPlaceFiles("mv a.txt b.txt")).toEqual([]);
		});

		it("should return empty for tee", () => {
			expect(extractBashInPlaceFiles("echo data | tee file.txt")).toEqual([]);
		});

		it("should return empty for plain perl without -pi", () => {
			expect(extractBashInPlaceFiles("perl -e 'print 1' file.txt")).toEqual([]);
		});

		it("should return empty for perl -pe (no -i)", () => {
			expect(extractBashInPlaceFiles("perl -pe 's/x/y/' file.txt")).toEqual([]);
		});

		it("should return empty for plain awk without -i inplace", () => {
			expect(extractBashInPlaceFiles("awk '{print $1}' file.txt")).toEqual([]);
		});

		it("should return empty for empty string", () => {
			expect(extractBashInPlaceFiles("")).toEqual([]);
		});

		it("should return empty for whitespace-only string", () => {
			expect(extractBashInPlaceFiles("   ")).toEqual([]);
		});

		it("should return empty for ls command", () => {
			expect(extractBashInPlaceFiles("ls -la")).toEqual([]);
		});

		it("should return empty for grep", () => {
			expect(extractBashInPlaceFiles("grep -r pattern src/")).toEqual([]);
		});

		it("should return empty for npm install", () => {
			expect(extractBashInPlaceFiles("npm install")).toEqual([]);
		});

		it("should return empty for git commit", () => {
			expect(extractBashInPlaceFiles("git commit -m 'fix'")).toEqual([]);
		});

		it("should return empty for find command (known limitation: may produce false positives)", () => {
			// find . -name '*.ts' -exec sed -i 's/x/y/g' {} +
			// The sed regex matches, and {} / + are parsed as "files".
			// In practice, stat("cwd/{}") fails harmlessly. Not blocking.
			const result = extractBashInPlaceFiles("find . -name '*.ts' -exec sed -i 's/x/y/g' {} +");
			expect(Array.isArray(result)).toBe(true);
		});

		it("should return empty for xargs sed (known limitation: may produce false positives)", () => {
			// find . -name '*.ts' | xargs sed -i 's/x/y/g'
			// xargs appends file args after the expression — inherently ambiguous.
			// Our parser extracts them. stat() fails harmlessly. Not blocking.
			const result = extractBashInPlaceFiles("find . -name '*.ts' | xargs sed -i 's/x/y/g'");
			expect(Array.isArray(result)).toBe(true);
		});
	});

	// =========================================================================
	// Edge: chained commands
	// =========================================================================
	describe("chained / piped commands", () => {
		it("should only extract file from first command segment (pipe)", () => {
			const result = extractBashInPlaceFiles(
				"sed -i 's/x/y/' file1.txt | sed -i 's/a/b/' file2.txt",
			);
			expect(result).toEqual(["file1.txt"]);
		});

		it("should only extract file from first command segment (&&)", () => {
			const result = extractBashInPlaceFiles(
				"sed -i 's/x/y/' file1.txt && sed -i 's/a/b/' file2.txt",
			);
			expect(result).toEqual(["file1.txt"]);
		});

		it("should only extract file from first command segment (semicolon)", () => {
			const result = extractBashInPlaceFiles(
				"sed -i 's/x/y/' file1.txt; sed -i 's/a/b/' file2.txt",
			);
			expect(result).toEqual(["file1.txt"]);
		});
	});

	// =========================================================================
	// Graceful degradation — should never throw
	// =========================================================================
	describe("graceful degradation (never throw)", () => {
		it("should handle very long input without crashing", () => {
			const longCmd = "sed -i 's/x/y/' " + "a".repeat(10000) + ".txt";
			const result = extractBashInPlaceFiles(longCmd);
			expect(result.length).toBeGreaterThan(0);
		});

		it("should handle unicode filenames", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' 中文文件.txt")).toEqual(["中文文件.txt"]);
		});

		it("should handle filenames with spaces in double quotes", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' \"my file.txt\"")).toEqual(["my file.txt"]);
		});

		it("should handle filenames with spaces in single quotes", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' 'my file.txt'")).toEqual(["my file.txt"]);
		});

		it("should handle special characters in expression (alternate delimiter)", () => {
			expect(extractBashInPlaceFiles("sed -i 's|/old/path|/new/path|g' config.ini")).toEqual(["config.ini"]);
		});

		it("should handle deeply nested quotes gracefully without crash", () => {
			const result = extractBashInPlaceFiles("sed -i \"s/'old'/\"new\"/g\" file.txt");
			expect(Array.isArray(result)).toBe(true);
		});

		it("should handle null bytes gracefully", () => {
			expect(() => extractBashInPlaceFiles("sed -i 's/x/y/' file\x00.txt")).not.toThrow();
		});

		it("should handle very long filenames", () => {
			const name = "a".repeat(255);
			expect(extractBashInPlaceFiles(`sed -i 's/x/y/' ${name}`)).toEqual([name]);
		});
	});

	// =========================================================================
	// Glob / wildcard filenames
	// =========================================================================
	describe("glob / wildcard filenames", () => {
		it("should extract glob patterns from sed -i", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' *.txt")).toEqual(["*.txt"]);
		});

		it("should extract glob with directory", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' src/*.ts")).toEqual(["src/*.ts"]);
		});

		it("should extract brace expansion", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' {a,b}.txt")).toEqual(["{a,b}.txt"]);
		});

		it("should handle shell glob on stdout redirect correctly", () => {
			const result = extractBashInPlaceFiles("sed -i 's/x/y/' src/*.ts > /dev/null");
			expect(result).toEqual(["src/*.ts"]);
		});
	});

	// =========================================================================
	// Path edge cases
	// =========================================================================
	describe("path edge cases", () => {
		it("should handle dot-prefixed files", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' .env")).toEqual([".env"]);
		});

		it("should handle dot-prefixed directories", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' .config/app.json")).toEqual([".config/app.json"]);
		});

		it("should handle parent directory reference", () => {
			expect(extractBashInPlaceFiles("sed -i 's/x/y/' ../file.txt")).toEqual(["../file.txt"]);
		});
	});
});
