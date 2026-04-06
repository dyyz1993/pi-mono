/**
 * File protection system for mom
 * 
 * Protects critical files (memory, knowledge, tasks) from direct writes.
 * All writes to protected files must go through a review process.
 */

/**
 * Protected path pattern configuration
 * Each pattern defines:
 * - pattern: glob pattern or regex for matching file paths
 * - type: 'glob' or 'regex'
 * - description: human-readable description of what's protected
 * - reason: why this file needs protection
 */
export interface ProtectedPath {
	pattern: string;
	type: 'glob' | 'regex';
	description: string;
	reason: string;
}

/**
 * Default protected paths for mom
 * These are the critical files that require review before modification
 */
export const PROTECTED_PATHS: ProtectedPath[] = [
	// Memory files
	{
		pattern: '**/MEMORY.md',
		type: 'glob',
		description: 'Memory files (MEMORY.md)',
		reason: 'Contains persistent context that affects all conversations',
	},
	{
		pattern: '**/memory/**/*.md',
		type: 'glob',
		description: 'Memory directory files',
		reason: 'Contains structured memory that affects conversation context',
	},
	// Knowledge files
	{
		pattern: '**/knowledge/**/*.md',
		type: 'glob',
		description: 'Knowledge base files',
		reason: 'Contains verified knowledge that should not be modified without review',
	},
	// Task files
	{
		pattern: '**/tasks/**/*.md',
		type: 'glob',
		description: 'Task tracking files',
		reason: 'Contains task status and assignments that need coordination',
	},
	// System configuration
	{
		pattern: '**/SYSTEM.md',
		type: 'glob',
		description: 'System configuration log',
		reason: 'Contains environment modifications that affect all sessions',
	},
	// Skills
	{
		pattern: '**/skills/**/SKILL.md',
		type: 'glob',
		description: 'Skill definition files',
		reason: 'Skills are shared tools that require coordination',
	},
];

/**
 * Check if a file path matches any protected pattern
 */
export function isProtectedPath(filePath: string): { protected: boolean; match?: ProtectedPath } {
	// Normalize the path (remove leading ./ and convert \ to /)
	const normalizedPath = filePath.replace(/^\.\//, '').replace(/\\/g, '/');
	
	for (const protectedPath of PROTECTED_PATHS) {
		if (protectedPath.type === 'glob') {
			if (matchGlob(normalizedPath, protectedPath.pattern)) {
				return { protected: true, match: protectedPath };
			}
		} else {
			const regex = new RegExp(protectedPath.pattern);
			if (regex.test(normalizedPath)) {
				return { protected: true, match: protectedPath };
			}
		}
	}
	
	return { protected: false };
}

/**
 * Simple glob pattern matcher
 * Supports:
 * - ** for any number of directories
 * - * for any characters except /
 * - ? for single character
 */
function matchGlob(path: string, pattern: string): boolean {
	// Convert glob to regex
	let regexStr = pattern
		.replace(/\*\*/g, '<<DOUBLE_STAR>>')
		.replace(/\*/g, '[^/]*')
		.replace(/<<DOUBLE_STAR>>/g, '.*')
		.replace(/\?/g, '[^/]');
	
	// Anchor the pattern
	regexStr = `^${regexStr}$`;
	
	const regex = new RegExp(regexStr);
	return regex.test(path);
}

/**
 * Extract the protected file type from a path
 * Returns: 'memory', 'knowledge', 'tasks', 'system', 'skills', or 'unknown'
 */
export function getProtectedFileType(filePath: string): string {
	const normalizedPath = filePath.replace(/^\.\//, '').replace(/\\/g, '/');
	
	if (normalizedPath.includes('/memory/') || normalizedPath.endsWith('MEMORY.md')) {
		return 'memory';
	}
	if (normalizedPath.includes('/knowledge/')) {
		return 'knowledge';
	}
	if (normalizedPath.includes('/tasks/')) {
		return 'tasks';
	}
	if (normalizedPath.endsWith('SYSTEM.md')) {
		return 'system';
	}
	if (normalizedPath.includes('/skills/')) {
		return 'skills';
	}
	
	return 'unknown';
}
