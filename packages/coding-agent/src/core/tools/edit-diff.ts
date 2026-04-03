/**
 * Shared diff computation utilities for the edit tool.
 * Used by both edit.ts (for execution) and tool-execution.ts (for preview rendering).
 */

import * as Diff from "diff";
import { constants } from "fs";
import { access, readFile } from "fs/promises";
import { resolveToCwd } from "./path-utils.js";

export function detectLineEnding(content: string): "\r\n" | "\n" {
	const crlfIdx = content.indexOf("\r\n");
	const lfIdx = content.indexOf("\n");
	if (lfIdx === -1) return "\n";
	if (crlfIdx === -1) return "\n";
	return crlfIdx < lfIdx ? "\r\n" : "\n";
}

export function normalizeToLF(text: string): string {
	return text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function restoreLineEndings(text: string, ending: "\r\n" | "\n"): string {
	return ending === "\r\n" ? text.replace(/\n/g, "\r\n") : text;
}

/**
 * Normalize text for fuzzy matching. Applies progressive transformations:
 * - Strip trailing whitespace from each line
 * - Normalize smart quotes to ASCII equivalents
 * - Normalize Unicode dashes/hyphens to ASCII hyphen
 * - Normalize special Unicode spaces to regular space
 */
export function normalizeForFuzzyMatch(text: string): string {
	return (
		text
			.normalize("NFKC")
			// Strip trailing whitespace per line
			.split("\n")
			.map((line) => line.trimEnd())
			.join("\n")
			// Smart single quotes → '
			.replace(/[\u2018\u2019\u201A\u201B]/g, "'")
			// Smart double quotes → "
			.replace(/[\u201C\u201D\u201E\u201F]/g, '"')
			// Various dashes/hyphens → -
			// U+2010 hyphen, U+2011 non-breaking hyphen, U+2012 figure dash,
			// U+2013 en-dash, U+2014 em-dash, U+2015 horizontal bar, U+2212 minus
			.replace(/[\u2010\u2011\u2012\u2013\u2014\u2015\u2212]/g, "-")
			// Special spaces → regular space
			// U+00A0 NBSP, U+2002-U+200A various spaces, U+202F narrow NBSP,
			// U+205F medium math space, U+3000 ideographic space
			.replace(/[\u00A0\u2002-\u200A\u202F\u205F\u3000]/g, " ")
	);
}

export interface FuzzyMatchResult {
	/** Whether a match was found */
	found: boolean;
	/** The index where the match starts (in the content that should be used for replacement) */
	index: number;
	/** Length of the matched text */
	matchLength: number;
	/** Whether fuzzy matching was used (false = exact match) */
	usedFuzzyMatch: boolean;
	/**
	 * The content to use for replacement operations.
	 * When exact match: original content. When fuzzy match: normalized content.
	 */
	contentForReplacement: string;
}

export interface Edit {
	oldText: string;
	newText: string;
}

interface MatchedEdit {
	editIndex: number;
	matchIndex: number;
	matchLength: number;
	newText: string;
}

export interface AppliedEditsResult {
	baseContent: string;
	newContent: string;
}

/**
 * Find oldText in content, trying exact match first, then fuzzy match.
 * When fuzzy matching is used, the returned contentForReplacement is the
 * fuzzy-normalized version of the content (trailing whitespace stripped,
 * Unicode quotes/dashes normalized to ASCII).
 */
export function fuzzyFindText(content: string, oldText: string): FuzzyMatchResult {
	// Try exact match first
	const exactIndex = content.indexOf(oldText);
	if (exactIndex !== -1) {
		return {
			found: true,
			index: exactIndex,
			matchLength: oldText.length,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// Try fuzzy match - work entirely in normalized space
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	const fuzzyIndex = fuzzyContent.indexOf(fuzzyOldText);

	if (fuzzyIndex === -1) {
		return {
			found: false,
			index: -1,
			matchLength: 0,
			usedFuzzyMatch: false,
			contentForReplacement: content,
		};
	}

	// When fuzzy matching, we work in the normalized space for replacement.
	// This means the output will have normalized whitespace/quotes/dashes,
	// which is acceptable since we're fixing minor formatting differences anyway.
	return {
		found: true,
		index: fuzzyIndex,
		matchLength: fuzzyOldText.length,
		usedFuzzyMatch: true,
		contentForReplacement: fuzzyContent,
	};
}

/** Strip UTF-8 BOM if present, return both the BOM (if any) and the text without it */
export function stripBom(content: string): { bom: string; text: string } {
	return content.startsWith("\uFEFF") ? { bom: "\uFEFF", text: content.slice(1) } : { bom: "", text: content };
}

function countOccurrences(content: string, oldText: string): number {
	const fuzzyContent = normalizeForFuzzyMatch(content);
	const fuzzyOldText = normalizeForFuzzyMatch(oldText);
	return fuzzyContent.split(fuzzyOldText).length - 1;
}

function getNotFoundError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`Could not find the exact text in ${path}. The old text must match exactly including all whitespace and newlines.`,
		);
	}
	return new Error(
		`Could not find edits[${editIndex}] in ${path}. The oldText must match exactly including all whitespace and newlines.`,
	);
}

