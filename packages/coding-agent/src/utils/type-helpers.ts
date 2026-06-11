/**
 * Type-safe casting utilities for runtime type validation
 *
 * These helpers replace unsafe `as Record<string, unknown>` casts
 * with functions that perform runtime checks before casting.
 */

/** Type alias for unknown object records (simplifies signatures) */
export type UnknownRecord = Record<string, unknown>;

/**
 * Cast unknown to Record after runtime validation
 * Returns empty object if input is not a valid plain object
 */
export function asRecord(input: unknown): UnknownRecord {
	if (input && typeof input === "object" && !Array.isArray(input)) {
		return input as UnknownRecord;
	}
	return {};
}

/**
 * Cast unknown to array after runtime validation
 * Returns empty array if input is not an array
 */
export function asArray<T>(input: unknown): T[] {
	return Array.isArray(input) ? (input as T[]) : [];
}

/**
 * Assert value is a string or throw TypeError
 * Use for parsing config/frontmatter where type mismatch is a bug
 */
export function assertString(value: unknown, context: string): string {
	if (typeof value !== "string") {
		throw new TypeError(`${context} must be a string, got ${typeof value}`);
	}
	return value;
}

/**
 * Get string field from record by trying multiple key variants
 * Commonly used for file_path/filePath/path alternatives
 */
export function getStringField(record: UnknownRecord, keys: string[]): string | undefined {
	for (const key of keys) {
		const value = record[key];
		if (typeof value === "string" && value.length > 0) {
			return value;
		}
	}
	return undefined;
}

/**
 * Type guard for plain objects (non-null, object, not array)
 */
export function isObject(input: unknown): input is UnknownRecord {
	return input !== null && typeof input === "object" && !Array.isArray(input);
}

/**
 * Get path argument from tool input by trying common key variants
 * Convenience wrapper for getStringField
 */
export function getPathArg(input: unknown): string | undefined {
	if (!isObject(input)) return undefined;
	return getStringField(input, ["file_path", "filePath", "path"]);
}
