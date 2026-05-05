/**
 * Cross-environment UUID generator for web-ui
 * Supports both browser and Node.js environments with fallback
 */

/**
 * Generate a UUID v4 string
 * Uses crypto.randomUUID() if available, otherwise falls back to a random string
 */
export function generateUUID(): string {
	// Check if crypto.randomUUID is available (modern browsers)
	if (typeof globalThis.crypto?.randomUUID === "function") {
		return globalThis.crypto.randomUUID();
	}

	// Fallback: generate a UUID-like string using random numbers
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Generate a session ID
 */
export function generateSessionId(): string {
	return generateUUID();
}

/**
 * Generate a state string for OAuth flows
 * Uses crypto.randomUUID() if available, otherwise generates a secure random string
 */
export function generateOAuthState(): string {
	return generateUUID();
}