function getDuplicateError(path: string, editIndex: number, totalEdits: number, occurrences: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`Found ${occurrences} occurrences of the text in ${path}. The text must be unique. Please provide more context to make it unique.`,
		);
	}
	return new Error(
		`Found ${occurrences} occurrences of edits[${editIndex}] in ${path}. Each oldText must be unique. Please provide more context to make it unique.`,
	);
}

function getEmptyOldTextError(path: string, editIndex: number, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(`oldText must not be empty in ${path}.`);
	}
	return new Error(`edits[${editIndex}].oldText must not be empty in ${path}.`);
}

function getNoChangeError(path: string, totalEdits: number): Error {
	if (totalEdits === 1) {
		return new Error(
			`No changes made to ${path}. The replacement produced identical content. This might indicate an issue with special characters or the text not existing as expected.`,
		);
	}
	return new Error(`No changes made to ${path}. The replacements produced identical content.`);
}

/**
 * Apply one or more exact-text replacements to LF-normalized content.
 *
 * All edits are matched against the same original content. Replacements are
 * then applied in reverse order so offsets remain stable. If any edit needs
 * fuzzy matching, the operation runs in fuzzy-normalized content space to
 * preserve current single-edit behavior.
 */
export function applyEditsToNormalizedContent(
	normalizedContent: string,
	edits: Edit[],
	path: string,
): AppliedEditsResult {
	const normalizedEdits = edits.map((edit) => ({
		oldText: normalizeToLF(edit.oldText),
		newText: normalizeToLF(edit.newText),
	}));

	for (let i = 0; i < normalizedEdits.length; i++) {
		if (normalizedEdits[i].oldText.length === 0) {
			throw getEmptyOldTextError(path, i, normalizedEdits.length);
		}
	}

	const initialMatches = normalizedEdits.map((edit) => fuzzyFindText(normalizedContent, edit.oldText));
	const baseContent = initialMatches.some((match) => match.usedFuzzyMatch)
		? normalizeForFuzzyMatch(normalizedContent)
		: normalizedContent;

	const matchedEdits: MatchedEdit[] = [];
	for (let i = 0; i < normalizedEdits.length; i++) {
		const edit = normalizedEdits[i];
		const matchResult = fuzzyFindText(baseContent, edit.oldText);
		if (!matchResult.found) {
			throw getNotFoundError(path, i, normalizedEdits.length);
		}

		const occurrences = countOccurrences(baseContent, edit.oldText);
		if (occurrences > 1) {
			throw getDuplicateError(path, i, normalizedEdits.length, occurrences);
		}

		matchedEdits.push({
			editIndex: i,
			matchIndex: matchResult.index,
			matchLength: matchResult.matchLength,
			newText: edit.newText,
		});
	}

	matchedEdits.sort((a, b) => a.matchIndex - b.matchIndex);
	for (let i = 1; i < matchedEdits.length; i++) {
		const previous = matchedEdits[i - 1];
		const current = matchedEdits[i];
		if (previous.matchIndex + previous.matchLength > current.matchIndex) {
			throw new Error(
				`edits[${previous.editIndex}] and edits[${current.editIndex}] overlap in ${path}. Merge them into one edit or target disjoint regions.`,
			);
		}
	}

	let newContent = baseContent;
	for (let i = matchedEdits.length - 1; i >= 0; i--) {
		const edit = matchedEdits[i];
		newContent =
			newContent.substring(0, edit.matchIndex) +
			edit.newText +
			newContent.substring(edit.matchIndex + edit.matchLength);
	}

	if (baseContent === newContent) {
		throw getNoChangeError(path, normalizedEdits.length);
	}

	return { baseContent, newContent };
}

