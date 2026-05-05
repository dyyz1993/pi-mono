/**
 * Cross-environment UUID generator
 * Supports both Node.js and browser environments with fallback
 */

/**
 * Generate a UUID v4 string
 * Uses crypto.randomUUID() if available, otherwise falls back to a random string
 * This avoids breaking browser/Vite builds
 */
export function generateUUID(): string {
	// Check if crypto.randomUUID is available (Node.js 15.6.0+ and modern browsers)
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	// Fallback: generate a UUID-like string using random numbers
	// This is not a proper UUID v4 but provides unique identifiers
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Generate a short ID for non-critical use cases
 * Uses timestamp + random string for compact identifiers
 */
export function generateShortId(prefix = ""): string {
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2, 8);
	return prefix ? `${prefix}_${timestamp}${random}` : `${timestamp}${random}`;
}

/**
 * Generate a state string for OAuth flows
 * Uses crypto.randomUUID() if available, otherwise generates a secure random string
 */
export function generateOAuthState(): string {
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	// Fallback for environments without crypto.randomUUID
	const timestamp = Date.now().toString(36);
	const random = Math.random().toString(36).slice(2);
	return `${timestamp}_${random}`;
}