/**
 * Generate a unified diff string with line numbers and context.
 * Returns both the diff string and the first changed line number (in the new file).
 */
export function generateDiffString(
	oldContent: string,
	newContent: string,
	contextLines = 4,
): { diff: string; firstChangedLine: number | undefined } {
	const parts = Diff.diffLines(oldContent, newContent);
	const output: string[] = [];

	const oldLines = oldContent.split("\n");
	const newLines = newContent.split("\n");
	const maxLineNum = Math.max(oldLines.length, newLines.length);
	const lineNumWidth = String(maxLineNum).length;

	let oldLineNum = 1;
	let newLineNum = 1;
	let lastWasChange = false;
	let firstChangedLine: number | undefined;

	for (let i = 0; i < parts.length; i++) {
		const part = parts[i];
		const raw = part.value.split("\n");
		if (raw[raw.length - 1] === "") {
			raw.pop();
		}

		if (part.added || part.removed) {
			// Capture the first changed line (in the new file)
			if (firstChangedLine === undefined) {
				firstChangedLine = newLineNum;
			}

			// Show the change
			for (const line of raw) {
				if (part.added) {
					const lineNum = String(newLineNum).padStart(lineNumWidth, " ");
					output.push(`+${lineNum} ${line}`);
					newLineNum++;
				} else {
					// removed
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(`-${lineNum} ${line}`);
					oldLineNum++;
				}
			}
			lastWasChange = true;
		} else {
			// Context lines - only show a few before/after changes
			const nextPartIsChange = i < parts.length - 1 && (parts[i + 1].added || parts[i + 1].removed);
			const hasLeadingChange = lastWasChange;
			const hasTrailingChange = nextPartIsChange;

			if (hasLeadingChange && hasTrailingChange) {
				if (raw.length <= contextLines * 2) {
					for (const line of raw) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				} else {
					const leadingLines = raw.slice(0, contextLines);
					const trailingLines = raw.slice(raw.length - contextLines);
					const skippedLines = raw.length - leadingLines.length - trailingLines.length;

					for (const line of leadingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}

					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;

					for (const line of trailingLines) {
						const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
						output.push(` ${lineNum} ${line}`);
						oldLineNum++;
						newLineNum++;
					}
				}
			} else if (hasLeadingChange) {
				const shownLines = raw.slice(0, contextLines);
				const skippedLines = raw.length - shownLines.length;

				for (const line of shownLines) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}

				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}
			} else if (hasTrailingChange) {
				const skippedLines = Math.max(0, raw.length - contextLines);
				if (skippedLines > 0) {
					output.push(` ${"".padStart(lineNumWidth, " ")} ...`);
					oldLineNum += skippedLines;
					newLineNum += skippedLines;
				}

				for (const line of raw.slice(skippedLines)) {
					const lineNum = String(oldLineNum).padStart(lineNumWidth, " ");
					output.push(` ${lineNum} ${line}`);
					oldLineNum++;
					newLineNum++;
				}
			} else {
				// Skip these context lines entirely
				oldLineNum += raw.length;
				newLineNum += raw.length;
			}

			lastWasChange = false;
		}
	}

	return { diff: output.join("\n"), firstChangedLine };
}

export interface EditDiffResult {
	diff: string;
	firstChangedLine: number | undefined;
}

export interface EditDiffError {
	error: string;
}

/**
 * Compute the diff for one or more edit operations without applying them.
 * Used for preview rendering in the TUI before the tool executes.
 */
export async function computeEditsDiff(
	path: string,
	edits: Edit[],
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	const absolutePath = resolveToCwd(path, cwd);

	try {
		// Check if file exists and is readable
		try {
			await access(absolutePath, constants.R_OK);
		} catch {
			return { error: `File not found: ${path}` };
		}

		// Read the file
		const rawContent = await readFile(absolutePath, "utf-8");

		// Strip BOM before matching (LLM won't include invisible BOM in oldText)
		const { text: content } = stripBom(rawContent);
		const normalizedContent = normalizeToLF(content);
		const { baseContent, newContent } = applyEditsToNormalizedContent(normalizedContent, edits, path);

		// Generate the diff
		return generateDiffString(baseContent, newContent);
	} catch (err) {
		return { error: err instanceof Error ? err.message : String(err) };
	}
}

/**
 * Compute the diff for a single edit operation without applying it.
 * Kept as a convenience wrapper for single-edit callers.
 */
export async function computeEditDiff(
	path: string,
	oldText: string,
	newText: string,
	cwd: string,
): Promise<EditDiffResult | EditDiffError> {
	return computeEditsDiff(path, [{ oldText, newText }], cwd);
}

// ============================================================================
// NEW FEATURES: replaceAll, smartDeletion, preserveQuoteStyle, sanitize
// ============================================================================

/**
 * Options for the enhanced edit functionality.
 */
export interface EditOptions {
	/** File path to edit */
	filePath: string;
	/** Text to find and replace */
	oldText: string;
	/** Replacement text */
	newText: string;
	/** Replace all occurrences (default: false, only first occurrence) */
	replaceAll?: boolean;
	/** Enable fuzzy matching (default: false) */
	enableFuzzyMatch?: boolean;
	/** Clean up empty lines after deletion (default: false) */
	smartDeletion?: boolean;
	/** Preserve quote style from original file (default: false) */
	preserveQuoteStyle?: boolean;
	/** Sanitize control characters (default: false) */
	sanitize?: boolean;
}

/**
 * Result of an edit operation.
 */
export interface EditResult {
	/** Whether the edit was successful */
	success: boolean;
	/** Number of replacements made */
	count?: number;
	/** Error message if unsuccessful */
	error?: string;
}

/**
 * Detect the quote style used in a string.
 * Returns 'single', 'double', 'template', or 'none'.
 */
export function detectQuoteStyle(text: string): "single" | "double" | "template" | "none" {
	// Check for template literals first (backticks)
	if (text.includes("`")) {
		return "template";
	}
	// Check for single quotes
	if (text.includes("'")) {
		return "single";
	}
	// Check for double quotes
	if (text.includes('"')) {
		return "double";
	}
	return "none";
}

/**
 * Apply quote style to text.
 * Converts quotes in the text to match the specified style.
 */
export function applyQuoteStyle(text: string, style: "single" | "double" | "template" | "none"): string {
	if (style === "none") {
		return text;
	}

	// Find all quoted strings and convert them
	if (style === "single") {
		// Convert double quotes to single quotes (simple cases)
		return text.replace(/"([^"\\]*(\\.[^"\\]*)*)"/g, "'$1'");
	} else if (style === "double") {
		// Convert single quotes to double quotes (simple cases)
		return text.replace(/'([^'\\]*(\\.[^'\\]*)*)'/g, '"$1"');
	}
	// For template literals, we don't auto-convert (too complex)
	return text;
}

/**
 * Clean up empty lines after deletion.
 * This version compares before/after to determine if empty lines were created by deletion.
 */
export function smartCleanupEmptyLines(
	content: string,
	options?: {
		/** Position where deletion occurred (line number, 0-based) */
		deletionLine?: number;
		/** Number of lines deleted */
		deletedLines?: number;
	},
): string {
	const lines = content.split("\n");

	// If we have context about the deletion, use smart detection
	if (options?.deletionLine !== undefined && options?.deletedLines !== undefined) {
		const delLine = options.deletionLine;
		const delCount = options.deletedLines;

		// Check if deletion created new empty lines
		// Look at the area around the deletion point
		const startLine = Math.max(0, delLine - 1);
		const endLine = Math.min(lines.length - 1, delLine + 1);

		// Count empty lines in the affected area
		let emptyLinesInArea = 0;
		for (let i = startLine; i <= endLine; i++) {
			if (lines[i] && lines[i].trim() === "") {
				emptyLinesInArea++;
			}
		}

		// If there's an empty line right at the deletion point, it was likely created by the deletion
		// In this case, we should remove it
		if (delLine < lines.length && lines[delLine].trim() === "") {
			// Check if this empty line was created by deletion
			// Heuristic: if the previous non-empty line was followed by non-empty content before deletion,
			// then this empty line is artificial
			const prevNonEmpty = findPrevNonEmptyLine(lines, delLine);
			const nextNonEmpty = findNextNonEmptyLine(lines, delLine);

			if (prevNonEmpty !== -1 && nextNonEmpty !== -1) {
				// Both sides have content, this empty line separates them
				// But we need to check if it was created by deletion
				// If deleted lines were comments or code (not just whitespace),
				// then this empty line is artificial
				if (delCount > 0) {
					// Remove the empty line at deletion point
					lines.splice(delLine, 1);
					return lines.join("\n");
				}
			}
		}
	}

	// Default behavior: collapse multiple empty lines to one
	const result: string[] = [];
	let i = 0;

	// Skip leading empty lines
	while (i < lines.length && lines[i].trim() === "") {
		i++;
	}

	// Process rest of lines
	while (i < lines.length) {
		const line = lines[i];
		const isEmpty = line.trim() === "";

		if (!isEmpty) {
			result.push(line);
			i++;
		} else {
			// Count consecutive empty lines
			let emptyCount = 0;
			while (i < lines.length && lines[i].trim() === "") {
				emptyCount++;
				i++;
			}

			// If there are more lines after, keep one empty line
			if (i < lines.length) {
				result.push("");
			}
			// Otherwise, skip trailing empty lines
		}
	}

	return result.join("\n");
}

/**
 * Find the previous non-empty line index.
 */
function findPrevNonEmptyLine(lines: string[], fromIndex: number): number {
	for (let i = fromIndex - 1; i >= 0; i--) {
		if (lines[i].trim() !== "") {
			return i;
		}
	}
	return -1;
}

/**
 * Find the next non-empty line index.
 */
function findNextNonEmptyLine(lines: string[], fromIndex: number): number {
	for (let i = fromIndex + 1; i < lines.length; i++) {
		if (lines[i].trim() !== "") {
			return i;
		}
	}
	return -1;
}

/**
 * Sanitize control characters in text.
 * Removes or replaces problematic control characters.
 */
export function sanitizeText(text: string): string {
	// Remove null bytes and other problematic control characters
	// Keep newlines, tabs, and carriage returns
	return text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
}

/**
 * Find all occurrences of a pattern in content.
 * Returns array of {index, length} for each match.
 */
export function findAllMatches(content: string, pattern: string, useFuzzyMatch: boolean): Array<{ index: number; length: number }> {
	const matches: Array<{ index: number; length: number }> = [];

	if (useFuzzyMatch) {
		// For fuzzy match, we need to work in normalized space
		const normalizedContent = normalizeForFuzzyMatch(content);
		const normalizedPattern = normalizeForFuzzyMatch(pattern);

		let searchPos = 0;
		while (searchPos < normalizedContent.length) {
			const idx = normalizedContent.indexOf(normalizedPattern, searchPos);
			if (idx === -1) break;

			matches.push({
				index: idx,
				length: normalizedPattern.length,
			});
			searchPos = idx + normalizedPattern.length;
		}
	} else {
		// Exact match
		let searchPos = 0;
		while (searchPos < content.length) {
			const idx = content.indexOf(pattern, searchPos);
			if (idx === -1) break;

			matches.push({
				index: idx,
				length: pattern.length,
			});
			searchPos = idx + pattern.length;
		}
	}

	return matches;
}

/**
 * Apply an edit with fallback options and enhanced features.
 * This is the main entry point for the new edit functionality.
 */
export async function applyEditWithFallback(options: EditOptions): Promise<EditResult> {
	const {
		filePath,
		oldText,
		newText,
		replaceAll = false,
		enableFuzzyMatch = false,
		smartDeletion = false,
		preserveQuoteStyle = false,
		sanitize = false,
	} = options;

	try {
		// Read the file
		const { readFile, writeFile } = await import("fs/promises");
		const content = await readFile(filePath, "utf-8");

		// Sanitize if requested
		// When sanitize is enabled, we sanitize both the content and the search/replace text
		let processedContent = sanitize ? sanitizeText(content) : content;
		let processedOldText = sanitize ? sanitizeText(oldText) : oldText;
		let processedNewText = sanitize ? sanitizeText(newText) : newText;

		// Detect quote style if needed
		let quoteStyle: "single" | "double" | "template" | "none" = "none";
		if (preserveQuoteStyle) {
			quoteStyle = detectQuoteStyle(processedContent);
			if (quoteStyle !== "none") {
				processedNewText = applyQuoteStyle(processedNewText, quoteStyle);
			}
		}

		let newContent: string;
		let matchCount = 0;

		if (enableFuzzyMatch) {
			// For fuzzy matching, we need to work in original space
			// Strategy: Find matches using normalized comparison, but replace in original space
			
			const normalizedContent = normalizeForFuzzyMatch(processedContent);
			const normalizedPattern = normalizeForFuzzyMatch(processedOldText);
			
			// Check if pattern exists at all
			if (!normalizedContent.includes(normalizedPattern)) {
				return {
					success: false,
					error: `Text not found in ${filePath} (even with fuzzy matching)`,
				};
			}

			// Find all matches by comparing normalized versions
			// We need to find where in the original content the pattern matches when normalized
			const matches: Array<{ index: number; length: number }> = [];
			
			// Helper: try to match at a given position in original content
			// Returns the actual length of the match in original content, or -1 if no match
			const tryMatch = (startPos: number): number => {
				// Try different lengths in original content
				// The match in original content could be different length than processedOldText
				// due to different quote characters or whitespace
				const maxLen = Math.min(processedContent.length - startPos, processedOldText.length + 10);
				const minLen = Math.max(1, processedOldText.length - 10);
				
				for (let len = minLen; len <= maxLen; len++) {
					const originalSubstring = processedContent.substring(startPos, startPos + len);
					const normalizedSubstring = normalizeForFuzzyMatch(originalSubstring);
					
					if (normalizedSubstring === normalizedPattern) {
						return len;
					}
				}
				return -1;
			};
			
			// Search through the content
			for (let i = 0; i < processedContent.length; i++) {
				const matchLen = tryMatch(i);
				if (matchLen > 0) {
					matches.push({
						index: i,
						length: matchLen,
					});
					// Skip ahead to avoid overlapping matches
					i += matchLen - 1;
				}
			}

			if (matches.length === 0) {
				return {
					success: false,
					error: `Text not found in ${filePath} (even with fuzzy matching)`,
				};
			}

			// Determine which matches to replace
			const matchesToReplace = replaceAll ? matches : [matches[0]];
			matchCount = matchesToReplace.length;

			// Apply replacements in reverse order to maintain correct offsets
			// Work in original space
			newContent = processedContent;
			const sortedMatches = [...matchesToReplace].sort((a, b) => b.index - a.index);

			for (const match of sortedMatches) {
				newContent =
					newContent.substring(0, match.index) +
					processedNewText +
					newContent.substring(match.index + match.length);
			}
		} else {
			// Exact matching
			const matches: Array<{ index: number; length: number }> = [];
			let searchPos = 0;
			while (searchPos < processedContent.length) {
				const idx = processedContent.indexOf(processedOldText, searchPos);
				if (idx === -1) break;
				matches.push({
					index: idx,
					length: processedOldText.length,
				});
				searchPos = idx + processedOldText.length;
			}

			if (matches.length === 0) {
				return {
					success: false,
					error: `Text not found in ${filePath}`,
				};
			}

			// Determine which matches to replace
			const matchesToReplace = replaceAll ? matches : [matches[0]];
			matchCount = matchesToReplace.length;

			// Apply replacements in reverse order to maintain correct offsets
			newContent = processedContent;
			const sortedMatches = [...matchesToReplace].sort((a, b) => b.index - a.index);

			for (const match of sortedMatches) {
				newContent =
					newContent.substring(0, match.index) +
					processedNewText +
					newContent.substring(match.index + match.length);
			}
		}

		// Apply smart deletion cleanup if requested
		if (smartDeletion && processedNewText === "") {
			newContent = smartCleanupEmptyLines(newContent);
		}

		// Write the result
		await writeFile(filePath, newContent, "utf-8");

		return {
			success: true,
			count: matchCount,
		};
	} catch (error) {
		return {
			success: false,
			error: error instanceof Error ? error.message : String(error),
		};
	}
}
